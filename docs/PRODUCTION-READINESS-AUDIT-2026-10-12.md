# WorkCraft AI production readiness audit — October 12, 2026

## Executive Summary Checklist

| Area | Result | What the result means |
| --- | --- | --- |
| Database RLS and owner authorization | **Pass in review and manual Free-to-Pro editor check; full isolation exercise open** | All 45 inspected application tables in `public`/`private` have RLS. No application table grants anonymous SELECT. The Free account opens its own estimate editor and is rejected from the Pro account's private editor. Bidirectional direct-RLS/private-media testing remains open. |
| Browser secret separation | **Pass** | The 51-module browser import graph contains no private environment-variable references. No provider secret has a `NEXT_PUBLIC_` name in the reviewed source or deployment metadata. |
| Authentication and server Pro gates | **Pass for enforcement; Action Required for onboarding** | Verified Auth users and database/server entitlements control premium operations. Incomplete onboarding disappears when the signup Terms version changes (M2). |
| Signup and recovery email resilience | **Action Required — High** | The Auth hook has a longer work budget than Supabase allows and leaves independently retryable mail behind when Auth returns an error (H1). This is a failure-path risk; the current outbox has no pending Auth messages. |
| Stripe signature, event replay and monetary validation | **Pass in source/provider configuration; complete checkout exercise open** | Both live endpoints are enabled and have the expected account/Connect events. Raw signatures, durable event claims, subscription fencing and server-derived payment amounts are present. Execution budgets need improvement (M6). |
| Transactional email authentication and events | **Pass with a Low recommendation** | Resend reports verified DKIM/SPF; all six delivery events are enabled. DMARC is monitoring-only (L3). |
| Retention operations | **Action Required — Medium** | The daily job repeatedly fails because its claim functions join `auth.users` using an invoker role without SELECT permission (M1). |
| Estimate/invoice money and scheduling | **Pass for shared calculation helpers; Action Required for reports** | Decimal money and explicit zero invoices are covered by tests. Profit incorrectly includes tax; unpaginated queries can omit report data (M3/M4). |
| Mobile navigation and usability | **Action Required — Medium/Low** | Pro screens inspected at 375px fit the viewport. The public footer overflows on every tested mobile marketing page (M7); language fragments and small form text remain (L1/L2). |
| CI, release controls and encrypted backups | **Pass within verified scope** | Main requires both CI jobs, has no bypass actors, and blocks deletion/force pushes. Current production source matches local HEAD. Latest scheduled database/Auth backups passed; today's run intentionally skipped media and restore testing. |
| E2E verification deliverable | **Pass for script delivery; Action Required for outstanding fixtures** | Reusable read-only account/isolation checks and opt-in Staging webhook simulations exist. Automated authenticated groups were skipped without manual-session files. Manual Free and Pro browser checks were completed separately. |

**Recommendation:** resolve H1 before inviting more signup traffic. Fix M1, M2, M3 and M7 in the next release. Complete the two-account and disposable Preview payment acceptance checks before describing the release as fully verified. No Critical vulnerability or successful cross-account access was identified in the inspected evidence; this is not proof that every possible attack has been excluded.

### Scope and evidence

