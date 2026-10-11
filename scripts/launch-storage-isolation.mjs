// Read-only RLS and Storage checks. Use short-lived tokens from legitimate
// manually authenticated test sessions. Never use a service-role key here.
import assert from "node:assert/strict";
const db = new URL(process.env.WORKCRAFT_AUDIT_SUPABASE_URL || "https://invalid.local");
assert.ok(["ivioejiiigtbmhpzjuni.supabase.co", "wuebymyvhzieockrohyp.supabase.co"].includes(db.hostname));
assert.equal(db.protocol, "https:");
const key = process.env.WORKCRAFT_AUDIT_PUBLISHABLE_KEY;
assert.ok(key, "Matching publishable key required");
const id = process.env.WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID;
assert.match(id || "", /^[0-9a-f-]{36}$/i);
const owner = process.env.WORKCRAFT_E2E_ESTIMATE_OWNER || "pro";
assert.ok(["free", "pro"].includes(owner));
const tokens = { free: process.env.WORKCRAFT_FREE_ACCESS_TOKEN, pro: process.env.WORKCRAFT_PRO_ACCESS_TOKEN };
async function request(account, route, options = {}) {
  assert.ok(tokens[account], "Both manual-session access tokens required");
  return fetch(`${db.origin}${route}`, { ...options,
    headers: { apikey: key, Authorization: `Bearer ${tokens[account]}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000), redirect: "error" });
}
const users = [];
for (const account of ["free", "pro"]) {
  const auth = await request(account, "/auth/v1/user");
  assert.equal(auth.status, 200, "Token expired or project mismatch");
  users.push((await auth.json()).id);
  const query = new URLSearchParams({ select: "id", id: `eq.${id}` });
  const estimates = await request(account, `/rest/v1/estimates?${query}`);
  assert.equal(estimates.status, 200);
  assert.equal((await estimates.json()).length, account === owner ? 1 : 0, "Estimate RLS mismatch");
  const items = new URLSearchParams({ select: "id", estimate_id: `eq.${id}` });
  const response = await request(account, `/rest/v1/line_items?${items}`);
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.ok(account === owner ? rows.length > 0 : rows.length === 0, "Line-item RLS mismatch");
}
assert.notEqual(users[0], users[1], "Isolation requires two distinct users");
const mediaQuery = new URLSearchParams({ select: "storage_path", estimate_id: `eq.${id}` });
const ownedMedia = await request(owner, `/rest/v1/estimate_attachments?${mediaQuery}`);
assert.equal(ownedMedia.status, 200);
const attachments = await ownedMedia.json();
assert.ok(attachments.length > 0, "Attach a dedicated test photo before the full Storage check");
const other = owner === "pro" ? "free" : "pro";
const foreignRows = await request(other, `/rest/v1/estimate_attachments?${mediaQuery}`);
assert.equal(foreignRows.status, 200);
assert.equal((await foreignRows.json()).length, 0);
for (const attachment of attachments) {
  const objectPath = attachment.storage_path.split("/").map(encodeURIComponent).join("/");
  const owned = await request(owner, `/storage/v1/object/authenticated/estimate-media/${objectPath}`);
  assert.equal(owned.status, 200, "Owner cannot download test attachment");
  await owned.arrayBuffer();
  const denied = await request(other, `/storage/v1/object/authenticated/estimate-media/${objectPath}`);
  assert.ok([400, 401, 403, 404].includes(denied.status), "Foreign private-media download was allowed");
  await denied.arrayBuffer();
}
console.log("PASS two-account estimate, line-item, attachment RLS and private-media downloads");
