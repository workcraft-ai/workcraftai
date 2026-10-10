import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyResendWebhook } from "@/lib/resend-webhook.mjs";
import { readLimitedText } from "@/lib/read-limited-body.mjs";

export const runtime = "nodejs";
const MAX_WEBHOOK_BODY_BYTES = 128 * 1024;
const eventStatuses: Record<string, string> = {
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

type ResendEvent = {
  type?: unknown;
  data?: { email_id?: unknown };
};

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Email webhook is not configured." }, { status: 503 });

  const body = await readLimitedText(request, MAX_WEBHOOK_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: "Invalid webhook request." }, { status: body.reason === "too_large" ? 413 : 400 });

  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };
  if (!verifyResendWebhook(secret, body.value, headers)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let event: ResendEvent;
  try {
    const parsed: unknown = JSON.parse(body.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid event");
    event = parsed as ResendEvent;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const status = typeof event.type === "string" ? eventStatuses[event.type] : undefined;
  if (!status) return NextResponse.json({ received: true, ignored: true });
  const emailId = event.data?.email_id;
  if (typeof emailId !== "string" || !emailId || !headers["svix-id"]) {
    return NextResponse.json({ error: "Invalid email event." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Email event storage is not configured." }, { status: 503 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { error } = await admin.rpc("workcraft_record_email_delivery", {
    p_event_id: headers["svix-id"], p_email_id: emailId, p_event: status,
  });
  if (error) {
    console.error("Resend event persistence failed.");
    return NextResponse.json({ error: "Email event processing is temporarily unavailable." }, { status: 503 });
  }
  return NextResponse.json({ received: true });
}
