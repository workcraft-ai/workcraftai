/** Map the durable webhook claim RPC result to a safe handler action. */
export function getStripeWebhookClaimAction(status) {
  if (status === "claimed") return "process";
  if (status === "processed") return "acknowledge_duplicate";
  // An in-flight or unknown state must get a non-2xx response so Stripe retries.
  return "retry";
}
