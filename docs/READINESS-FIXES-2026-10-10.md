# Readiness fixes — October 10, 2026

The first release, [PR 115](https://github.com/workcraft-ai/workcraftai/pull/115),
merged as `2b9c006` and reached Ready on both Production sites. Its CI checks
passed. The follow-up release adds atomic share authorization, malformed-link
handling, notification read-error feedback and the missing foreign-key indexes.
Both environments use exact repository migration timestamps.

## Changes

- Subscription refreshes use a service-only, per-user database lease. Every
  commit is fenced by its unique lease token and expiration. The authoritative
  Stripe object is fetched after acquiring the lease. A superseded subscription
  event is ignored. Adopting a new subscription requires the reserved Checkout
  attempt and a provider-verified completed session, with creation ordering.
  Older Checkout completion events cannot replace a newer subscription.
- Money calculations use exact decimal ratios and BigInt half-away-from-zero
  rounding to match PostgreSQL numeric. Markup rounds to the stored two decimal
  places; tax rounds to three; deposit precision is preserved. API amount bounds,
  previews, summary deposits, emails and financial totals use the shared helper.
  No new package or AI/provider charge is introduced.
- Explicit zero invoice totals remain zero on screen and in invoice email.
- Resend failed/suppressed events are accepted by the signed handler and stored
  in the delivery inbox and transactional ledger. Dashboard status is associated
  with the most recently sent message; late delayed events cannot replace its
  terminal result. English and Spanish labels cover desktop and mobile.
- Forgot-password helper text has a light token scoped to the dark Auth surface.
  Resources breadcrumbs, dates and featured sample caption use a darker token.

## Release sequence

1. Reconcile this older local checkout with current main while preserving the
   existing uncommitted mobile/marketing work. This patch does not remove that
   work or replace the current deployed notification/decline feature.
2. Apply `20261011013952_readiness_billing_money_delivery_fixes.sql` to Staging
   first, then Production after verification. It adds service-only subscription
   lease functions, ordering columns and supported delivery states. Existing
   subscriptions remain intact. Do not deploy the new handler before this SQL.
3. Deploy the updated app and marketing site. Do not roll back the additive SQL
   to roll back code. Old webhook code's unconditional upsert is not a safe
   billing rollback; disable that webhook temporarily or retain the new guard.
4. Add `email.failed` and `email.suppressed` to the existing Resend delivery
   webhook subscription, preserving its endpoint, signing secret and other
   events. Do this after the migrated handler is live.

## Verification status

All 73 JavaScript tests, TypeScript and production build checks pass. Full
ESLint reports zero errors and two existing NotificationBell effect warnings.
The rollback-only local database suite passed; the new subscription/delivery
regression suite adds 18 passing assertions. Staging rollback-only checks
verified subscription replacement ordering, old Checkout/event rejection,
concurrent lease exclusion, expired-worker fencing, immediate past_due updates
and failed/suppressed event idempotency. No test fixtures were retained.

Signed-in browser, live customer email and live payment tests remain outside
this verification pass. Production public-browser and HTTP checks will be
rerun after deployment.

Release acceptance cases: old canceled A after active B; delayed Checkout A
after B; overlapping refreshes; expired-worker fencing; immediate past_due
downgrade without admin overrides; 0.15 × 2.30 = 35 cents; 0.25 × 0.58 = 15 cents;
1.005 = 101 cents; three-decimal tax; zero invoice with nonzero original lines;
failed/suppressed before send recording; duplicate and out-of-order email events;
new resend after a prior failure; 375/768/1280 px contrast in both languages.

The documentation request through the CLI was blocked by automatic approval
review's usage-limit failure. It did not execute. Local edits and read-only
provider catalog inspection continued; no approval restriction was bypassed.

## Production verification and follow-up

- First live pass: all 102 public English/Spanish page combinations passed
  automated WCAG A/AA, navigation, locale and overflow checks at 375, 768 and
  1280 px. Twelve API rejection/health checks and four robots/sitemap checks
  passed. Three additional malformed-link probes reproduced HTTP 500/502; the
  follow-up rejects those links before querying the database.
- Resend's existing enabled endpoint now subscribes to delivered, delayed,
  bounced, complained, failed and suppressed events; the endpoint and secret
  were preserved.
- The follow-up adds service-only wrappers for customer acceptance, decline,
  questions and payment preparation. They acquire the advisory lock then the
  estimate row lock, recheck token/revocation/expiry using clock time, and retain
  the lock through the mutation. Legacy UUID links remain usable only while no
  replacement token exists and the link is neither revoked nor expired.
- A two-session local test held the revocation transaction open while acceptance
  waited, then confirmed the stale link was rejected after revocation committed.
  All four wrappers also rejected revoked links in rollback-only Staging tests.
- Twelve missing foreign-key indexes were added after inspecting the small
  affected tables. Old internal RPCs remain service-only for rollout compatibility.
- Notification read failures show translated feedback without blocking estimate
  navigation; effect lint warnings were removed. Guide breadcrumbs and notification
  controls have 48 px tap targets.
- Follow-up validation: 75 JavaScript tests, 286 rollback-only database assertions,
  TypeScript, clean ESLint and production build pass.

Final release verification commands: `node scripts/production-public-checks.mjs`
and `node scripts/launch-readiness-audit.mjs` with local Playwright/axe paths.
Sanitized browser evidence is written to ignored `.audit-results/launch-readiness.json`.
Four groups are explicitly skipped without current owner-provided manual-session
fixtures: signed-in Free, signed-in Pro, direct two-account RLS/Storage, and the
opt-in Preview Stripe state-changing simulation. No CAPTCHA bypass, live charge,
customer email, or Production write-test fixture is part of these checks. Live
provider inbox/checkout and recovery-login acceptance are separate from these
automated public checks. Preview mail/CAPTCHA parity and plan-dependent leaked
password protection remain owner configuration items; no paid upgrade was made.
