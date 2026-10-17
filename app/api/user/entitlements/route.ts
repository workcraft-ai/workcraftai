import { NextResponse } from "next/server";
import { createUserSupabaseClient } from "@/app/utils/supabase/server";
import { getServerProAccess } from "@/lib/pro-access";
import { getStripeClient } from "@/lib/stripe-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createUserSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to check your plan." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const access = await getServerProAccess(user.id);
    let stripeStatus = access.stripeStatus;
    let trialEndsAt = access.trialEndsAt;
    let trialBillingReady: boolean | null = null;

    // A no-card trial stays `trialing` after billing details are added. Read
    // Stripe's current state so the UI can explain whether renewal is set up.
    if (access.source === "stripe" && stripeStatus === "trialing" && access.stripeSubscriptionId) {
      try {
        const stripe = getStripeClient(Date.now() + 10_000);
        const subscription = await stripe.subscriptions.retrieve(access.stripeSubscriptionId);
        stripeStatus = subscription.status;
        trialEndsAt = subscription.status === "trialing" && subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString()
          : null;

        if (subscription.status === "trialing") {
          trialBillingReady = Boolean(subscription.default_payment_method);
          if (!trialBillingReady) {
            const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
            const customer = await stripe.customers.retrieve(customerId);
            trialBillingReady = !("deleted" in customer) && Boolean(customer.invoice_settings.default_payment_method);
          }
        }
      } catch (error) {
        // Keep plan access available if Stripe is briefly unreachable, but let
        // the UI avoid claiming that renewal is or is not configured.
        console.error("Pro trial billing status refresh failed:", error instanceof Error ? error.name : "unknown error");
      }
    }

    const hasPro = access.hasPro;
    return NextResponse.json({
      has_pro: hasPro,
      source: access.source,
      grant_type: access.grantType,
      expires_at: access.expiresAt,
      stripe_status: stripeStatus,
      trial_available: access.trialAvailable,
      trial_ends_at: trialEndsAt,
      trial_billing_ready: trialBillingReady,
      grace_ends_at: access.graceEndsAt,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Pro entitlement lookup failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not verify your plan." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
