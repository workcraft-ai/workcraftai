#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { createServerClient } from "@supabase/ssr";

const appUrl = process.env.APP_BASE_URL?.replace(/\/$/, "");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!appUrl || !supabaseUrl || !supabaseKey) {
  console.error("Set APP_BASE_URL, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the temporary anon-key fallback).");
  process.exit(2);
}

const app = new URL(appUrl);
if (app.protocol !== "https:" && app.hostname !== "localhost" && app.hostname !== "127.0.0.1") {
  throw new Error("APP_BASE_URL must use HTTPS, except for localhost.");
}

let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

async function fetchJson(url, options) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000), ...options });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function signIn(emailName, passwordName) {
  const email = process.env[emailName];
  const password = process.env[passwordName];
  if (!email || !password) return null;

  const cookies = new Map();
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach(({ name, value }) => cookies.set(name, value)),
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.ok(data.session?.access_token, `No access token returned for ${emailName}`);
  return {
    accessToken: data.session.access_token,
    cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
  };
}

async function checkAccessibleMarkup(path) {
  const response = await fetch(`${appUrl}${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
  const html = await response.text();
  assert.match(response.headers.get("content-type") ?? "", /text\/html/i, `${path} did not return HTML`);

  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]));
  const labelFor = new Set([...html.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["']/gi)].map((match) => match[1]));
  const labelBlocks = [...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));

  for (const match of html.matchAll(/<(img|input|select|textarea|button)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[0];
    const attr = (name) => attrs.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
    const id = attr("id");
    if (tag === "img") {
      assert.match(attrs, /\balt=["'][^"']*["']/i, `${path} contains an image without an alt attribute`);
      continue;
    }
    if (tag === "button") {
      const start = (match.index ?? 0) + match[0].length;
      const end = html.indexOf("</button>", start);
      const text = end < 0 ? "" : html.slice(start, end).replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#x?\w+|\w+);/gi, " ").trim();
      assert.ok(text || attr("aria-label") || attr("aria-labelledby"), `${path} contains an icon-only button without an accessible name`);
      continue;
    }
    if (tag === "input" && ["hidden", "submit", "button", "image"].includes((attr("type") ?? "").toLowerCase())) continue;
    const namedBy = (attr("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
    const hasAccessibleName = Boolean(attr("aria-label"))
      || (namedBy.length > 0 && namedBy.every((labelId) => ids.has(labelId)))
      || Boolean(id && labelFor.has(id))
      || labelBlocks.some(({ start, end }) => (match.index ?? 0) >= start && (match.index ?? 0) < end);
    assert.ok(hasAccessibleName, `${path} has an unlabeled ${tag}${id ? `#${id}` : ""}`);
    const describedBy = (attr("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    assert.ok(describedBy.every((descriptionId) => ids.has(descriptionId)), `${path} references a missing aria-describedby target`);
  }

  for (const match of html.matchAll(/\baria-labelledby=["']([^"']+)["']/gi)) {
    assert.ok(match[1].split(/\s+/).every((labelId) => ids.has(labelId)), `${path} references a missing aria-labelledby target`);
  }
}

await check("app and Supabase Auth/database health", async () => {
  const { response, data } = await fetchJson(`${appUrl}/api/health`);
  assert.equal(response.status, 200, `Health returned HTTP ${response.status}`);
  assert.equal(data?.status, "ok");
  assert.equal(data?.checks?.supabaseAuth, "ok");
  assert.equal(data?.checks?.supabaseDatabase, "ok");
});

for (const path of ["/", "/login", "/signup", "/support", "/privacy", "/terms"]) {
  await check(`public page ${path} and basic accessible markup`, () => checkAccessibleMarkup(path));
}

const free = await signIn("WORKCRAFT_E2E_FREE_EMAIL", "WORKCRAFT_E2E_FREE_PASSWORD");
const pro = await signIn("WORKCRAFT_E2E_PRO_EMAIL", "WORKCRAFT_E2E_PRO_PASSWORD");
if (free && pro) {
  await check("Free account is denied cloud AI server-side", async () => {
    const { response } = await fetchJson(`${appUrl}/api/generate-estimate`, { headers: { Cookie: free.cookie } });
    assert.equal(response.status, 403);
  });
  await check("Pro account can read its cloud AI allowance", async () => {
    const { response, data } = await fetchJson(`${appUrl}/api/generate-estimate`, { headers: { Cookie: pro.cookie } });
    assert.equal(response.status, 200);
    assert.ok(Number.isInteger(data?.daily_limit) && Number.isInteger(data?.remaining));
  });

  const ownerRole = process.env.WORKCRAFT_E2E_ESTIMATE_OWNER === "free" ? free : pro;
  const otherRole = ownerRole === free ? pro : free;
  const estimateId = process.env.WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID;
  if (estimateId) {
    const readEstimate = async (token) => {
      const query = new URLSearchParams({ select: "id", id: `eq.${estimateId}` });
      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/estimates?${query}`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(response.status, 200, `Supabase estimate query returned HTTP ${response.status}`);
      return response.json();
    };
    await check("estimate owner can read the test estimate", async () => assert.equal((await readEstimate(ownerRole.accessToken)).length, 1));
    await check("another account cannot read the test estimate through Supabase REST", async () => assert.deepEqual(await readEstimate(otherRole.accessToken), []));
  } else {
    console.log("SKIP cross-account RLS checks: set WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID to a dedicated test estimate ID.");
  }
} else {
  console.log("SKIP account, paid-feature, and cross-account checks: provide the Free and Pro test-account credentials in environment variables.");
}

