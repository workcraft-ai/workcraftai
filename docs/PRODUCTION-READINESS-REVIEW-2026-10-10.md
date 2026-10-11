> Historical audit baseline. The subscription, rounding, zero-invoice, email
> status and contrast findings were fixed in PR 115. The follow-up addresses
> atomic share revocation, foreign-key indexes, notification read errors and
> malformed-link failures. See `READINESS-FIXES-2026-10-10.md` for release evidence
> and explicitly unverified acceptance flows.

# Executive Summary Checklist

| Area | Result | Evidence / remaining action |
|---|---|---|
| Database RLS, private Storage, RPC privileges | Pass for inspected configuration | RLS enabled throughout public/private/Storage; scoped user RPCs; no missing SECURITY DEFINER search paths. Fresh two-user browser/API/Storage acceptance remains unverified. |
| Migration consistency | Pass | Production and Staging have the same 41 migration versions, ending `20261011010553_notification_center_and_customer_decline`. |
| Server entitlement enforcement | Pass for inspected code | Server/RLS gates and anonymous rejection probes pass. Fresh Free/Pro sessions were explicitly excluded by the owner. |
| Stripe signatures and durable event claims | Pass for inspected code / existing evidence | Unsigned request rejected; existing state-aware claims and payment transition tests pass. |
| Subscription event ordering | **Action Required — HIGH** | A late event for an old subscription can replace the newer subscription for the same user. |
| Financial totals | **Action Required — MEDIUM** | JavaScript/PostgreSQL half-cent rounding differs; explicit zero invoice totals are replaced. |
| Email reliability | **Action Required — MEDIUM** | Failed/suppressed delivery events are not tracked. Fresh invoice delivery/Reply-To acceptance remains outstanding. |
| Preview parity | **Action Required — MEDIUM** | Preview lacks configured email, CAPTCHA sitekey, hook and cron variables used in Production. |
| Public UI / accessibility | **Action Required — MEDIUM** | Contrast failures in Forgot password, eight guides and the Resources sample caption. Earlier 42-page-combination subset passed. |
| Build, types, dependencies | Pass | Production build with CI placeholders, TypeScript, 67 unit tests, five regression probes, zero production dependency advisories. Lint: two warnings, zero errors. |
| Backups, monitoring, Terms | Pass for recorded scope | Prior encrypted restore recovered database/Auth and all three private media files. Password/MFA/application recovery still needs acceptance. Alerts and Terms review owner-confirmed. |
| Complete production acceptance | **Action Required** | Signed-in/mobile task completion, fresh invoice delivery, replacement-subscription ordering, recovery login, and indexing account review are not certified by this audit. |

**Verdict:** I would fix the HIGH billing issue and MEDIUM financial/accessibility issues before expanding paid production use. This review found no demonstrated cross-account exploit; it cannot certify the signed-in flows that were excluded. Existing pilot use is a separate owner decision, not a complete production-readiness pass.

## Scope and evidence

Audit date: October 10, 2026 America/New_York; some provider timestamps are October 11 UTC. Deployed main is `e57b05fc7d848036c2496274d1792a3bf6156adb`. Both Production deployments were Ready. The local checkout is older (`cb5556b`) and contains unrelated uncommitted UI/marketing work. An immutable export at `/tmp/workcraft-final-audit` was used to inspect and test deployed source. References below are to **that commit**, not necessarily the older local file. Source permalink prefix: `https://github.com/workcraft-ai/workcraftai/blob/e57b05fc7d848036c2496274d1792a3bf6156adb/`.

Inspected scope: app/API handlers, authentication helpers, money/AI/share/email services, Supabase migrations and live policies/functions, marketing assets/pages, CI/backup/monitoring workflows, deployment/environment metadata. Generated bundles and dependencies were assessed through build/dependency tools. Environment values and account credentials were not printed.

