import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkCraftConnectedAccountParams,
  getConnectedAccountDestination,
} from "../lib/stripe-connect-configuration.mjs";

test("new WorkCraft AI connected accounts use Full Dashboard and Stripe-managed responsibilities", () => {
  const params = createWorkCraftConnectedAccountParams({
    userId: "contractor-user-id",
    email: "contractor@example.com",
    businessName: "Example Contracting",
    country: "US",
  });

  assert.equal(params.dashboard, "full");
  assert.deepEqual(params.defaults?.responsibilities, {
    fees_collector: "stripe",
    losses_collector: "stripe",
  });
  assert.equal(params.configuration?.merchant?.capabilities?.card_payments?.requested, true);
  assert.equal(params.metadata?.workcraft_user_id, "contractor-user-id");
});

test("connected accounts use onboarding until card payments are enabled", () => {
  assert.equal(getConnectedAccountDestination("full", false), "onboarding");
  assert.equal(getConnectedAccountDestination("express", false), "onboarding");
});

test("active Full Dashboard accounts use direct Stripe sign-in rather than account-update links", () => {
  assert.equal(getConnectedAccountDestination("full", true), "full_dashboard");
  assert.equal(getConnectedAccountDestination("express", true), "express_dashboard");
  assert.equal(getConnectedAccountDestination("none", true), "unsupported");
  assert.equal(getConnectedAccountDestination(undefined, true), "unsupported");
});
