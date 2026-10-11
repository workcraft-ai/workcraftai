# Readiness fixes — October 10, 2026

The release patch is prepared on `codex/readiness-billing-money-delivery`,
reconciled with the latest deployed notification, decline and mobile features.
Staging has migration `20261011013952`; Production deployment is pending.

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