async function runTestModeWebhookFixtures() {
  const enabled = process.env.WORKCRAFT_E2E_ALLOW_FIXTURE_MUTATIONS === "1";
  if (!enabled) {
    console.log("SKIP signed Stripe mutation checks: explicitly opt in with WORKCRAFT_E2E_ALLOW_FIXTURE_MUTATIONS=1 on a disposable preview fixture.");
    return;
  }
  if (!app.hostname.includes("-git-") && app.hostname !== "localhost" && app.hostname !== "127.0.0.1") {
    throw new Error("Signed webhook fixture mutations are restricted to localhost or a branch-preview *.vercel.app URL.");
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const paymentId = process.env.WORKCRAFT_E2E_PAYMENT_ID;
  const accountId = process.env.WORKCRAFT_E2E_CONNECT_ACCOUNT_ID;
  assert.ok(stripeKey.startsWith("sk_test_"), "Webhook fixtures require a Stripe test-mode secret key.");
  assert.ok(webhookSecret.startsWith("whsec_"), "Set the test-mode Connect webhook signing secret.");
  assert.ok(serviceKey && paymentId && accountId, "Set service key and disposable connected-payment fixture variables.");

  const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const dbBase = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  const paymentQuery = new URLSearchParams({ select: "id,estimate_id,status,stripe_account_id", id: `eq.${paymentId}` });
  const initialResponse = await fetch(`${dbBase}/customer_payments?${paymentQuery}`, { headers: adminHeaders, cache: "no-store" });
  assert.equal(initialResponse.status, 200, "Could not read the disposable payment fixture.");
  const [fixture] = await initialResponse.json();
  assert.ok(fixture, "Disposable customer payment fixture was not found.");
  assert.equal(fixture.status, "pending", "Payment fixture must start in pending status.");
  assert.equal(fixture.stripe_account_id, accountId, "Payment fixture connected account does not match.");

  const sendEvent = async (type) => {
    const intentId = `pi_${randomUUID().replaceAll("-", "")}`;
    const event = {
      id: `evt_e2e_${randomUUID().replaceAll("-", "")}`,
      object: "event",
      api_version: "2025-03-31.basil",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: intentId, object: "payment_intent", metadata: { payment_id: paymentId } } },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      account: accountId,
    };
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const { response, data } = await fetchJson(`${appUrl}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    assert.equal(response.status, 200, `${type} webhook returned HTTP ${response.status}`);
    return { eventId: event.id, data };
  };

  await check("signed Connect payment failure event updates the fixture", async () => {
    await sendEvent("payment_intent.payment_failed");
    const response = await fetch(`${dbBase}/customer_payments?${paymentQuery}`, { headers: adminHeaders, cache: "no-store" });
    const [updated] = await response.json();
    assert.equal(updated?.status, "failed");
  });
  await check("signed Connect payment success event updates the fixture", async () => {
    await sendEvent("payment_intent.succeeded");
    const response = await fetch(`${dbBase}/customer_payments?${paymentQuery}`, { headers: adminHeaders, cache: "no-store" });
    const [updated] = await response.json();
    assert.equal(updated?.status, "succeeded");
  });
}

await runTestModeWebhookFixtures();
console.log(`\n${passed} checks passed.`);
