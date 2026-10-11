import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getCardPaymentsState, getServiceSupabase, getStripeClient, stripeLivemode } from "@/lib/stripe-server";

export async function GET() {
  const paymentMode = process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ? "test" : process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "unavailable";
  const supabase = await createUserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false }, { status: 401 });

  try {
    const admin = getServiceSupabase();
    const { data: account, error } = await admin.from("stripe_connected_accounts")
      .select("stripe_account_id, stripe_livemode, charges_enabled, requirements_due")
      .eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!account) return NextResponse.json({ connected: false, chargesEnabled: false, requirementsDue: true, setupState: "incomplete", paymentMode });
    if (account.stripe_livemode !== stripeLivemode()) {
      return NextResponse.json({ connected: false, chargesEnabled: false, requirementsDue: true, setupState: "incomplete", paymentMode });
    }

    const stripeAccount = await getStripeClient().v2.core.accounts.retrieve(account.stripe_account_id, {
      include: ["configuration.merchant", "requirements"],
    });
    const state = getCardPaymentsState(stripeAccount);
    if (state.chargesEnabled !== account.charges_enabled || state.requirementsDue !== account.requirements_due) {
      const { error: updateError } = await admin.from("stripe_connected_accounts").update({
        charges_enabled: state.chargesEnabled,
        requirements_due: state.requirementsDue,
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id).eq("stripe_account_id", account.stripe_account_id);
      if (updateError) throw updateError;
    }
    return NextResponse.json({ connected: true, dashboard: stripeAccount.dashboard ?? null, paymentMode, ...state });
  } catch (error) {
    console.error("Could not load connected Stripe account state:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not load Stripe account status." }, { status: 502 });
  }
}
