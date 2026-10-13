# Running the WorkCraft AI production audit

The default checks do not save estimates, send customer mail or initiate payments. The optional webhook mode changes only an explicitly selected disposable Staging payment fixture. Never use it against Production.

## 1. Public production checks

```sh
node scripts/production-public-checks.mjs
```

The browser runner requires Playwright, axe-core and an installed Chromium browser. Use existing local tools or a separate development tools directory; the deployed app does not need these packages. Set `PLAYWRIGHT_MODULE`, `AXE_MODULE` and, if needed, `CHROME_EXECUTABLE` to absolute local paths.

```sh
node scripts/launch-readiness-audit.mjs
```

The runner discovers both public sitemaps, audits English/Spanish at 375/768/1280px and writes `.audit-results/launch-readiness.json`. It exits nonzero for HTTP/navigation errors, wrong language, overflow or automated accessibility violations. Small targets and incomplete axe checks require manual review. Do not interpret an automated pass as a complete native-device or daylight-contrast assessment.

## 2. Optional signed-in Free and Pro checks

Sign in through legitimate manual browser sessions, including CAPTCHA/MFA. The runner deliberately does not implement a CAPTCHA bypass or a service-role login. Save Playwright-compatible storage states in the ignored `.audit-results` directory; treat them like passwords. Keep directory permissions private and remove states after the audit. Do not paste states, session tokens, passwords or link tokens into chat or commit them.

Set these values locally:

```text
WORKCRAFT_FREE_STORAGE_STATE=.audit-results/free-state.json
WORKCRAFT_PRO_STORAGE_STATE=.audit-results/pro-state.json
WORKCRAFT_E2E_ESTIMATE_OWNER=pro
WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID=<disposable Pro-owned estimate UUID>
```

Both files must belong to different accounts in the app's matching Supabase project. The test checks server entitlements and AI eligibility with GET requests, then expects 200 for the owner estimate and 404 for the other account. It visits Dashboard, Customers, Jobs, Price book, Reports, Profile and the new estimate editor without saving or generating AI output.

Browser storage state is not the same as a username/password env file. A manual Pro session in the Codex browser can support separate UI inspection without automatically creating a portable Playwright state file.

## 3. Optional direct RLS and private-media checks

Use short-lived access tokens from the same legitimate manual sessions, a matching publishable/anon key, and an estimate containing a dedicated test attachment. No service-role key is used for isolation testing.

```text
WORKCRAFT_AUDIT_SUPABASE_URL=https://ivioejiiigtbmhpzjuni.supabase.co
WORKCRAFT_AUDIT_PUBLISHABLE_KEY=<matching public key>
WORKCRAFT_FREE_ACCESS_TOKEN=<short-lived Free session token>
WORKCRAFT_PRO_ACCESS_TOKEN=<short-lived Pro session token>
WORKCRAFT_E2E_ESTIMATE_OWNER=pro
WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID=<same disposable estimate UUID>
```

These are local secret inputs, not chat inputs. The script checks owner access and empty cross-account rows; it downloads the test attachment as its owner and confirms a foreign download is rejected. An intentionally shared signed photo URL is a different authorization mechanism and is not used to prove account isolation.

```sh
node scripts/launch-storage-isolation.mjs
```

## 4. Optional disposable Preview webhook matrix

Inspect the Preview environment first: it must point to Staging `wuebymyvhzieockrohyp`, use Stripe test keys, and have its matching test Connect signing secret. If Vercel deployment protection blocks the runner, use the documented authorized deployment-access method; do not disable protection or replace keys to get a test green.

Create a dedicated **test** Checkout/PaymentIntent fixture through the Preview workflow. It must still be pending and have its actual test connected account/PaymentIntent IDs. Do not reuse customer payments or a live object.

```text
APP_BASE_URL=https://<inspected workcraftai Preview deployment>.vercel.app
WORKCRAFT_RUN_PREVIEW_WEBHOOKS=1
WORKCRAFT_PREVIEW_STAGE_CONFIRMED=wuebymyvhzieockrohyp
WORKCRAFT_TEST_SUPABASE_URL=https://wuebymyvhzieockrohyp.supabase.co
WORKCRAFT_TEST_SERVICE_ROLE_KEY=<Staging key, local only>
WORKCRAFT_TEST_CONNECT_WEBHOOK_SECRET=<Preview test signing secret, local only>
WORKCRAFT_TEST_PAYMENT_ID=<disposable pending payment UUID>
```

```sh
node scripts/launch-preview-webhooks.mjs
```

This test changes the Staging payment status and writes processed event ledger rows. It does not prove a real Checkout, card decline, payout, receipt or dispute lifecycle. Clean up the disposable fixture according to the existing Staging test procedure after recording sanitized results.

## 5. Full acceptance mode

Once all required states, isolation inputs and Preview fixture settings are ready:

```sh
WORKCRAFT_REQUIRE_FULL_AUDIT=1 node scripts/launch-readiness-audit.mjs
```

The complete run fails if any required group is skipped. Missing test fixtures must remain marked skipped, not converted into passes. Preserve only sanitized evidence. Native-device walkthroughs, inbox checks and recovery-user sign-in are separate acceptance exercises.