Current scope incorporates the owner's previous decisions: Zoho is excluded; Pro is capped, not unlimited; past_due downgrades immediately; cancellations end at the billing-period boundary; refunds only where legally required. Monitoring and legal review have been owner-confirmed. Hosting-plan review was deferred; before paid commercialization, confirm the plan permits the intended commercial use. [Vercel Hobby documentation](https://vercel.com/docs/plans/hobby).

Fresh checks:

- 67 unit tests, TypeScript, production build using nonsecret CI configuration, five readiness regressions: passed.
- Fresh `npm audit --omit=dev`: zero reported production vulnerabilities; this does not prove the absence of application vulnerabilities.
- Lint: two React effect warnings in NotificationBell, no errors.
- HTTP probes: app/Auth/database health; anonymous entitlements/AI/admin/private-estimate rejection; unsigned Stripe/Resend/Auth-hook rejection; cron rejection without authorization; malformed/missing estimate decline rejection; app/marketing robots and sitemap responses.
- Public browser matrix: 102 English/Spanish × 375/768/1280 px combinations: 44 passed, 58 flagged color contrast; zero load errors, overflow or document-language mismatches. The failures repeat shared styles across viewports/languages; they are not 58 distinct defects. Result is recorded in ignored `.audit-results/launch-readiness.json`; contrast details below were independently confirmed with axe 4.10.3. Automated language checks verify the document language, not the quality or completeness of every translated sentence.
- Live database catalog/advisors and metadata from Vercel and Resend: read-only.

