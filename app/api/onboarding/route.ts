import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { sameOrigin } from "@/lib/admin-support";
import { readLimitedJsonObject } from "@/lib/read-limited-body.mjs";
import { isNewConfirmedAccount, queueWelcomeNotification } from "@/lib/welcome-notification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "bootstrap" | "previewed" | "shared" | "dismiss" | "reopen";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  const parsed = await readLimitedJsonObject(request, 512);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "Request is too large." : "Invalid onboarding action." }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const candidate = parsed.value.action;
  if (candidate !== "bootstrap" && candidate !== "previewed" && candidate !== "shared" && candidate !== "dismiss" && candidate !== "reopen") {
    return NextResponse.json({ error: "Invalid onboarding action." }, { status: 400 });
  }
  const action: Action = candidate;

  const userClient = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Onboarding is temporarily unavailable." }, { status: 503 });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: insertError } = await admin.from("workcraft_onboarding")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });
  if (insertError) return NextResponse.json({ error: "Onboarding is temporarily unavailable." }, { status: 503 });

  if (action !== "bootstrap") {
    const column = action === "previewed" ? "previewed_at" : action === "shared" ? "shared_link_at" : "dismissed_at";
    const { error: updateError } = await admin.from("workcraft_onboarding")
      .update({ [column]: action === "reopen" ? null : new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (updateError) return NextResponse.json({ error: "Could not save your progress." }, { status: 503 });
  }

  // Only accounts that explicitly accepted the current signup terms and then
  // verified their email receive a welcome. Existing accounts are not backfilled.
  const newlyAcknowledged = isNewConfirmedAccount(user);
  if (action === "bootstrap" && newlyAcknowledged) {
    try {
      await queueWelcomeNotification(admin, user);
    } catch (error) {
      console.error("Welcome notification could not be queued:", error);
    }
  }

  const [{ data: progress, error: progressError }, { data: estimates, error: estimateError }, { count: priceBookCount, error: priceBookError }] = await Promise.all([
    admin.from("workcraft_onboarding").select("previewed_at,shared_link_at,dismissed_at").eq("user_id", user.id).single(),
    admin.from("estimates").select("id").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
    admin.from("price_book_items").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  if (progressError || estimateError || priceBookError) return NextResponse.json({ error: "Could not load onboarding progress." }, { status: 503 });

  return NextResponse.json({
    eligible: newlyAcknowledged,
    dismissed: Boolean(progress?.dismissed_at),
    profileComplete: Boolean(String(user.user_metadata?.business_name ?? "").trim()),
    estimateId: estimates?.[0]?.id ?? null,
    previewed: Boolean(progress?.previewed_at),
    shared: Boolean(progress?.shared_link_at),
    priceBookReady: (priceBookCount ?? 0) > 0,
    profile: {
      fullName: String(user.user_metadata?.full_name ?? ""),
      businessName: String(user.user_metadata?.business_name ?? ""),
      businessAddress: String(user.user_metadata?.business_address ?? ""),
      phone: String(user.user_metadata?.phone ?? ""),
      logoUrl: String(user.user_metadata?.logo_url ?? ""),
      brandColor: String(user.user_metadata?.brand_color ?? "#c85b2d"),
      taxRate: Number(user.user_metadata?.tax_rate ?? 0),
      markupPercentage: Number(user.user_metadata?.markup_percentage ?? 0),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
