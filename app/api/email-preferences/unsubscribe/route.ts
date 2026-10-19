import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/admin-support";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { getServiceSupabase } from "@/lib/stripe-server";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await readLimitedJsonObject(request, 1000);
  const token = body.ok ? body.value.token : null;
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) {
    return NextResponse.json({ error: "This preference link is invalid." }, { status: 400 });
  }
  const admin = getServiceSupabase();
  const { data: message, error: lookupError } = await admin.from("workcraft_engagement_messages")
    .select("user_id").eq("unsubscribe_token", token).maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Could not update email preferences." }, { status: 503 });
  if (!message) return NextResponse.json({ error: "This preference link is no longer available." }, { status: 404 });
  const { error } = await admin.from("workcraft_engagement_preferences").update({
    onboarding_enabled: false, tips_opted_in_at: null, updated_at: new Date().toISOString(),
  }).eq("user_id", message.user_id);
  if (error) return NextResponse.json({ error: "Could not update email preferences." }, { status: 503 });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
