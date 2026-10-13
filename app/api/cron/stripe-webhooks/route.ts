import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createBoundedFetch } from "@/lib/bounded-fetch";
import { getCronCredential } from "@/lib/cron-authorization";
import { processVerifiedStripeEvent } from "@/lib/stripe-webhook-processor";
import { withApiFailureMetrics } from "@/lib/api-failure-metrics";

export const runtime = "nodejs";
export const maxDuration = 60;

type PendingEvent = { event_id: string; event_type: string; payload: Stripe.Event | null };

export const GET = withApiFailureMetrics("/api/cron/stripe-webhooks", async (request: Request) => {
  if (!getCronCredential(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Stripe worker is not configured." }, { status: 503 });
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedFetch(5_000) },
  });
  const now = new Date();
  const { data: due, error: dueError } = await admin.from("stripe_webhook_events")
    .select("event_id,event_type,payload")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", now.toISOString())
    .lt("attempts", 12)
    .not("payload", "is", null)
    .order("next_attempt_at", { ascending: true }).limit(2);
  const { data: stale, error: staleError } = await admin.from("stripe_webhook_events")
    .select("event_id,event_type,payload")
    .eq("status", "processing")
    .lt("processing_started_at", new Date(now.getTime() - 5 * 60_000).toISOString())
    .not("payload", "is", null)
    .order("processing_started_at", { ascending: true }).limit(Math.max(0, 2 - (due?.length ?? 0)));
  if (dueError || staleError) {
    console.error("Stripe worker could not read its inbox:", dueError?.message ?? staleError?.message);
    return NextResponse.json({ error: "Stripe inbox is temporarily unavailable." }, { status: 503 });
  }

  let processed = 0;
  let failed = 0;
  let inProgress = 0;
  const events = [...(due ?? []), ...(stale ?? [])] as PendingEvent[];
  for (const row of events) {
    if (!row.payload || row.payload.id !== row.event_id || row.payload.type !== row.event_type) {
      failed++;
      console.error("Stripe inbox event identity mismatch:", row.event_id);
      continue;
    }
    try {
      const result = await processVerifiedStripeEvent(row.payload, request.url);
      if (result.status === 202) inProgress++;
      else if (result.ok) processed++;
      else failed++;
    } catch (error) {
      failed++;
      console.error("Stripe worker processing failed:", row.event_type, error instanceof Error ? error.name : "unknown");
    }
  }
  return NextResponse.json({ picked: events.length, processed, inProgress, failed }, {
    status: failed ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
});
