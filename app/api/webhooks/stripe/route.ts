import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { after, NextResponse } from "next/server";
import { readLimitedText } from "@/lib/read-limited-body.mjs";
import { createBoundedFetch } from "@/lib/bounded-fetch";
import { processVerifiedStripeEvent } from "@/lib/stripe-webhook-processor";

const MAX_STRIPE_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecrets = [...new Set([process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((secret): secret is string => Boolean(secret)))];
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!stripeKey || webhookSecrets.length === 0 || !serviceRoleKey || !supabaseUrl) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  const body = await readLimitedText(request, MAX_STRIPE_WEBHOOK_BODY_BYTES, 10_000);
  if (!body.ok) return NextResponse.json({ error: body.reason === "too_large" ? "Webhook request is too large." : "Invalid webhook request." }, { status: body.reason === "too_large" ? 413 : 400 });

  const stripe = new Stripe(stripeKey);
  let event: Stripe.Event | undefined;
  for (const secret of webhookSecrets) {
    try {
      event = stripe.webhooks.constructEvent(body.value, signature, secret);
      break;
    } catch {
      // Account and connected-account destinations use separate secrets.
    }
  }
  if (!event) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedFetch(5_000) },
  });
  const { data: queued, error } = await admin.rpc("workcraft_enqueue_stripe_webhook", {
    p_event_id: event.id, p_event_type: event.type, p_payload: event,
  });
  if (error) {
    console.error("Stripe webhook could not persist signed event:", error.message);
    return NextResponse.json({ error: "Webhook inbox is temporarily unavailable." }, { status: 503 });
  }
  if (queued) {
    const verifiedEvent = event;
    after(async () => {
      try {
        const result = await processVerifiedStripeEvent(verifiedEvent, request.url);
        if (!result.ok) console.error("Deferred Stripe processing will be retried:", verifiedEvent.type, result.status);
      } catch (processingError) {
        console.error("Deferred Stripe processing failed:", verifiedEvent.type, processingError instanceof Error ? processingError.name : "unknown");
      }
    });
  }
  return NextResponse.json({ received: true, queued: Boolean(queued) });
}
