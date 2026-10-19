import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCronCredential } from "@/lib/cron-authorization";
import { getServiceSupabase } from "@/lib/stripe-server";
import { getTrustedAppOrigin } from "@/lib/security.mjs";
import { enqueueNotification, processNotifications } from "@/lib/notification-outbox";
import { makeEngagementMail, type EngagementCandidate } from "@/lib/engagement-email";
import { withApiFailureMetrics } from "@/lib/api-failure-metrics";

export const maxDuration = 60;

export const GET = withApiFailureMetrics("/api/cron/engagement", async (request: Request) => {
  if (!getCronCredential(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const address = process.env.ENGAGEMENT_POSTAL_ADDRESS?.trim();
  if (!process.env.RESEND_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Engagement email service is not configured." }, { status: 503 });
  }
  const origin = getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (!origin) return NextResponse.json({ error: "App URL is not configured." }, { status: 503 });
  try {
    const admin = getServiceSupabase();
    // Preserve scarce app email capacity for customer, payment, security, and
    // trial notices. A notice sent earlier today does not block a feature tip.
    const { data: essentialQueue, error: queueError } = await admin.from("notification_outbox")
      .select("id").in("status", ["pending", "sending"]).neq("source", "engagement")
      .lte("next_attempt_at", new Date().toISOString()).limit(1);
    if (queueError) throw queueError;
    if (essentialQueue?.length) return NextResponse.json({ enabled: true, deferred: "essential_email_pending" });
    const { error: rolloutError } = await admin.from("workcraft_engagement_rollout")
      .update({ launched_at: new Date().toISOString() }).eq("id", 1).is("launched_at", null);
    if (rolloutError) throw rolloutError;
    // Recover an interrupted queue step without creating duplicate messages.
    const { data: orphaned, error: orphanError } = await admin.from("workcraft_engagement_messages")
      .select("id").is("outbox_id", null).lt("created_at", new Date(Date.now() - 5 * 60_000).toISOString()).limit(12);
    if (orphanError) throw orphanError;
    for (const event of orphaned ?? []) {
      const { data: queued, error: lookupError } = await admin.from("notification_outbox")
        .select("id").eq("send_key", `engagement-${event.id}`).maybeSingle();
      if (lookupError) throw lookupError;
      if (queued) {
        const { error } = await admin.from("workcraft_engagement_messages").update({ outbox_id: queued.id }).eq("id", event.id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("workcraft_engagement_messages").delete().eq("id", event.id).is("outbox_id", null);
        if (error) throw error;
      }
    }

    const { data, error } = await admin.rpc("workcraft_engagement_candidates", { p_limit: 12 });
    if (error) throw error;
    const queuedIds: string[] = [];
    for (const candidate of (data ?? []) as EngagementCandidate[]) {
      const token = randomBytes(24).toString("hex");
      const { data: event, error: insertError } = await admin.from("workcraft_engagement_messages").insert({
        user_id: candidate.user_id, campaign: candidate.campaign, anchor_at: candidate.anchor_at,
        estimate_id: candidate.estimate_id, unsubscribe_token: token,
      }).select("id").single();
      if (insertError?.code === "23505") continue;
      if (insertError || !event) throw insertError ?? new Error("Could not claim engagement email.");
      const queued = await enqueueNotification(admin, {
        user_id: candidate.user_id, source: "engagement", send_key: `engagement-${event.id}`,
        payload: makeEngagementMail(candidate, origin, address, token),
      });
      const { error: linkError } = await admin.from("workcraft_engagement_messages")
        .update({ outbox_id: queued.id }).eq("id", event.id);
      if (linkError) throw linkError;
      queuedIds.push(queued.id);
    }
    const delivery = queuedIds.length ? await processNotifications(admin, queuedIds, 12, 6_000) : { sent: 0, pending: 0 };
    return NextResponse.json({ enabled: true, claimed: queuedIds.length, sent: delivery.sent, pending: delivery.pending },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Engagement email run could not complete:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Engagement email run is temporarily unavailable." }, { status: 503 });
  }
});
