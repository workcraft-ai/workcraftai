import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getCardPaymentsState, getServiceSupabase, getStripeClient } from "@/lib/stripe-server";

export async function GET() {
  const supabase = await createUserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false }, { status: 401 });

  try {
    const admin = getServiceSupabase();
    const { data: account, error } = await admin.from("stripe_connected_accounts")
      .select("stripe_account_id, charges_enabled, requirements_due")
      .eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (!account) return NextResponse.json({ connected: false, chargesEnabled: false, requirementsDue: true, setupState: "incomplete" });

    const stripeAccount = await getStripeClient().v2.core.accounts.retrieve(account.stripe_account_id, {
      include: ["configuration.merchant", "requirements"],
    });
    const state = getCardPaymentsState(stripeAccount);
    if (state.chargesEnabled !== account.charges_enabled || state.requirementsDue !== account.requirements_due) {
      const { error: updateError } = await admin.from("stripe_connected_accounts").update({
        charges_enabled: state.chargesEnabled,
        requirements_due: state.requirementsDue,
        updated_at: new Date().toISOString(),
      }).eq("user_id", user.id);
      if (updateError) throw updateError;
    }
    return NextResponse.json({ connected: true, dashboard: stripeAccount.dashboard ?? null, ...state });
  } catch (error) {
    console.error("Could not load connected Stripe account state:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not load Stripe account status." }, { status: 502 });
  }
}
