import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getTrustedAppOrigin } from "@/lib/security.mjs";

export const maxDuration = 60;

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_ESTIMATE_FROM_EMAIL;
  const appOrigin = getTrustedAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (!cronSecret || !serviceKey || !resendKey || !sender) return NextResponse.json({ error: "Estimate follow-up service is not configured." }, { status: 503 });
  if (!appOrigin) return NextResponse.json({ error: "Set NEXT_PUBLIC_APP_URL to the production app URL." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });
  const { data: due, error } = await admin.rpc("workcraft_claim_estimate_followups", { p_limit: 100 });
  if (error) {
    console.error("Could not claim estimate follow-ups:", error.message);
    return NextResponse.json({ error: "Could not prepare scheduled follow-ups." }, { status: 503 });
  }

  type FollowupCandidate = { id: string; user_id: string; client_name: string | null; client_email: string };
  const candidates = (due ?? []) as FollowupCandidate[];
  const replyAddressByUser = new Map<string, Promise<string | null>>();
  const getContractorReplyAddress = (userId: string) => {
    const cached = replyAddressByUser.get(userId);
    if (cached) return cached;

    const lookup = admin.auth.admin.getUserById(userId).then(({ data, error }) => {
      if (error) {
        console.error("Could not resolve contractor reply address for estimate follow-up.");
        return null;
      }
      return data.user?.email?.trim() || null;
    }).catch(() => {
      console.error("Could not resolve contractor reply address for estimate follow-up.");
      return null;
    });
    replyAddressByUser.set(userId, lookup);
    return lookup;
  };
  let sent = 0;
  const batchSize = 10;
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async (estimate) => {
      const link = `${appOrigin}/estimate/${encodeURIComponent(estimate.id)}`;
      const contractorReplyEmail = await getContractorReplyAddress(estimate.user_id);
      if (!contractorReplyEmail) {
        console.error("Estimate follow-up skipped because the contractor reply address is unavailable.");
        await admin.rpc("workcraft_finish_estimate_followup", { p_estimate_id: estimate.id, p_sent: false });
        return false;
      }
      let result: Response;
      try {
        result = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `estimate-followup-${estimate.id}` },
        body: JSON.stringify({
          from: sender,
          reply_to: contractorReplyEmail,
          to: [estimate.client_email],
          subject: "Following up on your estimate",
          text: `Hi ${estimate.client_name || "there"}, just checking whether you have any questions about your estimate. Review it here: ${link}`,
          html: `<p>Hi ${String(estimate.client_name || "there").replace(/[&<>]/g, "")},</p><p>Just checking whether you have any questions about your estimate.</p><p><a href="${link}">Review your estimate</a></p>`,
        }),
        });
      } catch (sendError) {
        console.error("Follow-up email request failed:", sendError instanceof Error ? sendError.name : "unknown error");
        await admin.rpc("workcraft_finish_estimate_followup", { p_estimate_id: estimate.id, p_sent: false });
        return false;
      }
      const responseData = await result.json().catch(() => ({}));
      if (!result.ok) {
        console.error("Follow-up email provider rejected request:", result.status);
        await admin.rpc("workcraft_finish_estimate_followup", { p_estimate_id: estimate.id, p_sent: false });
        return false;
      }
      const { error: updateError } = await admin.rpc("workcraft_finish_estimate_followup", { p_estimate_id: estimate.id, p_sent: true });
      if (updateError) {
        console.error("Follow-up delivery state could not be recorded:", updateError.message);
        return false;
      }
      const { error: eventError } = await admin.from("estimate_email_events").insert({ user_id: estimate.user_id, estimate_id: estimate.id, recipient: estimate.client_email, provider_email_id: responseData.id, event: "follow_up_sent" });
      if (eventError) console.error("Follow-up email event could not be recorded:", eventError.message);
      return true;
    }));
    sent += results.filter(Boolean).length;
  }
  return NextResponse.json({ sent, checked: candidates.length });
}
