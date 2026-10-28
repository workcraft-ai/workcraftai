import test from "node:test";
import assert from "node:assert/strict";
import { buildSignupAlert } from "../lib/signup-alert.mjs";

test("signup alert goes to the operator and reports current verification status safely", () => {
  const user = { email: 'contractor+<test>@example.test', created_at: '2026-10-28T14:00:00Z', email_confirmed_at: null };
  const alert = buildSignupAlert(user);
  assert.deepEqual(alert.to, ['alerts@workcraftai.com']);
  assert.match(alert.text, /Not yet verified/);
  assert.match(alert.text, /Eastern Time/);
  assert.match(alert.html, /contractor\+&lt;test&gt;@example\.test/);
  assert.doesNotMatch(alert.html, /contractor\+<test>/);
  assert.match(buildSignupAlert({ ...user, email_confirmed_at: '2026-10-28T14:05:00Z' }).text, /Email verification: Verified/);
});
