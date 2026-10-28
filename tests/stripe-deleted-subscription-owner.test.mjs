import test from "node:test";
import assert from "node:assert/strict";
import { isDeletedSubscriptionOwner } from "../lib/stripe-subscription-errors.mjs";

function adminReturning(result) {
  return { auth: { admin: { getUserById: async () => result } } };
}

test("only a confirmed missing account makes a foreign-key failure ignorable", async () => {
  const missing = adminReturning({ data: { user: null }, error: { status: 404 } });
  const exists = adminReturning({ data: { user: { id: "owner" } }, error: null });
  const unavailable = adminReturning({ data: { user: null }, error: { status: 503 } });
  assert.equal(await isDeletedSubscriptionOwner(missing, "owner", { code: "23503" }), true);
  assert.equal(await isDeletedSubscriptionOwner(exists, "owner", { code: "23503" }), false);
  assert.equal(await isDeletedSubscriptionOwner(unavailable, "owner", { code: "23503" }), false);
  assert.equal(await isDeletedSubscriptionOwner(missing, "owner", { code: "XX000" }), false);
});
