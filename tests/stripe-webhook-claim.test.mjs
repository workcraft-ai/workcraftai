import test from "node:test";
import assert from "node:assert/strict";
import { getStripeWebhookClaimAction } from "../lib/stripe-webhook-claim.mjs";

test("a newly claimed Stripe event is processed", () => {
  assert.equal(getStripeWebhookClaimAction("claimed"), "process");
});

test("a completed Stripe event is acknowledged as a duplicate", () => {
  assert.equal(getStripeWebhookClaimAction("processed"), "acknowledge_duplicate");
});

test("in-flight, failed, and unknown claim states request a Stripe retry", () => {
  assert.equal(getStripeWebhookClaimAction("processing"), "retry");
  assert.equal(getStripeWebhookClaimAction("failed"), "retry");
  assert.equal(getStripeWebhookClaimAction(null), "retry");
  assert.equal(getStripeWebhookClaimAction(true), "retry");
});