- Reviewed source: `f7503165c35070d2cfd7b944f0df5f2beefab2eb`. `git diff HEAD origin/main` is empty; production main is merge `93f5b123b8eb9445b336989430b7331cdc4e200e`.
- Both Vercel production deployments were Ready on that main commit. Production Supabase: `ivioejiiigtbmhpzjuni`; Staging: `wuebymyvhzieockrohyp`.
- Local execution: **75 unit tests passed**, clean full ESLint and TypeScript checks. The modified audit script also passes syntax and ESLint checks. The production main [CI run](https://github.com/workcraft-ai/workcraftai/actions/runs/38296361423) passed; its database suite is CI evidence, not a newly executed local database test in this audit.
- **19 production public HTTP checks passed:** Auth/API rejection, invalid proposal actions, unsigned webhook rejection, health, enforced CSP, robots and sitemaps.
- Public browser sweep: **192 route/width/language checks**, including every published resource guide and help article, at 375/768/1280px. No HTTP/navigation or document-language errors remained after correcting the audit's expected login redirect. Automated axe found no WCAG A/AA violations; 84 page combinations had incomplete checks requiring human review. Zero axe violations does not establish complete accessibility compliance. All 26 mobile marketing documents had footer overflow; the runner correctly exited nonzero for those layout failures.
- Manual Pro session: Dashboard, Customers, Price book, Schedule, Reports, Profile, new estimate, an existing owner proposal and its existing invoice. Pro entitlements loaded correctly. Customer questions were visible; invoice return navigation was correct; package totals could be cleared to an empty input. English was restored and the temporary viewport override removed.
- Follow-up manual Free session: Dashboard, Profile, new estimate, own estimate editor, Schedule, Reports, Price book and Customers. Profile showed Free with 10/day and 50/month limits; cloud AI was visible with disabled controls; deposits/packages/payments and scheduling displayed Pro restrictions. Estimate reports remained available without Pro job metrics. Its own editor loaded while the Pro account's private editor returned `Estimate not found` and redirected to Dashboard after acknowledgement. No save or AI-generation action was submitted.
- No new estimates, approvals, emails, payments, AI attempts, account deletions or production database write fixtures were submitted. No CAPTCHA/MFA was bypassed. Viewing normal signed-in pages may update ordinary activity/onboarding telemetry.
- Automated authenticated storage-state files, direct two-account media exercise and fresh Preview synthetic webhooks were not supplied/executed in this run. Browser navigation directly to the JSON entitlement endpoint was blocked by the browser; the manual checks used the normal app screens and editor's API-backed error instead. HTTP response status for that editor request was not independently captured. A 60-second create-and-send benchmark, native Safari keyboard behavior, inbox/header acceptance and a real customer checkout were not measured.

## Pillar 1 — Supabase and database security

### Passed controls

Live policy review confirms ownership in SELECT/INSERT/UPDATE/DELETE for `estimates`, `line_items`, `customer_contacts`, `price_book_items`, `estimate_templates`, `jobs` and `estimate_attachments`. Updates include ownership checks for the resulting row. Jobs/media mutations require Pro; owner reads remain available after downgrade. Subscription and payment records are not client-writable entitlement sources.

`estimate-media` is private, has a 15 MiB object limit and an image/audio MIME allowlist. Public proposals receive authorized signed photo URLs; contractor voice notes are excluded from public responses. Replaced, revoked and expired share tokens are rechecked inside locked mutation RPCs. Legacy UUID links intentionally remain usable until replaced or disabled; that documented compatibility decision should not be mistaken for a missing-token vulnerability.

The seven inspected Auth-callable SECURITY DEFINER functions have an empty search path and no anonymous execution grant. The three public media/status RPCs called out by Supabase's advisor intentionally support the owner workflow and enforce ownership. Internal RLS-enabled tables without policies also have no client grants: default denial is expected. Do not add permissive policies or indiscriminately revoke working owner RPCs to remove advisor notices.

### M1 — Retention claim functions cannot read Auth users

**Severity: Medium. Confirmed production failure.**

**References:** `supabase/migrations/20261004220558_account_retention_lifecycle.sql:82`, `:107`, `:140`, `:170`; `supabase/migrations/20261005010742_secure_proposal_estimate_integrity.sql:43`; `app/api/cron/account-retention/route.ts:49`.

All three claim functions are SECURITY INVOKER and join `auth.users` to return email/language. Live `has_table_privilege('service_role','auth.users','SELECT')` returned false. Production logs show repeated `Could not claim inactivity notices: permission denied for table users`, including October 12. The initial failure returns 503 before processing notices or deletion retries. This affects retention reliability; it does not expose other accounts.

**Fix:** keep the claim transaction limited to app-owned lifecycle tables. Retain the return signature for rollout compatibility, but return null email/default language. Hydrate notice recipients through the supported Auth Admin API in the server route. Remove the Auth joins from the due-deletion and failed-deletion claim functions as well; those route branches already use only user ID/reason. Preserve row locks, notice prerequisites, admin exclusions and all grants.

Replace the notice claim's final SELECT with:

```sql
select c.user_id, null::text as email, 'en'::text as language,
       c.last_active_at, c.notice_claimed_at
from claimed c;
```

Then resolve each notice recipient before sending, with the existing failure branch preserved:

```ts
const { data: account, error: lookupError } =
  await admin.auth.admin.getUserById(entry.user_id);
const recipient = account.user?.email;
if (lookupError || !recipient) {
  await admin.rpc("workcraft_finish_inactivity_notice", {
    p_user_id: entry.user_id,
    p_claimed_at: entry.claimed_at,
    p_sent: false,
  });
  warningFailures += 1;
  continue;
}
const language = account.user?.user_metadata?.app_language === "es" ? "es" : "en";
const message = warningEmail(language, appOrigin, supportEmail);
// Use recipient in the existing Resend payload's to field.
```

**Acceptance:** in Staging, call all three RPCs as service_role with an empty candidate set, then exercise notice claim/finish with rollback-only fixtures. Recheck the authorized cron without deleting real accounts. Do not grant broad SQL access to `auth.users` as the shortcut.

### Upgrade note

Leaked-password protection is disabled. Supabase currently restricts it to Pro and above; it is a plan decision, not a code regression. Retain CAPTCHA, confirmation, generic responses and rate limits now. Enable it at the planned Supabase upgrade. [Supabase password security](https://supabase.com/docs/guides/auth/password-security).

## Pillar 2 — Authentication, authorization and tiering

### Passed controls

`app/utils/supabase/middleware.ts` validates users and preserves refreshed cookies on redirects. Internal workspaces require login; public proposal access has separate share authorization. `lib/pro-access.ts` derives Pro access from protected subscription/admin-grant records, not editable user metadata. AI, customer email, deposits, packages, invoices, jobs and media have server/RPC/RLS checks. Manipulating client UI state is insufficient to grant access. Immediate past-due downgrade preserves saved records; it does not delete the contractor's work.

Admin tools use verified membership, action-specific roles, reason/audit records and MFA assurance (`lib/admin-support.ts:9`). The Pro browser session in this audit was admin-granted, so it cannot prove subscription-based downgrade behavior.

### M2 — Terms changes remove unfinished onboarding

**Severity: Medium. Confirmed logic defect.**

**References:** `lib/welcome-notification.ts:8`, `lib/signup-terms.ts:2`, `app/api/onboarding/route.ts:46`, `:79`, `app/components/FirstFiveMinutes.tsx:166`.

Onboarding eligibility requires the account's original signup Terms version to equal today's version. Updating Terms from October 11 to October 12 hides the checklist for an otherwise eligible October 11 signup, even when setup is unfinished. An email-version change should not remove setup guidance.

**Fix:** give onboarding a durable enrollment/cohort marker, independently of future Terms acceptance. Keep the current `welcome-${user.id}` uniqueness key and do not backfill every historical customer with welcome mail. For the immediate rollout, explicitly recognize the supported initial cohort versions:

```ts
const onboardingSignupVersions = new Set(["2026-10-11", "2026-10-12"]);
export function isNewConfirmedAccount(user: User) {
  return user.user_metadata?.workcraft_terms_accepted === true
    && onboardingSignupVersions.has(String(user.user_metadata?.workcraft_terms_version))
    && Boolean(user.email_confirmed_at && user.email);
}
```

Use an app-owned immutable enrollment field for subsequent releases instead of continually editing this set. It is an onboarding classification, never an entitlement or proof of legal acceptance. **Acceptance:** an incomplete account from each supported version retains setup after a Terms update; dismissed/completed accounts remain dismissed/completed; no duplicate welcome sends.

## Pillar 3 — Stripe payments and webhooks

### Passed controls

- `app/api/webhooks/stripe/route.ts:32` preserves the raw body for `constructEvent`; missing/invalid signatures are rejected. Distinct live platform and Connect signing secrets are configured.
- Database event claims acknowledge completed duplicates, reject busy work for retry and permit stale/failed work to recover. The per-user subscription lease fences expired workers. Fresh provider retrieval plus reserved Checkout identity prevents an old subscription/Checkout from replacing a newer one (`lib/stripe-subscription-sync.ts:12`).
- Pro Checkout uses the server price ID and durable reserved attempt. Public customer Checkout validates the share link, accepted state, owner Pro entitlement, connected account mode and database-derived integer amount. Client-supplied dollar amounts are not trusted.
- Live provider review: platform endpoint has subscription and invoice lifecycle events; Connect endpoint has synchronous/asynchronous Checkout, intent success/failure, refund and all three dispute events. Both enabled URLs point to the current app handler.
- Invoice emails lead to the accepted estimate's payment balance. They are not an independent payment request for an edited invoice amount; the UI explains this. Preserve that distinction until a separate invoice ledger is deliberately implemented.

### M6 — Individual request timeouts do not bound the complete handler

**Severity: Medium. Confirmed configuration/slow-provider risk; no timeout incident reproduced here.**

**References:** `app/api/webhooks/stripe/route.ts:28`, `:46`; `lib/stripe-subscription-sync.ts:18`, `:35`, `:41`, `:47`; `lib/stripe-server.ts:5`; `lib/account-deletion.ts:75`.

The webhook's 30-second execution budget can be exceeded by serial 8-second Stripe reads plus 5-second database calls, release bookkeeping and event completion. The shared Stripe factory and account deletion additionally use the SDK default 80-second request timeout with retries. Those can leave checkout/deletion waiting through provider slowness even though the webhook client itself was bounded.

**Fix:** set an explicit shared Stripe timeout/retry policy, retain provider idempotency for creation calls, and impose an overall route deadline with time reserved for retry bookkeeping. Bound Supabase requests too. For longer processing, verify/persist the event and process it through a durable worker; return 2xx only once durable responsibility is established. Do not use `Promise.race` that returns while un-aborted payment work continues.

```ts
export function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured.");
  return new Stripe(key, { timeout: 8_000, maxNetworkRetries: 0 });
}
```

For the subscription helper, check a shared absolute deadline before each provider/DB stage and shorten each request to the remaining budget. On budget exhaustion, leave the event retryable and allow the lease to expire if release fails. Increasing `maxDuration` alone does not provide a total request deadline.

**Acceptance:** simulated slow provider/database stages return a controlled retry response within the total budget, a replay finishes once, checkout reuses its reserved idempotency key, and old-subscription fencing still passes.

### Payment follow-up recommendation

Dispute notices are sent, but dispute status is not separately displayed in the app payment summary (`app/api/webhooks/stripe/route.ts:114`). Add a dispute badge/Stripe Dashboard link when payment reporting expands. A historically successful charge is not proof the contractor retains its proceeds after a lost dispute. Do not automatically recharge or reopen the customer's payable balance on a dispute event.

## Pillar 4 — Resend and Zoho

### H1 — Auth hook and generic notification retries have incompatible lifecycles

**Severity: High. Confirmed failure-path design risk; no current undelivered Auth backlog.**

**References:** `app/api/auth/email-hook/route.ts:10`, `:24`, `:31`, `:35`, `:41`; `lib/notification-outbox.ts:14`, `:46`, `:58`, `:73`; `supabase/migrations/20261010181741_durable_notifications_and_provider_budget.sql:73`; `app/api/cron/notifications/route.ts:19`.

Supabase HTTP Auth hooks should complete within **five seconds** and execute within the Auth transaction. This hook allows up to five seconds for each database request, several serial requests, and three seconds for the provider, while declaring a 30-second function duration. Vercel's duration does not extend Supabase's deadline. [Supabase Auth hook contract](https://supabase.com/docs/guides/auth/auth-hooks).

The hook also stores the email independently before the Auth user/token operation is committed. A transient failure returns 429/503 but leaves an Auth notification pending. The generic cron can subsequently send that notification while the original signup/reset transaction failed. The result can be a confusing unusable link. The ten-minute TTL limits age; it does not establish that Auth committed. Current source and provider docs establish this path; it was not intentionally triggered against real production accounts.

**Fix:** choose one explicit Auth delivery contract. Recommended for this release: a dedicated synchronous, idempotent Auth sender with one overall budget below five seconds; generic background notification claims must exclude Auth. Failed Auth attempts must not independently resend an old payload; let a new signed Auth request supply the valid token. Keep durable generic retries for estimates, invoices and other notifications. Alternatively acknowledge a durable queued Auth send within five seconds and design the pending-delivery/reconciliation behavior explicitly; do not mix a failure acknowledgement with later delivery.

An interim database containment for automatic background claims is the following additional predicate inside the existing `due` CTE (preserve all other locking, lease and grant behavior):

```sql
-- Explicit signed-hook IDs can still claim their own Auth attempt.
-- The generic cron passes NULL, so it cannot send uncommitted Auth payloads.
and (p_ids is not null or o.source <> 'auth')
```

That predicate alone does **not** fix the hook deadline or define how a failed attempt is retired. Implement the synchronous sender and budget as a coordinated change. Reuse the same provider idempotency key across retries of the same signed request, redact tokens/recipients from logs, and avoid acknowledging a failed provider send as delivered.

**Acceptance:** in Staging only, cover a provider 429/500, a provider delay beyond the budget, quota exhaustion, duplicated hook delivery, signup and password reset. A hook failure must not cause the notification cron to send that failed request's token. A successful signup must confirm and sign in. All hook responses must arrive inside Supabase's deadline.

### Passed email controls

Resend verifies `resend._domainkey` DKIM and the `send` SPF records. Both tracking options are disabled. The active webhook subscribes to delivered, delayed, bounced, complained, failed and suppressed; raw Standard Webhooks signatures and bounded bodies are enforced. The durable delivery ledger handles early/duplicate/out-of-order events. Customer email quotas are per account with a separate shared provider admission ceiling. General notifications have bounded provider calls, exponential backoff, finite attempts and an idempotency-window cutoff. Successful rows clear message payloads.

The current live outbox aggregate contained seven sent rows and no pending/sending rows. That is a point-in-time result, not a guarantee future sends cannot fail. No audit email was sent.

**Zoho:** no Zoho OAuth/API integration exists in the reviewed app. Zoho is an inbox/address provider; transactional application sending uses Resend. Token refresh/storage review is not applicable. `docs/EMAIL-ADDRESS-ROLES.md:18` still describes separate Auth SMTP as the active path even though Production uses the Send Email Hook; update that operational note with H1 so future operators do not configure the wrong sender path.

### L3 — DMARC is monitoring-only

**Severity: Low.** `_dmarc.workcraftai.com` currently publishes `v=DMARC1; p=none`. This does not enforce rejection/quarantine of unauthenticated impersonation. After verifying alignment for **both** Resend and legitimate Zoho mail, add a controlled reporting destination and stage quarantine, then reject. Do not switch directly to reject without checking legitimate senders. This is domain configuration, not an application-code change.

## Pillar 5 — Financial logic, scheduling and field workflows

### Passed controls

`lib/estimate-money.mjs` uses exact decimal ratios/BigInt rounding matching PostgreSQL numeric behavior. Shared helpers cover quantities, rates, markup, tax, package totals and deposits. Tests cover half-cent boundaries, explicit zero invoices and package precision. API validation rejects negative/nonfinite values, malformed units/packages, oversized bodies and excessive totals. Source evidence does not replace a newly completed UI save/send benchmark.

Scheduling stores UTC timestamps and renders the device time zone. `lib/localDateTime.mjs` rejects nonexistent and ambiguous DST local times; unit tests cover these. There is no multi-day end-time model: describe scheduling as a job date/time, not as a full multi-day calendar reservation engine.

Offline drafts use account-scoped IndexedDB and explicit save/restore in the loaded editor. This is not a full offline application: new navigation, cloud AI, sending and payments still require connectivity. Clearly retain the local-draft feedback and avoid promising automatic background sync. Good/Better/Best totals cleared correctly during the manual Pro test.

### M3 — Gross profit counts collected sales tax as revenue

**Severity: Medium. Confirmed calculation defect.**

**References:** `app/reports/page.tsx:59`; `supabase/migrations/20261009182527_fix_estimate_job_conversion_rls.sql:72`, `:93`.

Job conversion stores subtotal + markup + tax in `quoted_total`. Reports subtract actual costs directly from that tax-inclusive amount. A $1,000 pre-tax job, $75 sales tax and $600 cost shows $475 profit/44% margin rather than $400/40% before-tax gross profit. Existing sample jobs do not demonstrate this because their tax was zero.

**Fix:** snapshot the accepted tax and pre-tax job value when converting the estimate. Calculate profit from the pre-tax snapshot, with cents-based aggregation. Preserve the tax-inclusive total for customer amount due. Backfill linked historical jobs using the accepted calculation rules; mark independently created/ambiguous jobs as needing review instead of silently inventing a tax amount. Recomputing from today's editable tax settings is not a reliable historical snapshot.

```ts
// Add and populate quoted_tax_cents as an accepted-time snapshot first.
const revenueCents = completedJobs.reduce((sum, job) =>
  sum + Math.round(Number(job.quoted_total) * 100) - job.quoted_tax_cents, 0);
const costCents = completedJobs.reduce((sum, job) =>
  sum + Math.round(Number(job.actual_cost) * 100), 0);
const grossProfitCents = revenueCents - costCents;
const grossMargin = revenueCents > 0
  ? Math.round(grossProfitCents / revenueCents * 100) : 0;
```

Prefer storing both value and tax as validated integer cents in the migration. The snippet requires the new typed snapshot field and is not a standalone migration. **Acceptance:** taxed and untaxed jobs, chosen packages, zero totals and legacy/manual jobs have the intended totals; editing profile defaults does not change historical profit.

### M4 — Unpaginated account queries silently truncate reports

**Severity: Medium. Confirmed scale defect; current small sample not truncated.**

**References:** `app/reports/page.tsx:30`; `app/dashboard/page.tsx:86`; `app/pricebook/page.tsx:40`; `app/schedule/page.tsx:68`; `supabase/config.toml` API `max_rows = 1000`.

Reports fetch all estimates, lines and jobs without pagination. A contractor can exceed 1,000 line items well before reaching 1,000 estimates. API row caps can then return a valid but incomplete result, undercounting totals and opportunities. The same pattern eventually hides older records from workspace lists. RLS still protects ownership; this is completeness, not isolation.

**Fix:** use an owner-scoped database aggregate for financial summaries and explicit pagination for lists. Return aggregate summaries as one object so the row cap cannot truncate the aggregation. A transitional complete-read helper is:

```ts
type ResultPage<T> = { data: T[] | null; error: { message: string } | null };
async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<ResultPage<T>>,
): Promise<T[]> {
  const output: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error("Could not load complete report data.");
    output.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return output;
  }
}
// Each page callback must use a stable unique order before .range(from, to).
```

Paginated reads can still observe changes between pages; use a single database aggregate for authoritative financial reporting. **Acceptance:** at least 1,001 line items, multiple pages of estimates, empty data and mid-query failures. Never present a partial result as a complete financial report.

## Pillar 6 — Environment and release hygiene

### Passed controls and configuration inventory

| Classification | Variables |
| --- | --- |
| Browser-safe configuration | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| Server credentials | `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_USAGE_API_KEY`, `RESEND_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `SUPABASE_SEND_EMAIL_HOOK_SECRET`, `CRON_SECRET` |
| Private runtime configuration, not credentials | `STRIPE_PRO_PRICE_ID`, `STRIPE_CONNECT_ACCOUNT_COUNTRY`, `GEMINI_MODEL`, `RESEND_NO_REPLY_FROM_EMAIL`, `VERCEL_ENV`, `VERCEL_URL` |
| Local/CI audit and recovery credentials | `GITHUB_TOKEN`, backup database/service credentials, rclone/Restic secrets, `WORKCRAFT_*_ACCESS_TOKEN`, `WORKCRAFT_TEST_SERVICE_ROLE_KEY`, `WORKCRAFT_TEST_CONNECT_WEBHOOK_SECRET`, manual Playwright storage-state files |
| Local/CI non-secret settings | App/marketing base URLs, Playwright/axe/Chrome module paths, backup-age thresholds, restore directory paths, disposable fixture IDs and explicit Staging opt-in flags |

Environment values were not printed. Only `.env.example` is tracked among env files. Client graph scanning, protected ledgers and existing server responses show no newly identified browser secret or raw database/stack-trace leak. Account deletion exceptions are explicitly sanitized by `AccountDeletionError`.

Production and Preview use different Supabase projects. Preview metadata lacks the Production mail hook/sender/webhook/cron configuration and CAPTCHA sitekey. Treat email/CAPTCHA parity as a configuration acceptance item before testing those workflows there; do not copy live keys into a test environment. Preview Stripe tests must use its test keys/secrets and Staging database.

Main's active ruleset requires `Lint, typecheck, and build` and `Supabase database security tests`, blocks force pushes and deletion, and lists no bypass actors. Strict up-to-date-branch enforcement is currently false; merge queue/strict checks are an optional future safeguard when multiple branches are changing concurrently.

The [October 12 scheduled backup](https://github.com/workcraft-ai/workcraftai/actions/runs/38203133113) passed database dump, durable Auth export, policy export, encryption and cleanup. Media download and restore were **skipped**, consistent with the weekly/manual policy. Prior full recovery is documented in `docs/PRODUCTION-READINESS-RELEASE.md`; this audit did not perform another restore or recovered-user login. Schedule implies database RPO around 24 hours and weekly media RPO around seven days; RTO is not proven by a full timed application cutover. No PITR is demonstrated by the free-project backup workflow.

### M5 — Share-token encryption depends on a rotatable service credential

**Severity: Medium. Confirmed rotation coupling, already noted in the release runbook.**

**Reference:** `lib/proposal-sharing.ts:9`, `:31`.

Stored outbound share tokens use AES-GCM with a key derived from `SUPABASE_SERVICE_ROLE_KEY`. Rotating that backend credential makes prior ciphertext unreadable, breaking copy/email operations for those stored token links. Already-copied links still validate against their hash; this is an availability/rotation problem, not a way around authorization.

**Fix before the next service-key rotation:** introduce a dedicated encryption key and versioned envelope/keyring. While the old key remains available, decrypt/re-encrypt existing stored secrets, verify them against their hashes, then switch writes and only retire the old key after migration. Keep token verification hashes independent. Generate/store the new key through the deployment secret manager; never derive it from another provider credential or place it in the browser.

```ts
function configuredShareKey(): Buffer {
  const encoded = process.env.PROPOSAL_SHARE_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Share encryption is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("Invalid share encryption key.");
  return key;
}
```

This helper must ship with envelope versioning and the compatibility migration; switching it alone would break existing records. **Acceptance:** old/new envelopes round-trip, old links remain valid, copying/email works after service-role rotation, revoked links remain rejected.

## Pillar 7 — Marketing and app UI/UX

### Passed observations

The public headline and CTAs explain estimating from a phone and sharing customer approval. The price cards describe $9.99/month Pro and explicit per-account quotas rather than unlimited use. Canonicals, social cards, language alternates, guide sitemaps and Organization/SoftwareApplication structured data are present. Signup/login identify fields and autofill intent; CAPTCHA and generic recovery responses remain.

At 375px the inspected Pro workspaces, proposal and invoice had no page overflow. Bottom navigation consistently uses Dashboard. The dashboard uses mobile estimate cards rather than forcing horizontal table discovery. Customer questions appear on the owner proposal. Existing invoice navigation returns to its originating estimate. The owner sees edit/sharing tools while customer approval/payment actions have a separate share-authorized path. Approval/decline/payment submission itself was not performed.

### M7 — Footer analytics button widens every mobile marketing page

**Severity: Medium. Reproduced in production.**

**References:** `marketing-site/styles.css:62`, `:68`, `:212`; common `.footer-links` component.

At 375px, the footer navigation is 386px wide and reaches x=405; the page becomes horizontally scrollable by 30px. All 26 tested English/Spanish marketing documents share the problem. The added Analytics choices button no longer fits the single unwrapped footer row.

**Fix:** wrap the footer links, allow footer height to grow and keep the analytics control at the requested mobile target size. Do not hide page overflow to mask it.

```css
@media (max-width: 650px) {
  .footer-bottom { height: auto; min-height: 52px; }
  .footer-links {
    min-width: 0;
    flex-wrap: wrap;
    gap: 8px 16px;
  }
  .footer-links a, .analytics-choice {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
  }
  .analytics-actions button { min-height: 48px; }
}
```

**Acceptance:** no page scrollWidth overflow across all published mobile routes in both languages, both before and after analytics consent. Verify keyboard focus and that wrapped links do not overlap copyright or content.

### L1 — Mixed language fragments and stale follow-up labels

**Severity: Low. Reproduced.**

- `app/estimate/new/page.tsx:1030`: English editor renders `Subtotal de partidas:`.
- `app/estimate/new/page.tsx:671`, `app/profile/page.tsx:270`, `:279`: Spanish quota labels contain `left today`/`left this month` or `estimates left today`.
- `app/estimate/new/page.tsx:922`: composed Spanish-description accessible labels retain the English `line item` fallback.
- `app/dashboard/page.tsx:399`, `:479`: an accepted estimate still says its follow-up is scheduled, although the sending job excludes accepted work.

Use complete translated strings with interpolation rather than replacing fragments after rendering. Apply the same translation to accessible labels. For follow-up, show historical sent notices on any status, but show scheduled notices only while the estimate remains pending/open.

```tsx
<span>{language === "es" ? "Subtotal de partidas:" : "Line-item subtotal:"}</span>
```

```ts
const usageLabel = language === "es"
  ? `Quedan ${dailyRemaining} de ${dailyLimit} hoy y ${monthlyRemaining} de ${monthlyLimit} este mes (UTC)`
  : `${dailyRemaining} of ${dailyLimit} left today · ${monthlyRemaining} of ${monthlyLimit} left this month (UTC)`;
const showFollowUp = Boolean(est.followup_sent_at)
  || (est.status.toLowerCase() === "pending" && Boolean(est.followup_at));
```

### L2 — Mobile form text and secondary targets need ergonomic polish

**Severity: Low. Measured controls; native Safari effect not reproduced.**

**References:** `app/schedule/page.tsx:248`, `:250`, `:254`; `app/profile/page.tsx:351`; `app/dashboard/page.tsx:404`; `marketing-site/styles.css:220`.

Schedule inputs use 12px text; Profile/invoice inputs use 14px. Those remain small outdoors and can cause iPhone Safari focus zoom. Some secondary actions/consent buttons are 44px instead of the requested 48px. The global mobile rules already bring many standalone controls to 48px, so source padding alone is not proof a button is too short. Inline text links and checkbox glyph measurements are review flags, not automatic WCAG failures; include the full clickable label when judging a checkbox target.

```css
@media (max-width: 640px) {
  input:not([type="checkbox"]):not([type="radio"]):not([type="color"]),
  select, textarea { font-size: 16px; }
}
```

Use `min-h-12` on standalone secondary mobile controls and preserve 48px width for icon-only buttons. Test the resulting keyboard/viewport behavior on an actual iPhone. Keep body/helper text legible and check gradient/photo backgrounds manually where axe reports incomplete contrast.

## Pillar 8 — Reusable E2E verification

### Delivered files

- `scripts/production-public-checks.mjs`: read-only production health, security rejection and public metadata checks.
- `scripts/launch-readiness-audit.mjs`: Playwright + axe public and optional Free/Pro UI checks; sitemap discovery covers new guides automatically. Expected app-root-to-login redirects are now recognized; off-origin/unexpected redirects still fail. Results contain sanitized layout selectors and no page HTML, credential values or customer names.
- `scripts/launch-storage-isolation.mjs`: direct owner/nonowner estimate, line-item, attachment and private object download checks using two legitimate user sessions and a matching public key; no service-role bypass.
- `scripts/launch-preview-webhooks.mjs`: opt-in synthetic failure/success/duplicate/late-failure delivery against one disposable Staging payment and the Preview Connect signing secret. Creates no Stripe charge; changes the Staging fixture/ledger. Hard guards reject the production hostname/database.

See `docs/PRODUCTION-AUDIT-VERIFICATION.md` for setup, exact boundaries and commands. The scripts existed before this audit; this pass improves discovery and diagnostic coverage instead of creating another overlapping runner.

### Remaining acceptance

1. Two different Free/Pro sessions and a Pro-owned disposable estimate with a dedicated attachment: owner reads succeed; nonowner app API returns 404 and direct RLS reads return no rows; private downloads are denied. Not-found is a deliberate alternative to 403 that avoids confirming record existence.
2. Preview fixture and test signing secret: payment failure, success, duplicate success and a late failure cannot downgrade a successful payment. Source/CI and earlier provider evidence are not a substitute for a fresh current-fixture run.
3. Subscription-backed Pro account: verify cancellation/past-due/recovery without an admin grant masking the downgrade.
4. Native iPhone quick-estimate walkthrough and a customer share link, without approving/paying real work during QA. Time the complete create/review/share path if the product will make a sub-60-second claim.
5. Staging fault injection for H1 and M6, then repeat public checks and the full account matrix after the fixes are deployed.

The manual Free-to-Pro private-editor rejection and Free own-editor positive control are now completed. That does not replace the direct bidirectional RLS/Storage runner or prove that two same-browser tabs have independent authentication cookie stores. The user-owned Pro tab was left open; future requests in a shared browser may use the most recently signed-in account.

## Release order

1. H1 Auth hook delivery contract/deadline and M1 retention permissions.
2. M2 onboarding continuity, M3 accepted-time tax snapshots and M7 mobile footer.
3. M6 total provider deadlines; complete authenticated/payment acceptance.
4. M4 report aggregation/pagination before larger accounts; M5 versioned share encryption before service-key rotation.
5. L1/L2 usability and L3 staged domain enforcement.

Apply additive database changes to Staging first, run focused regression cases, then Production before dependent code. Preserve event ledgers and accepted monetary snapshots on rollback. This audit produced local documentation and verification-script changes; it did not deploy product fixes.

## Remediation follow-up

The owner subsequently authorized implementation and Production release. See `PRODUCTION-READINESS-RELEASE.md` for implementation and deployment evidence; the findings above describe the audited pre-fix version.
