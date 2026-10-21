import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validMfaRecoveryRequest } from "../lib/mfa-recovery-policy.mjs";

const request = {
  factor_id: "34e770dd-9ff9-416c-87fa-43b31d7ef225",
  confirm_email: " OWNER@example.com ",
  reason: "Customer lost access to their phone",
  verification_method: "registered_phone_callback",
  verification_details: "Called the existing number on file and confirmed account context.",
};

test("MFA recovery requires exact account, factor and independent verification record", () => {
  assert.equal(validMfaRecoveryRequest(request, "owner@example.com"), true);
  assert.equal(validMfaRecoveryRequest({ ...request, confirm_email: "other@example.com" }, "owner@example.com"), false);
  assert.equal(validMfaRecoveryRequest({ ...request, factor_id: "not-an-id" }, "owner@example.com"), false);
  assert.equal(validMfaRecoveryRequest({ ...request, verification_method: "email_only" }, "owner@example.com"), false);
  assert.equal(validMfaRecoveryRequest({ ...request, verification_details: "yes" }, "owner@example.com"), false);
  assert.equal(validMfaRecoveryRequest({ ...request, reason: "lost" }, "owner@example.com"), false);
});

test("MFA recovery route retains high-risk safeguards", () => {
  const route = fs.readFileSync("app/api/admin/accounts/[id]/mfa-recovery/route.ts", "utf8");
  assert.match(route, /requireTradeFlowAdmin\("super_admin"\)/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /id === access\.user\.id/);
  assert.match(route, /if \(membership\)/);
  assert.match(route, /item\.status === "verified"/);
  assert.match(route, /startAudit\(/);
  assert.match(route, /auth\.admin\.mfa\.deleteFactor\(/);
  assert.match(route, /enqueueNotification\(/);
});
