import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPastDueBillingEmail,
  pastDueNoticeIdempotencyKey,
  shouldSendPastDueNotice,
} from "../lib/subscription-billing-notice.mjs";

test("past-due notice only sends when Stripe newly moves the current subscription to past_due", () => {
  assert.equal(shouldSendPastDueNotice({
    eventType: "customer.subscription.updated",
    eventStatus: "past_due",
    previousStatus: "active",
    currentStatus: "past_due",
  }), true);
  assert.equal(shouldSendPastDueNotice({
    eventType: "customer.subscription.created",
    eventStatus: "past_due",
    currentStatus: "past_due",
  }), true);
  assert.equal(shouldSendPastDueNotice({
    eventType: "customer.subscription.updated",
    eventStatus: "past_due",
    previousStatus: "past_due",
    currentStatus: "past_due",
  }), false);
  assert.equal(shouldSendPastDueNotice({
    eventType: "customer.subscription.updated",
    eventStatus: "past_due",
    previousStatus: "active",
    currentStatus: "active",
  }), false);
  assert.equal(shouldSendPastDueNotice({
    eventType: "invoice.payment_failed",
    eventStatus: "past_due",
    previousStatus: "active",
    currentStatus: "past_due",
  }), false);
  assert.equal(shouldSendPastDueNotice({
    eventType: "customer.subscription.updated",
    eventStatus: "past_due",
    currentStatus: "past_due",
  }), false);
});

test("past-due notice has an idempotency key stable for the Stripe event", () => {
  assert.equal(pastDueNoticeIdempotencyKey("evt_test_123"), "workcraft-pro-past-due-evt_test_123");
  assert.equal(pastDueNoticeIdempotencyKey("evt_test_123"), pastDueNoticeIdempotencyKey("evt_test_123"));
});

test("English past-due email explains the downgrade, preserved data, billing steps, and scope", () => {
  const email = buildPastDueBillingEmail({
    language: "en",
    billingUrl: "https://app.workcraftai.com/profile",
    supportEmail: "support@workcraftai.com",
  });

  assert.match(email.subject, /past due/i);
  assert.match(email.html, /moved to the Free plan immediately/i);
  assert.match(email.html, /Nothing was deleted/i);
  assert.match(email.html, /Manage billing/i);
  assert.match(email.html, /Stripe will restore Pro access after it confirms payment/i);
  assert.match(email.html, /directly to your connected Stripe account/i);
  assert.match(email.html, /href="https:\/\/app\.workcraftai\.com\/profile"/);
  assert.match(email.text, /Update billing: https:\/\/app\.workcraftai\.com\/profile/);
});

test("Spanish past-due email stays localized and escapes HTML attributes", () => {
  const email = buildPastDueBillingEmail({
    language: "es",
    billingUrl: 'https://app.workcraftai.com/profile?notice="past_due"',
    supportEmail: "support@workcraftai.com",
  });

  assert.match(email.subject, /está vencida/i);
  assert.match(email.html, /lang="es"/);
  assert.match(email.html, /plan gratuito/i);
  assert.match(email.html, /No se eliminó nada/i);
  assert.match(email.html, /Administrar facturación/i);
  assert.match(email.html, /Stripe restaurará el acceso Pro/i);
  assert.match(email.html, /notice=&quot;past_due&quot;/);
});
