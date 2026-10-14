import type Stripe from "stripe";
import { getCardPaymentsState, getServiceSupabase, getStripeClient, stripeLivemode } from "@/lib/stripe-server";
export { estimateTotalCents, paidCents } from "@/lib/customer-payment-calculations.mjs";

type EstimateRow = {
  id: string;
  user_id: string;
  status: string;
  client_email: string | null;
  require_deposit: boolean;
  deposit_percentage: number | string | null;
  tax_rate: number | string | null;
  markup_percentage: number | string | null;
  package_options: unknown;
  selected_package: string | null;
};
type LineRow = { quantity: number | string; unit_price: number | string };
type PaymentRow = {
  id: string;
  payment_kind: "deposit" | "balance";
  amount_cents: number;
  status: string;
  amount_refunded_cents: number;
  stripe_checkout_session_id: string | null;
  checkout_url: string | null;
};

export async function refreshConnectedAccount(stripe: Stripe, admin: ReturnType<typeof getServiceSupabase>, userId: string) {
  const { data: saved, error } = await admin.from("stripe_connected_accounts")
    .select("stripe_account_id, stripe_livemode").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!saved || saved.stripe_livemode !== stripeLivemode()) return null;
  const account = await stripe.v2.core.accounts.retrieve(saved.stripe_account_id, {
    include: ["configuration.merchant", "requirements"],
  });
  const state = getCardPaymentsState(account);
  const { error: updateError } = await admin.from("stripe_connected_accounts").update({
    charges_enabled: state.chargesEnabled,
    requirements_due: state.requirementsDue,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("stripe_account_id", saved.stripe_account_id);
  if (updateError) throw updateError;
  return { stripeAccountId: saved.stripe_account_id, ...state };
}

export async function createConnectedCheckout(input: {
  estimate: EstimateRow;
  amountCents: number;
  kind: "deposit" | "balance";
  paymentId: string;
  stripeAccountId: string;
  origin: string;
  shareToken?: string | null;
}) {
  const stripe = getStripeClient();
  const title = input.kind === "deposit" ? "Estimate down payment" : "Estimate payment";
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    // Prevent Stripe Link from prompting customers to verify or create a Link account.
    excluded_payment_method_types: ["link"],
    customer_email: input.estimate.client_email || undefined,
    client_reference_id: input.estimate.id,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: input.amountCents,
        product_data: { name: title },
      },
    }],
    metadata: {
      payment_id: input.paymentId,
      estimate_id: input.estimate.id,
      contractor_user_id: input.estimate.user_id,
      payment_kind: input.kind,
    },
    payment_intent_data: {
      metadata: {
        payment_id: input.paymentId,
        estimate_id: input.estimate.id,
        contractor_user_id: input.estimate.user_id,
        payment_kind: input.kind,
      },
    },
    success_url: `${input.origin}/estimate/${encodeURIComponent(input.estimate.id)}?checkout=success${input.shareToken ? `&token=${encodeURIComponent(input.shareToken)}` : ""}`,
    cancel_url: `${input.origin}/estimate/${encodeURIComponent(input.estimate.id)}?checkout=cancelled${input.shareToken ? `&token=${encodeURIComponent(input.shareToken)}` : ""}`,
  }, {
    stripeAccount: input.stripeAccountId,
    idempotencyKey: `workcraft-customer-payment-${input.paymentId}`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session;
}

export async function retrieveOpenSession(sessionId: string, stripeAccountId: string) {
  return getStripeClient().checkout.sessions.retrieve(sessionId, {}, { stripeAccount: stripeAccountId });
}

export async function getEstimatePaymentData(admin: ReturnType<typeof getServiceSupabase>, estimateId: string) {
  const { data: estimate, error } = await admin.from("estimates")
    .select("id, user_id, status, client_email, require_deposit, deposit_percentage, tax_rate, markup_percentage, package_options, selected_package")
    .eq("id", estimateId).maybeSingle();
  if (error) throw new Error("Could not load estimate payment data.");
  if (!estimate) return { estimate: null, lines: [], totalCents: 0, payments: [] as PaymentRow[] };
  const [{ data: lines, error: lineError }, { data: payments, error: paymentError }, { data: acceptance, error: acceptanceError }] = await Promise.all([
    admin.from("line_items").select("quantity, unit_price").eq("estimate_id", estimateId),
    admin.from("customer_payments")
    .select("id, payment_kind, amount_cents, status, amount_refunded_cents, stripe_checkout_session_id, checkout_url")
      .eq("estimate_id", estimateId).order("created_at", { ascending: true }),
    admin.from("estimate_acceptances").select("accepted_total_cents").eq("estimate_id", estimateId).eq("user_id", estimate.user_id).maybeSingle(),
  ]);
  if (lineError || paymentError || acceptanceError) throw new Error("Could not load estimate payment data.");
  const typedEstimate = estimate as EstimateRow;
  const typedLines = (lines ?? []) as LineRow[];
  const typedPayments = (payments ?? []) as PaymentRow[];
  return {
    estimate: typedEstimate,
    lines: typedLines,
    totalCents: acceptance ? Number(acceptance.accepted_total_cents) : 0,
    accepted: acceptance !== null,
    payments: typedPayments,
  };
}

export async function accountCanCharge(stripeAccountId: string) {
  const stripe = getStripeClient();
  const account = await stripe.v2.core.accounts.retrieve(stripeAccountId, { include: ["configuration.merchant", "requirements"] });
  return getCardPaymentsState(account).chargesEnabled;
}
