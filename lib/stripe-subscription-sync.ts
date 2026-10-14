import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

type CheckoutIdentity = { userId: string; attemptId: string; sessionId: string };

export class SubscriptionRefreshBusyError extends Error {
  constructor() {
    super("Subscription refresh is busy; retry the event.");
    this.name = "SubscriptionRefreshBusyError";
  }
}

/** The database lease is acquired before the authoritative provider refresh.
 * Its UUID fences an expired worker from committing after another worker takes
 * over. Only a verified, reserved Checkout can adopt a different subscription.
 */
export async function syncStripeSubscription(
  admin: SupabaseClient,
  stripe: Stripe,
  subscriptionId: string,
  checkout?: CheckoutIdentity,
) {
  const initial = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = initial.metadata.user_id;
  if (!userId) return null;
  if (checkout && checkout.userId !== userId) throw new Error("Subscription checkout identity mismatch.");
  const token = randomUUID();
  const { data: acquired, error: claimError } = await admin.rpc("workcraft_claim_subscription_sync", {
    p_user_id: userId, p_token: token,
  });
  if (claimError) throw claimError;
  if (acquired !== true) throw new SubscriptionRefreshBusyError();
  try {
    const { data: current, error: readError } = await admin.from("subscriptions")
      .select("stripe_subscription_id,stripe_subscription_created_at")
      .eq("user_id", userId).maybeSingle();
    if (readError) throw readError;
    if (current?.stripe_subscription_id && current.stripe_subscription_id !== subscriptionId && !checkout) return null;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.metadata.user_id !== userId || (checkout && subscription.metadata.checkout_attempt_id !== checkout.attemptId)) {
      throw new Error("Subscription identity changed during refresh.");
    }
    let previousCreated: number | null = null;
    if (checkout && current?.stripe_subscription_id && current.stripe_subscription_created_at === null
      && current.stripe_subscription_id !== subscriptionId) {
      const previous = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
      previousCreated = previous.created;
    }
    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const periodEnd = Math.max(0, ...subscription.items.data.map((item) => item.current_period_end));
    const { data: applied, error } = await admin.rpc("workcraft_apply_subscription_sync", {
      p_user_id: userId, p_token: token, p_subscription_id: subscription.id,
      p_customer_id: customerId, p_created: subscription.created,
      p_status: subscription.status,
      p_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      p_attempt_id: checkout?.attemptId ?? null,
      p_session_id: checkout?.sessionId ?? null,
      p_previous_created: previousCreated,
    });
    if (error) throw error;
    return applied === true ? { userId, subscription } : null;
  } finally {
    const { error } = await admin.rpc("workcraft_release_subscription_sync", { p_user_id: userId, p_token: token });
    if (error) console.error("Subscription refresh lease will expire automatically.");
  }
}
