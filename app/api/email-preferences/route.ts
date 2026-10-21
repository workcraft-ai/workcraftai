import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { sameOrigin } from "@/lib/admin-support";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { getServiceSupabase } from "@/lib/stripe-server";

async function currentUser() {
  const client = await createUserSupabaseClient();
  const { data: { user }, error } = await client.auth.getUser();
  return error ? null : user;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const { data, error } = await getServiceSupabase().from("workcraft_engagement_preferences")
    .select("onboarding_enabled,tips_opted_in_at").eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Email preferences are unavailable." }, { status: 503 });
  return NextResponse.json({ onboardingEnabled: data?.onboarding_enabled ?? true, tipsOptedIn: Boolean(data?.tips_opted_in_at) },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const body = await readLimitedJsonObject(request, 1000);
  if (!body.ok || typeof body.value.onboardingEnabled !== "boolean" || typeof body.value.tipsOptedIn !== "boolean") {
    return NextResponse.json({ error: "Choose valid email preferences." }, { status: 400 });
  }
  const admin = getServiceSupabase();
  const { error: seedError } = await admin.from("workcraft_engagement_preferences")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  if (seedError) return NextResponse.json({ error: "Email preferences could not be saved." }, { status: 503 });
  const { error } = await admin.from("workcraft_engagement_preferences").update({
    onboarding_enabled: body.value.onboardingEnabled,
    tips_opted_in_at: body.value.tipsOptedIn ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Email preferences could not be saved." }, { status: 503 });
  return NextResponse.json({ onboardingEnabled: body.value.onboardingEnabled, tipsOptedIn: body.value.tipsOptedIn },
    { headers: { "Cache-Control": "private, no-store" } });
}
