# Production readiness status and remaining release gates

Last full readiness audit: 2026-10-05, before the dedicated estimate-sender release. This is an operational status snapshot, not a claim that every provider delivery or backup has been tested.

## Current verified state

- Production commit: `61d2c500d2cbbbcb7646ded63dcabd2b7580b5b8`.
- `https://workcraftai.com/` returned HTTP 200. `https://app.workcraftai.com/api/health` returned HTTP 200 with app, Supabase Auth, and Supabase database checks all `ok`.
- Production and staging have the same 19 migration names applied through `admin_managed_pro_access`. The latest migration was already present in Production and was applied to Staging; no Production migration was applied as part of this verification pass.
- Local checks against the same source tree as Production passed: lint, 23 unit tests, TypeScript, and Next.js build. `npm audit --omit=dev --audit-level=high` found zero production dependency vulnerabilities.
- On a new disposable local Supabase project, all 6 pgTAP files / 143 assertions passed. Both database concurrency scripts passed: the free estimate cap admitted exactly 5 of 20 simultaneous inserts; AI per-account and global caps admitted exactly the configured 7 and 11 reservations.
- GitHub Actions CI attempt 2 did not run any steps. Both jobs were cancelled after 15 minutes because GitHub could not allocate hosted runners. The latest scheduled availability workflow was also cancelled before checking URLs for the same runner-allocation reason. A hosted green CI run remains outstanding; these runs did not report test failures.
- Stripe Live has two enabled event destinations pointing at `https://app.workcraftai.com/api/webhooks/stripe`: a connected-account destination with payment success/failure/expiration/refund events, and a platform destination with subscription and invoice lifecycle events. Code verifies raw-body signatures and uses durable event-ID idempotency. The Stripe dashboard showed zero Live deliveries in the last seven days, and no test-mode event destinations are configured; no Live payment was created.
- An owner-controlled Gmail inbox received a controlled estimate email in Inbox immediately (per the supplied screenshot). Resend’s message log was not independently checked. Estimate and follow-up messages now use `RESEND_ESTIMATE_FROM_EMAIL` and set Reply-To to the contractor’s account email; the sender value is configured in Vercel Production, but the code change still needs a deployment before production uses it. Support and other operational mail keep using `RESEND_FROM_EMAIL`.
- Supabase Free does not provide automatic backups or PITR. A manual/scheduled logical database export and separate Storage-object backup are possible, but a successful restore has not been verified. Confirm a restorable backup strategy before launch.
- External uptime monitoring is not configured yet. UptimeRobot sent a signup magic link to `support@workcraftai.com`; account verification and monitor creation are waiting on the owner. The repository’s 15-minute GitHub Actions monitor is currently unreliable because GitHub could not assign hosted runners.
- The Supabase security advisor reports the previously accepted leaked-password protection warning. Private service-only tables with RLS enabled and no client policies are default-deny INFO notices; they are not missing public access controls.

## Remaining production gates

1. **Hosted CI:** obtain a successful GitHub Actions run for the current production commit after hosted runners are available. Local lint, typecheck, build, audit, pgTAP, and concurrency checks already passed.
2. **Stripe delivery:** inspect Live event delivery history again after a real customer event occurs. Configure a test-mode destination and connected-account test fixture, then verify success, failure, expiration, and refund processing. Never create a Live charge as a test.
3. **Proposal email:** after the estimate-sender release is live, send one estimate to an owner-controlled test inbox and confirm delivery in Resend from `estimates@workcraftai.com`. Do not use customer addresses.
4. **Monitoring:** click the UptimeRobot signup link sent to `support@workcraftai.com`, then create HTTP monitors for `https://workcraftai.com/` and `https://app.workcraftai.com/api/health`, route outage notifications to a monitored inbox, and configure provider-native usage/error alerts in Vercel, Supabase, Stripe, and Resend. See [the monitoring runbook](OPERATIONS-MONITORING.md).
5. **Backup:** choose and verify a restorable backup strategy. Supabase Free requires owner-managed database exports and separate Storage-object backups; paid Pro provides managed daily backups. Record retention and perform a restore drill before relying on recovery.

These remaining gates need access to GitHub’s runner service, Stripe’s delivery/test UI, Resend’s message log, Vercel/Supabase notification settings, and Supabase backup settings. Close each gate only after recording fresh evidence.

## Automated smoke script

Run `node scripts/production-readiness-smoke.mjs` against localhost or a Vercel branch preview after setting `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and the publishable key. The script checks the health route, key public pages, image alt text, form-control names, and broken ARIA references.

For authenticated checks, provide dedicated Free and Pro test-account credentials through `WORKCRAFT_E2E_FREE_EMAIL`, `WORKCRAFT_E2E_FREE_PASSWORD`, `WORKCRAFT_E2E_PRO_EMAIL`, and `WORKCRAFT_E2E_PRO_PASSWORD`. Set `WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID` to a test estimate and `WORKCRAFT_E2E_ESTIMATE_OWNER` to `free` or `pro` to verify the owner can read it and the other account cannot.

The Stripe webhook checks mutate a payment fixture, so they are disabled by default. Run only against localhost or a `-git-` Vercel branch preview with Stripe **test-mode** credentials, `WORKCRAFT_E2E_ALLOW_FIXTURE_MUTATIONS=1`, and a dedicated pending test payment identified by `WORKCRAFT_E2E_PAYMENT_ID` and `WORKCRAFT_E2E_CONNECT_ACCOUNT_ID`. The script sends signed failure and success events to that fixture; never point this at production or a real payment.

## Rollback

The production hardening migrations are additive or replace function/policy definitions; they do not delete estimate, customer, subscription, or payment rows. If an application deployment must be rolled back, roll back the application while leaving additive database objects in place; the older application can ignore them. Prefer a forward fix for SQL/function issues. Do not drop usage ledgers, acceptance snapshots, webhook idempotency records, or new columns as an ad hoc rollback. Restore a backup only for a verified data-integrity incident, and verify the backup can be restored before depending on it.
