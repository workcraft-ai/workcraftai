import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getAppOrigin, getCardPaymentsState, getServiceSupabase, getStripeClient } from "@/lib/stripe-server";
import { getServerProAccess } from "@/lib/pro-access";

export async function POST(request: Request) {
  const supabase = await createUserSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to connect Stripe." }, { status: 401 });

  let hasPro = false;
  try { hasPro = (await getServerProAccess(user.id)).hasPro; }
  catch { return NextResponse.json({ error: "Could not verify your plan." }, { status: 502 }); }
  if (!hasPro) {
    return NextResponse.json({ error: "Stripe payments require an active WorkCraft AI Pro plan." }, { status: 403 });
  }

  try {
    const stripe = getStripeClient();
    const admin = getServiceSupabase();
    const { data: saved, error: lookupError } = await admin.from("stripe_connected_accounts").select("stripe_account_id").eq("user_id", user.id).maybeSingle();
    if (lookupError) throw lookupError;

    let accountId = saved?.stripe_account_id;
    let hasActiveCardPayments = false;
    if (!accountId) {
      const account = await stripe.v2.core.accounts.create({
        contact_email: user.email,
        display_name: typeof user.user_metadata?.business_name === "string" ? user.user_metadata.business_name.slice(0, 100) : undefined,
        dashboard: "express",
        identity: { country: process.env.STRIPE_CONNECT_ACCOUNT_COUNTRY || "US" },
        defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        include: ["configuration.merchant", "requirements"],
        metadata: { workcraft_user_id: user.id },
      }, { idempotencyKey: `workcraft-connect-${user.id}` });
      accountId = account.id;
      const state = getCardPaymentsState(account);
      hasActiveCardPayments = state.chargesEnabled;
      const { error: saveError } = await admin.from("stripe_connected_accounts").insert({
        user_id: user.id,
        stripe_account_id: accountId,
        charges_enabled: state.chargesEnabled,
        requirements_due: state.requirementsDue,
      });
      if (saveError) {
        const { data: concurrent } = await admin.from("stripe_connected_accounts").select("stripe_account_id").eq("user_id", user.id).maybeSingle();
        if (!concurrent?.stripe_account_id) throw saveError;
        accountId = concurrent.stripe_account_id;
      }
    } else {
      const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant", "requirements"] });
      hasActiveCardPayments = getCardPaymentsState(account).chargesEnabled;
    }

    const origin = getAppOrigin(request);
    const accountLink = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: hasActiveCardPayments ? "account_update" : "account_onboarding",
        ...(hasActiveCardPayments ? {
          account_update: {
            configurations: ["merchant"],
            collection_options: { fields: "eventually_due", future_requirements: "include" },
            return_url: `${origin}/profile?connect=return`,
            refresh_url: `${origin}/profile?connect=refresh`,
          },
        } : {
          account_onboarding: {
            configurations: ["merchant"],
            collection_options: { fields: "eventually_due", future_requirements: "include" },
            return_url: `${origin}/profile?connect=return`,
            refresh_url: `${origin}/profile?connect=refresh`,
          },
        }),
      },
    });
    return NextResponse.json({ url: accountLink.url });
  } catch (error) {
    console.error("Stripe Connect onboarding could not be started:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Stripe setup is temporarily unavailable. Please try again later." }, { status: 502 });
  }
}
