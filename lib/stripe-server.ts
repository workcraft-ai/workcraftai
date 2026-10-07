import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured.");
  return new Stripe(key);
}

export function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Payment storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function getAppOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

export function getCardPaymentsState(account: Stripe.V2.Core.Account) {
  const cardPayments = account.configuration?.merchant?.capabilities?.card_payments;
  const cardStatus = cardPayments?.status;
  const cardStatusDetails = cardPayments?.status_details ?? [];
  const requirements = account.requirements?.entries ?? [];
  const userActionRequired = requirements.some((entry) => entry.awaiting_action_from === "user");
  const stripeActionPending = requirements.some((entry) => entry.awaiting_action_from === "stripe");
  const stripeReviewPending = cardStatusDetails.some((detail) => detail.code === "requirements_pending_verification" || detail.code === "determining_status");
  const setupState = account.configuration?.merchant?.applied === true && cardStatus === "active"
    ? "ready"
    : userActionRequired
      ? "needs_action"
      : stripeActionPending || cardStatus === "pending" || stripeReviewPending
        ? "under_review"
        : "incomplete";
  return {
    chargesEnabled: setupState === "ready",
    requirementsDue: requirements.length > 0,
    setupState,
  };
}