Historical evidence is not a fresh retest: `docs/PROVIDER-ACCEPTANCE-2026-10-10.md` records provider Stripe tests and estimate-email delivery. [Restore run 38092126519](https://github.com/workcraft-ai/workcraftai/actions/runs/38092126519) recovered 57 users, 57 identities, one MFA factor, 10 estimates, three jobs, 40 migrations and three private files. The newly applied 41st migration was not part of that snapshot. Full recovered-account login/application use is still separate.

No live charge, customer email, customer-data mutation, migration, application fix, commit or deployment was performed during this audit. New deliverables are this report and audit scripts. Proposed fixes below are reviewable implementation guidance; they have **not** been installed in the app.

## Pillar 1 — Supabase and database security

### Verified controls

Live inventory: 39 public, two private and eight Storage tables have RLS enabled. Customer data policies bind users to `auth.uid()` directly or through their owned estimate. Payments/subscriptions/connected accounts are browser-readable only by their owner; service routes perform sensitive writes. The `estimate-media` bucket is private with a 15 MiB object limit. All inspected SECURITY DEFINER functions set an empty search_path, and service-only mutations deny anonymous/authenticated execution. The three exposed user-definer RPCs intentionally perform ownership checks; do not revoke them without replacing the upload/status flows.

27 “RLS enabled, no policy” INFO notices concern internal tables that deny browser access. Adding permissive policies to silence these would reduce protection. Neither those notices nor `force_rls=false` demonstrates a user isolation defect.

### DB-1 [MEDIUM] Share revocation does not atomically authorize customer mutations

**References:** `lib/proposal-sharing.ts:10`; `app/api/estimates/[id]/decline/route.ts:40,47`; `supabase/migrations/20261011010553_notification_center_and_customer_decline.sql:75`; `20261010181745_revocable_proposal_sharing.sql:15`. Acceptance/questions/payment preparation need the same review.

**Vector/root cause:** Share authorization is read in the route, then a separate service-role RPC locks and mutates the estimate. An already-admitted request can run after a concurrent owner revocation has committed because the mutation does not recheck the current token/revocation state under its row lock. This requires possession of the previous link and precise timing; it is not an arbitrary UUID disclosure. If in-flight actions are intentionally allowed, document that weaker revocation guarantee instead.

**Fix:** Pass the SHA-256 token hash into each customer mutation and validate under the existing estimate lock. Keep the legacy UUID-link branch only for rows without a token hash. Reject revoked/expired/current-token mismatch before idempotency/state changes. Example block inside the locked RPC:

```sql
-- v_estimate has already been selected FOR UPDATE.
if v_estimate.share_revoked_at is not null
   or (v_estimate.share_expires_at is not null
       and v_estimate.share_expires_at <= pg_catalog.clock_timestamp())
   or (v_estimate.share_token_hash is not null
       and p_share_hash is distinct from v_estimate.share_token_hash) then
  raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND';
end if;
```

Adding `p_share_hash` requires a forward migration, updated route calls and service-only grants for the new signatures; do not deploy just the snippet. Test a mutation blocked behind revocation's lock. Previously issued media URLs last up to one hour (`app/api/estimates/[id]/route.ts:80`); revocation cannot erase a file already downloaded or instantly invalidate those URLs.

### DB-2 [LOW] Twelve foreign-key columns lack supporting indexes

**Affected live objects:** `contractor_notifications.estimate_id`, `estimate_acceptances.user_id`, `notification_outbox.{estimate_id,job_id,user_id}`, `tradeflow_app_settings.updated_by`, `tradeflow_media_upload_reservations.estimate_id`, `tradeflow_pro_access_grants.{granted_by,revoked_by}`, `transactional_email_events.{estimate_id,job_id,user_id}`.

**Vector:** Parent deletes and retention work can scan referencing tables and prolong locks as data grows. This is a performance finding, not proof of data leakage. Add measured indexes through a forward migration, prioritizing notification/outbox/media tables. Example:

```sql
create index if not exists contractor_notifications_estimate_id_idx
  on public.contractor_notifications (estimate_id);
create index if not exists notification_outbox_user_id_idx
  on public.notification_outbox (user_id);
create index if not exists notification_outbox_estimate_id_idx
  on public.notification_outbox (estimate_id);
create index if not exists notification_outbox_job_id_idx
  on public.notification_outbox (job_id);
```

For large tables, plan concurrent index creation outside a transaction. Do not remove the eight “unused” indexes on the basis of this small workload. [Supabase index advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

## Pillar 2 — Authentication, authorization and tiers

### Verified controls and limits

Server routes validate the actual Supabase user; API entitlement decisions do not trust local plan UI. Estimate quotas and media reservations are enforced by database functions. Admin support additionally requires admin authority/MFA. Public auth responses are neutral; Turnstile tokens are passed to Supabase for provider-side validation. Showing the widget alone is not proof of successful CAPTCHA validation; no fresh login/CAPTCHA submission was performed.

Documented customer limits match the inspected implementation: Free estimates 10/day and 50/month; Pro estimates 50/day and 500/month; Pro AI five/day and 50/month; customer email five/day and 100/month; private media 100 MB monthly uploads, 250 MB retained, 100 files. Day/month boundaries are UTC. Shared provider budgets remain necessary safety ceilings, so an individual allowance is not a guarantee of provider capacity. Admin reset behavior and customer quota display need signed-in acceptance.

### AUTH-1 [LOW / plan-dependent] Leaked-password rejection is disabled

**Reference:** Production Auth advisor `auth_leaked_password_protection`.

**Vector:** CAPTCHA/rate limits slow automated attacks but do not reject a known-compromised password when a legitimate user chooses it. Supabase's built-in leaked-password protection requires Pro or above; this remains an upgrade-plan item under the owner's free-plan decision. Enable it after the upgrade, retaining MFA/admin restrictions, neutral responses and cooldowns. Do not implement permanent email-address lockouts that attackers can trigger. [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Pillar 3 — Stripe payments and webhooks

### STRIPE-1 [HIGH] An older subscription can replace a newer active subscription

**Reference:** `app/api/webhooks/stripe/route.ts:84–98`; subscription Checkout completion also writes a row keyed by user.

**Vector/root cause:** `syncSubscription` retrieves the latest state of the subscription named by the event, then unconditionally upserts on `user_id`. Customer cancels subscription A, purchases B, then a delayed deleted/failed-invoice event for A arrives. A's current canceled state is valid, but replaces B's active row and removes Pro. Concurrent refreshes for one subscription can also finish in reverse order. Retrieval of the latest provider object does not solve subscription identity or concurrency.

**Fix:** Authenticate adoption of B through its recorded Checkout attempt; retain provider subscription creation/identity. Process subscription refreshes through one serialized user job/lease acquired **before** retrieving Stripe state. Updating an existing subscription must condition on its current identity. Switching identities must be a transactional, authorized adoption operation, not arbitrary metadata-driven upsert. The existing-subscription update can use:

```ts
// Run while holding the per-user synchronization lease.
const { data, error } = await admin.from("subscriptions")
  .update({
    status: subscription.status,
    current_period_end: getPeriodEnd(subscription),
    updated_at: new Date().toISOString(),
  })
  .eq("user_id", userId)
  .eq("stripe_subscription_id", subscription.id)
  .select("user_id");
if (error) throw error;
if (!data?.length) return null; // Ignore an event for a superseded identity.
```

That block alone is insufficient: implement the serialized lease/worker and validated Checkout adoption together, preserving retries after lease expiry. Acceptance matrix: active B followed by canceled A; failed invoice A after active B; repeated Checkout B; concurrent active/past_due refresh; immediate Free downgrade without an admin grant; cancellation through period end. [Stripe delivery ordering and duplicate handling](https://docs.stripe.com/webhooks).

### Other verified controls / remaining acceptance

Raw bounded body signature verification is present; distinct account/Connect secrets are supported. Durable claims return retry status for in-flight processing and acknowledge completed duplicates. Customer amounts and subscription price are computed/selected server-side. Payment-state RPCs verify account/intent and prevent late failure from undoing success; cumulative refund accounting is monotonic. Historical provider async-payment tests exist, but this audit did not rerun signed provider events or create charges.

## Pillar 4 — Email and integrations

### EMAIL-1 [MEDIUM] Failed and suppressed messages never reach the delivery state model

**References:** `app/api/webhooks/resend/route.ts:8`; `supabase/migrations/20261010181741_durable_notifications_and_provider_budget.sql:38,54,87`; live Resend webhook subscriptions.

**Vector:** The handler and SQL accept delivered/delayed/bounced/complained; the configured endpoint subscribes to those four. A message accepted for sending that later fails or is suppressed can remain presented as sent without a terminal failure indicator. Resend supports these additional event types. [Resend event types](https://resend.com/docs/webhooks/event-types).

**Fix:** Extend the event constraints, RPC validation and reducer with `failed`/`suppressed`, subscribe the endpoint, and add matching English/Spanish labels. Preserve deduplication, out-of-order safety and the distinction between provider acceptance and recipient delivery. Do not retry suppressed/bounced recipients automatically.

```ts
const eventStatuses: Record<string, string> = {
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
};
```

Deploy the SQL reducer support before the handler/provider subscription change. Labels: “Delivery failed” / “Error de entrega”; “Delivery suppressed” / “Envío bloqueado”. Test each signed event before and after the send record is saved.

### EMAIL-2 [LOW] DMARC is monitoring-only and has no reporting destination

**Reference:** Public TXT `_dmarc.workcraftai.com`: `v=DMARC1; p=none`.

**Vector:** The domain is verified for sending, but this record does not request receiver enforcement against spoofed messages and supplies no aggregate-report mailbox. Provider domain verification is not proof that every legitimate sender aligns.

**Fix:** Inventory Resend, Supabase Auth hook and Zoho mailbox sending, establish a monitored aggregate-report destination, observe alignment, then incrementally apply quarantine/reject. Do not immediately reject until legitimate senders have been checked. Example initial record after creating the mailbox: `v=DMARC1; p=none; rua=mailto:dmarc@workcraftai.com`.

### Verified / unverified

Resend domain is verified; delivery webhook is enabled; click/open tracking is off. Bounded provider timeouts and durable outbox retries, idempotency keys, shared provider budgets and per-user quotas are present. No pending/sending or failed outbox rows were found at the read-only check. Estimate/invoice Reply-To is sourced from the contractor, and question notifications from the customer, as inspected in code. Fresh invoice delivery and headers were not confirmed. Zoho CRM/OAuth is outside the current scope; Zoho mailbox use is a separate operational service.

## Pillar 5 — Business logic and edge cases

### MONEY-1 [MEDIUM] Binary floating-point calculations disagree with PostgreSQL numeric

**References:** `lib/estimate-money.mjs:6,10,14,25`; database financial RPC calculations.

**Reproduced:** Quantity 0.15 × rate 2.30 produces 34 cents in the JS helper versus 35 cents in PostgreSQL. 0.25 × 0.58 produces 14 versus 15 cents. `amountToCents(1.005)` produces 100 versus PostgreSQL 101. Fractional quantities make these valid input cases. Percentages are rounded to basis points in JS; database precision must match that same explicit policy.

**Fix:** Use decimal arithmetic end-to-end or use authoritative DB integer-cent results throughout preview, proposal, email and Checkout. Define accepted decimal scales at the API/DB boundary. Do not use an epsilon adjustment. A replacement helper using a pinned, reviewed `decimal.js` dependency can be:

```js
import Decimal from "decimal.js";
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const number = (value = 0) => {
  const result = new D(String(value));
  if (!result.isFinite()) throw new TypeError("Invalid financial input");
  return result;
};
const cents = (value) => {
  const result = value.toDecimalPlaces(0, D.ROUND_HALF_UP).toNumber();
  if (!Number.isSafeInteger(result)) throw new RangeError("Financial amount too large");
  return result;
};
export const amountToCents = (value) => cents(number(value).mul(100));
export const centsToAmount = (value) => value / 100;
export function calculateEstimateMoney(estimate = {}, items = [], selectedName = null) {
  const lineItemCents = items.map((item) => {
    const quantity = number(item.quantity);
    const rate = number(item.unit_price);
    if (quantity.lte(0) || rate.lt(0)) throw new RangeError("Invalid line item");
    return cents(quantity.mul(rate).mul(100));
  });
  const selected = selectedName && Array.isArray(estimate.package_options)
    ? estimate.package_options.find((item) => item.name === selectedName) : null;
  const subtotalCents = selected ? amountToCents(selected.total)
    : cents(lineItemCents.reduce((sum, value) => sum.plus(value), new D(0)));
  const percent = (base, rate = 0) => cents(number(base).mul(number(rate)).div(100));
  const markupCents = selected ? 0 : percent(subtotalCents, estimate.markup_percentage);
  const taxCents = percent(subtotalCents + markupCents, estimate.tax_rate);
  const totalCents = subtotalCents + markupCents + taxCents;
  const depositCents = estimate.require_deposit ? percent(totalCents, estimate.deposit_percentage) : 0;
  return { lineItemCents, subtotalCents, markupCents, taxCents, totalCents, depositCents };
}
```

The existing API validators still enforce the product's bounded input limits. Decide percentage scale, mirror it in SQL, and test the same serialized decimal fixtures against DB and JS before release. This proposed replacement does not by itself migrate existing amounts or validate every consumer.

### MONEY-2 [MEDIUM] Explicit zero invoice totals are replaced with another amount

**References:** `app/api/jobs/[id]/invoice-email/route.ts:136–140`; `app/invoice/[id]/page.tsx:70`; schedule job totals accept zero.

**Vector:** Both `invoiceTotal || subtotal` and `amountToCents(quoted_total) || lineItemTotal` treat zero as absent. A waived/zero-valued job can show/send its original linked estimate subtotal. Root cause: truthiness-based monetary fallback.

**Fix:** Honor validated, explicit `quoted_total`. Where unavailable totals are allowed, represent them as null and use a null-only fallback. Current valid zero must remain zero:

```ts
// Email route, after its existing finite/nonnegative validation:
const invoiceTotalForEmail = invoiceTotal;
// Invoice page, after the job has loaded:
const subtotalCents = amountToCents(job.quoted_total);
```

Test zero, a nonzero accepted package, tax/markup, partial/full refund and a changed job total against invoice page/email/payment proposal. Also make clear whether the displayed figure is original invoice total or remaining balance; do not label a fully paid invoice as an outstanding amount without that distinction.

### Existing protections / limits

Estimate creation/edit uses atomic RPCs, bounded descriptions/item counts, positive quantities, nonnegative rates and amount ceilings. Offline drafts are device-local rather than a synchronization guarantee. Local scheduling input converts to UTC and rejects invalid/ambiguous DST times; stored appointments are rendered in the current device timezone. Named job timezone/travel behavior and multi-day jobs require a product decision, not an assumed test pass. AI prices are labeled starting suggestions; they are not verified local supplier prices. Price-book matching and measurement/unit review remain necessary. No under-60-second signed-in estimate-and-send measurement was performed.

## Pillar 6 — Vercel configuration and hygiene

### ENV-1 [MEDIUM] Preview lacks Production feature configuration

**Reference:** Current `workcraftai-app` Vercel environment metadata, inspected without decrypting values.

Production includes Supabase public config/service credential, app URL, Turnstile sitekey, Gemini key, Stripe secret/price/two webhook secrets, Resend API/signing secret, Supabase Send Email Hook secret and cron secret. Preview has Supabase/Gemini/Stripe keys, but no explicit app URL, CAPTCHA sitekey, Resend API/webhook/hook or cron variables. The absent sitekey omits the UI widget; Staging Auth CAPTCHA settings were not verified here. This is a testing-parity gap, not proof of a Production CAPTCHA bypass.

**Fix:** Configure a separate Preview widget and Staging email hook, correct callback/app origin, test-mode Stripe keys, and approved test-recipient sending. Keep independent provider secrets and never copy Production service credentials into Preview. Inspect provider settings, redeploy Preview, then complete both-tier tests including reset, invoice and notifications.

Public variables: APP_URL, SITE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY/ANON_KEY, SUPPORT_EMAIL, TURNSTILE_SITE_KEY, all with the `NEXT_PUBLIC_` prefix where used. Private provider values are STRIPE_SECRET_KEY, Stripe webhook secrets, RESEND_API_KEY/webhook secret, SUPABASE_SERVICE_ROLE_KEY/email-hook secret, GEMINI_API_KEY and CRON_SECRET. Stripe price ID and sender addresses are server configuration, not authentication secrets. No scanned public-prefixed private key exposure was found. Values were not decrypted, so names alone cannot prove environment correctness.

### DOC-1 [LOW] The release runbook describes an older migration/deployment baseline

**Reference:** `docs/PRODUCTION-READINESS-RELEASE.md:9,18` describes 40 migrations. Current baseline is 41, deployed `e57b05f`; Vercel metadata access works. Preserve historical evidence with its commit/date, and link this current review as the present baseline. Do not rewrite old test counts into fresh results.

Generic error responses are used for tested public API failures. Logs require provider-console review for operational errors; no exhaustive log-history disclosure test was performed. Enforced CSP retains `script-src 'unsafe-inline'`, a residual defense limitation; nonce-based CSP is a future hardening task requiring compatibility/performance testing, not an observed XSS exploit.

## Pillar 7 — UI, responsive layout and usability

### UI-1 [MEDIUM] Forgot password helper copy fails small-text contrast

**References:** `app/forgot-password/page.tsx:71,97`; `.text-slate-400` under the current theme in `app/globals.css`.

**Observed:** Effective foreground `#68736b`, ratios 3.52:1 over `#131c19` and 3.04:1 over `#1d2925`; small text requires 4.5:1. This affects guidance in a recovery flow, especially outdoors.

**Fix:** Use an explicit light helper token scoped to dark Auth surfaces, rather than changing the global text token used on light surfaces:

```css
.auth-dark .auth-helper { color: #cbd5cf; }
```

```tsx
<main className="auth-dark /* existing layout classes */">
  <p className="auth-helper mt-2 text-center text-sm">
    {translate(language, "We’ll email you a secure link to choose a new password.")}
  </p>
</main>
```

Apply the same helper style to remembered-password guidance and recheck focus/error/disabled states in both languages.

### UI-2 [MEDIUM] Guide metadata and Resources sample caption fail contrast

**References:** `marketing-site/styles.css:143,165,174`; all eight `marketing-site/resources/<slug>/index.html` guides; current-page breadcrumb and `<time>`; Resources index sample caption.

**Observed:** Guide metadata `#69736c` over `#f5f3ec` measures 4.43:1 at 11–12 px. Resources sample caption `#7a827a` over `#fffefa` measures 3.92:1 at 8 px, flagged at mobile/tablet in both languages. Fix shared tokens, preserving the editorial design:

```css
.breadcrumbs,
.guide-byline time,
.resource-estimate-caption { color: #58655d; }
```

Recheck guides and Resources index at three viewports and both languages. Main marketing page passed the expanded run.

### UI-3 [LOW] Notification read errors disappear without feedback

**Reference:** `app/components/NotificationBell.tsx:143–159`; lint warnings at 108 and 124.

**Vector:** `markRead` silently returns on a network/database error, then the caller closes the panel and navigates. The unread count can remain without an explanation. Add localized failure feedback without preventing users from opening their estimate, and return focus to the bell on Escape/close. Example error handling:

```tsx
if (error) {
  setNotice(language === "es"
    ? "No pudimos marcar la notificación como leída. Inténtalo de nuevo."
    : "We could not mark the notification as read. Try again.");
  return;
}
// Render notice in an aria-live="polite" status region.
```

Add state/status markup and clear notice on the next attempt; do not introduce a new undeclared setter by pasting only this block. The effect warnings should be reviewed independently rather than silenced.

### UI-4 [LOW] Visible inline targets fall below the requested 48 px field-use target

**Affected components:** Public auth/help/footer links and guide navigation, flagged by browser target measurements in `.audit-results/launch-readiness.json`. These flags are not automatically WCAG failures; inline text has different target-size exceptions.

**Suggestion:** Give standalone navigation/primary actions 48 px minimum height/width and spacing. Keep dense legal prose inline. Verify signed-in bottom navigation, line-item controls and horizontal table affordance on a real iPhone when access is available.

```css
.standalone-action {
  display: inline-flex;
  align-items: center;
  min-height: 48px;
  min-width: 48px;
  padding-inline: 12px;
}
```

Marketing value proposition/pricing/CTA destinations, responsive overflow and public form associations were assessed. App navigation/source reflects Dashboard, customers, schedule, price book and reports with bilingual copy; manual semantic translation review remains required. No customer proposal acceptance/payment UI, owner invoice render, notification interactions or offline form submission was exercised through an authenticated browser.

## Pillar 8 — Repeatable E2E verification

### QA-1 [MEDIUM] Existing scripts can skip core flows and have weaker fixture realism

**References:** `scripts/readiness-browser.mjs:11–12` requires undeclared tooling; `scripts/production-readiness-smoke.mjs:46` password login without CAPTCHA; `:207` weak Preview URL guard; `:260` generates different PaymentIntent IDs for failure and success.

**Vector:** Public-only success can be mistaken for full readiness; direct password login conflicts with current bot protection. New random intents do not exercise a real disposable payment identity. A branch-name URL test does not establish which database the Preview uses.

**Generated replacements:**

- `scripts/launch-readiness-audit.mjs`: English/Spanish responsive axe/overflow/language checks for main site, resource index/eight guides and seven public app pages; optional legitimate Free/Pro browser states; server entitlements/AI access; owned-vs-foreign estimate API checks (foreign returns 404, deliberately concealing existence).
- `scripts/launch-storage-isolation.mjs`: optional short-lived ordinary user tokens, distinct users, estimate/line-item/attachment RLS and private file owner/foreign downloads. Read-only, no service-role use.
- `scripts/launch-preview-webhooks.mjs`: explicit opt-in only, dedicated pending Staging fixture, fixed existing PaymentIntent/account identity, signed failure/success/duplicate/late-failure deliveries and Staging ledger assertions. Synthetic events do not create charges and do not replace genuine provider async/refund/subscription acceptance.

Missing coverage is recorded as skipped; `WORKCRAFT_REQUIRE_FULL_AUDIT=1` fails incomplete coverage. Keep manual browser state/token files in ignored `.audit-results` or `.env*`, never commits. Do not disable CAPTCHA/MFA to obtain states. Syntax checking is complete; public mode is exercised in this audit. Signed-in/Storage/webhook modes are generated but not executed here by the owner's instruction.

### Tool setup and execution

Tooling can live outside project dependencies so this audit does not modify the package lock:

```sh
npm install --prefix /tmp/workcraft-audit-tools playwright@1.56.1 axe-core@4.10.3
/tmp/workcraft-audit-tools/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=/tmp/workcraft-audit-tools/node_modules/playwright/index.mjs \
AXE_MODULE=/tmp/workcraft-audit-tools/node_modules/axe-core/axe.min.js \
node scripts/launch-readiness-audit.mjs
```

Use a reviewed runtime version compatible with your machine. This audit used the installed bundled Playwright and local Google Chrome. For manual storage states, run Playwright codegen with `--save-storage=.audit-results/pro-state.json` (and a separate Free state), sign in normally, close it, then set `WORKCRAFT_PRO_STORAGE_STATE` and `WORKCRAFT_FREE_STORAGE_STATE`. Both states are bearer credentials; discard them after testing. Supply a disposable estimate with a test line/photo through `WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID` and `WORKCRAFT_E2E_ESTIMATE_OWNER=pro`.

For the optional direct RLS/Storage module, set `WORKCRAFT_AUDIT_SUPABASE_URL`, `WORKCRAFT_AUDIT_PUBLISHABLE_KEY`, and `WORKCRAFT_FREE_ACCESS_TOKEN` / `WORKCRAFT_PRO_ACCESS_TOKEN` locally from legitimate sessions. The helper refuses non-WorkCraft project hosts and verifies two distinct users. Tokens expire; do not share them in chat.

For synthetic Preview webhook testing, inspect Vercel's actual Preview Supabase target first. Set `APP_BASE_URL` to that deployment, `WORKCRAFT_TEST_SUPABASE_URL=https://wuebymyvhzieockrohyp.supabase.co`, `WORKCRAFT_PREVIEW_STAGE_CONFIRMED=wuebymyvhzieockrohyp`, `WORKCRAFT_TEST_SERVICE_ROLE_KEY`, `WORKCRAFT_TEST_CONNECT_WEBHOOK_SECRET`, `WORKCRAFT_TEST_PAYMENT_ID`, and `WORKCRAFT_RUN_PREVIEW_WEBHOOKS=1`. The confirmation is an operator assertion, not automatic deployment attestation; never assert it without inspecting the target. Fixture must start pending, already have its test Checkout PaymentIntent, and be expendable. The test leaves it succeeded and writes four event records. Vercel-protected Previews need approved access before execution. Do not expose service credentials in artifacts/logs.

## Completion ownership / order

1. **Engineering:** Fix STRIPE-1, MONEY-1/MONEY-2; add DB revocation guards and EMAIL-1 states; fix the two contrast findings. Include new regression cases and deploy only after review/authorization.
2. **Owner + engineering:** Configure Preview parity; run replacement-subscription/provider lifecycle matrix and genuine invoice delivery/Reply-To test. Owner performs CAPTCHA/MFA; no credentials in chat.
3. **Engineering when signed-in coverage is permitted:** Run new read-only two-account API/RLS/Storage checks and mobile create/send/notification/customer decline flows. Keep dispositions explicit for excluded tests.
4. **Operations:** Run a current encrypted snapshot and recovered-account password/MFA/application acceptance; retain the existing successful structural restore evidence. Confirm Search Console verification/indexing in the owner's account; HTTP sitemaps alone do not certify indexing.
5. **Later/plan-dependent:** Leaked-password protection and commercial hosting-plan review; DMARC enforcement after monitored sender alignment. Monitoring/Terms confirmations remain accepted.

Do not mark the checklist fully complete because unsigned requests fail, unit tests pass, or historical acceptance succeeded on an older commit.
