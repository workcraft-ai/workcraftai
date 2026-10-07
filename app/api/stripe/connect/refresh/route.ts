import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getServerProAccess } from "@/lib/pro-access";
import { createStripeOnboardingLink, getOnboardingContinuation, getStripeConnectOrigin } from "@/lib/stripe-connect-onboarding";
import { getCardPaymentsState, getServiceSupabase, getStripeClient } from "@/lib/stripe-server";

function profileRedirect(origin: string, status: string) {
  const url = new URL("/profile", origin);
  url.searchParams.set("connect", status);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const origin = getStripeConnectOrigin(request);
  const supabase = await createUserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("next", "/profile");
    return NextResponse.redirect(loginUrl);
  }

  try {
    if (!(await getServerProAccess(user.id)).hasPro) return profileRedirect(origin, "pro-required");

    const admin = getServiceSupabase();
    const { data: saved, error: lookupError } = await admin.from("stripe_connected_accounts")
      .select("stripe_account_id")
      .eq("user_id", user.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!saved) return profileRedirect(origin, "incomplete");

    const stripe = getStripeClient();
    const account = await stripe.v2.core.accounts.retrieve(saved.stripe_account_id, {
      include: ["configuration.merchant", "requirements"],
    });
    if (getCardPaymentsState(account).chargesEnabled) return profileRedirect(origin, "ready");

    const continuation = getOnboardingContinuation(new URL(request.url).searchParams.get("continuation"));
    const accountLink = await createStripeOnboardingLink(stripe, saved.stripe_account_id, origin, continuation);
    return NextResponse.redirect(accountLink.url);
  } catch (error) {
    console.error("Stripe onboarding link could not be refreshed:", error instanceof Error ? error.message : "unknown error");
    return profileRedirect(origin, "status-error");
  }
}
