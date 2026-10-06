import test from "node:test";
import assert from "node:assert/strict";
import { verifyResendWebhook } from "../lib/resend-webhook.mjs";

const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const timestamp = "1614265330";
const body = '{"test": 2432232314}';
const headers = {
  "svix-id": id,
  "svix-timestamp": timestamp,
  "svix-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};
const nowMs = Number(timestamp) * 1000;

test("validates a Svix v1 signature over the exact raw payload", () => {
  assert.equal(verifyResendWebhook(secret, body, headers, nowMs), true);
});

test("rejects a payload changed after signing", () => {
  assert.equal(verifyResendWebhook(secret, `${body} `, headers, nowMs), false);
});

test("rejects stale signatures to limit replay attacks", () => {
  assert.equal(verifyResendWebhook(secret, body, headers, nowMs + 301_000), false);
});

test("rejects malformed, missing, or unsupported signatures", () => {
  assert.equal(verifyResendWebhook("invalid", body, headers, nowMs), false);
  assert.equal(verifyResendWebhook(secret, body, { ...headers, "svix-id": "" }, nowMs), false);
  assert.equal(verifyResendWebhook(secret, body, { ...headers, "svix-signature": "v2,abc" }, nowMs), false);
});
