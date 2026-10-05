# Production-readiness hardening release

This release adds atomic estimate/line-item writes, immutable proposal acceptance records, stricter pending-estimate write policies, durable Stripe webhook idempotency, bounded Pro email and global AI usage, atomic customer-question/follow-up handling, an estimate-media storage quota, and a database-backed health probe.

## Before release

1. Confirm a current Supabase backup exists and apply the changes to a non-production Supabase project first.
2. Review the SQL diffs in order:
   - `20261005010742_secure_proposal_estimate_integrity.sql`
   - `20261005010758_durable_webhook_email_limits.sql`
3. Run `npm run lint`, `npm run typecheck`, `npm test`, and all `supabase/tests/database` pgTAP tests against the staging database.
4. Confirm Vercel Production has the required server-only keys: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `GEMINI_API_KEY`, and `CRON_SECRET` where each feature is enabled. Public-prefixed variables must contain no secrets.
5. In Stripe, ensure the Connect webhook listens for `checkout.session.async_payment_failed` and `payment_intent.payment_failed` in addition to the events documented in the README. Verify the endpoint is a Connected accounts destination and that its signing secret is set as `STRIPE_CONNECT_WEBHOOK_SECRET`.
6. Confirm the target production Supabase project is the intended live project, then schedule the database change before deploying the application code that depends on it.

## Automated smoke script

Run `node scripts/production-readiness-smoke.mjs` against localhost or a Vercel branch preview after setting `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and the publishable key. The script checks the health route, key public pages, image alt text, form-control names, and broken ARIA references.

For authenticated checks, provide dedicated Free and Pro test-account credentials through `WORKCRAFT_E2E_FREE_EMAIL`, `WORKCRAFT_E2E_FREE_PASSWORD`, `WORKCRAFT_E2E_PRO_EMAIL`, and `WORKCRAFT_E2E_PRO_PASSWORD`. Set `WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID` to a test estimate and `WORKCRAFT_E2E_ESTIMATE_OWNER` to `free` or `pro` to verify the owner can read it and the other account cannot.

The Stripe webhook checks mutate a payment fixture, so they are disabled by default. To run them, use a localhost or `-git-` Vercel branch-preview URL, Stripe **test-mode** credentials, `WORKCRAFT_E2E_ALLOW_FIXTURE_MUTATIONS=1`, and a dedicated pending test payment identified by `WORKCRAFT_E2E_PAYMENT_ID` and `WORKCRAFT_E2E_CONNECT_ACCOUNT_ID`. The script sends signed failure and success events to that fixture; never point this at production or a real payment.

## Apply and deploy

Apply both SQL migrations to the intended Supabase project in timestamp order, confirm they complete, then deploy the application. Do not deploy the code first: the health route and API paths expect the new database functions and tables. After deployment:

- check `/api/health` for `status: "ok"`, including `supabaseAuth` and `supabaseDatabase`;
- sign in with a Free and a Pro test account;
- verify Free users receive a server-side denial for Pro cloud drafting and estimate email;
- create, edit, share, approve, and (in Stripe test mode) pay a test estimate;
- deliver test connected-account success, failure, expiration, and refund events;
- verify estimate ownership isolation with two test accounts;
- confirm the AI platform counter and per-account email counter increment as expected.

Use dedicated test accounts and synthetic customer data. Do not test payment or destructive account flows against real customer records.

## Rollback

The migrations are additive or replace function/policy definitions and do not delete estimate, customer, subscription, or payment rows. If the application deployment must be rolled back, roll back the application while leaving the additive database objects in place; the older application version can ignore them. Prefer a forward fix for SQL/function issues. Do not drop usage ledgers, acceptance snapshots, webhook idempotency records, or newly added columns as an ad hoc rollback. Restore a database backup only if a verified data-integrity incident requires it.

## Items requiring owner action

- Apply and verify the SQL migrations against production; the code agent has not applied them.
- Verify Vercel Production environment values and the linked Supabase project in the dashboard.
- Add the two payment-failure events to the Stripe Connected accounts endpoint and confirm webhook delivery.
- Complete production smoke tests with dedicated test accounts and Stripe test-mode fixtures.
- Zoho currently has no application integration code; it needs a separate product/integration decision before credentials are configured.
