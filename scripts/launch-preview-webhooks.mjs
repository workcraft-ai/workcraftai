// Opt-in synthetic deliveries. No Stripe charges are created. This changes a
// dedicated Staging customer_payments fixture and writes its webhook ledger.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const app = new URL(process.env.APP_BASE_URL || "https://app.workcraftai.com");
const db = new URL(process.env.WORKCRAFT_TEST_SUPABASE_URL || "https://invalid.local");
assert.equal(process.env.WORKCRAFT_RUN_PREVIEW_WEBHOOKS, "1", "Explicit webhook opt-in required");
assert.equal(app.protocol, "https:");
assert.match(app.hostname, /^workcraftai-[a-z0-9-]+-workcraftai\.vercel\.app$/, "Use an inspected Preview deployment URL");
assert.equal(db.origin, "https://wuebymyvhzieockrohyp.supabase.co", "Only this Staging project is allowed");
assert.equal(process.env.WORKCRAFT_PREVIEW_STAGE_CONFIRMED, "wuebymyvhzieockrohyp",
  "Confirm this Preview's Supabase environment in Vercel before testing");
const key = process.env.WORKCRAFT_TEST_SERVICE_ROLE_KEY;
const secret = process.env.WORKCRAFT_TEST_CONNECT_WEBHOOK_SECRET;
const paymentId = process.env.WORKCRAFT_TEST_PAYMENT_ID;
assert.ok(key && secret && paymentId, "Supply local Staging service key, Preview Connect secret, and disposable payment UUID");
assert.match(paymentId, /^[0-9a-f-]{36}$/i);
assert.match(secret, /^whsec_/);
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const query = new URLSearchParams({ select: "status,stripe_account_id,stripe_payment_intent_id", id: `eq.${paymentId}` });
async function fixture() {
  const response = await fetch(`${db.origin}/rest/v1/customer_payments?${query}`, { headers, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, "Staging fixture read failed");
  const rows = await response.json();
  assert.equal(rows.length, 1, "Dedicated fixture not found");
  return rows[0];
}
const initial = await fixture();
assert.equal(initial.status, "pending", "Fixture must be pending; never reuse a customer payment");
assert.match(initial.stripe_account_id || "", /^acct_/);
assert.match(initial.stripe_payment_intent_id || "", /^pi_/,
  "Create the fixture through Preview test Checkout first; retain its actual PaymentIntent");
async function deliver(type, id = `evt_audit_${randomUUID().replaceAll("-", "")}`) {
  const event = { id, object: "event", livemode: false,
    created: Math.floor(Date.now() / 1000), type, account: initial.stripe_account_id,
    data: { object: { id: initial.stripe_payment_intent_id, object: "payment_intent",
      metadata: { payment_id: paymentId } } }, pending_webhooks: 1,
    request: { id: null, idempotency_key: null } };
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const response = await fetch(`${app.origin}/api/webhooks/stripe`, {
    method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": `t=${timestamp},v1=${digest}` },
    body: payload, signal: AbortSignal.timeout(30000), redirect: "error",
  });
  assert.equal(response.status, 200, `${type}: unexpected status (deployment protection may require configuration)`);
  const ledgerQuery = new URLSearchParams({ select: "status", event_id: `eq.${id}` });
  const ledger = await fetch(`${db.origin}/rest/v1/stripe_webhook_events?${ledgerQuery}`, { headers, signal: AbortSignal.timeout(15000) });
  assert.equal(ledger.status, 200);
  assert.equal((await ledger.json())[0]?.status, "processed", "No processed Staging ledger entry");
  return id;
}
await deliver("payment_intent.payment_failed");
assert.equal((await fixture()).status, "failed");
const successId = await deliver("payment_intent.succeeded");
assert.equal((await fixture()).status, "succeeded");
await deliver("payment_intent.succeeded", successId);
assert.equal((await fixture()).status, "succeeded");
await deliver("payment_intent.payment_failed");
assert.equal((await fixture()).status, "succeeded", "Late failure must not downgrade a successful payment");
console.log("PASS Staging failure, success, duplicate success, and late-failure simulations");
