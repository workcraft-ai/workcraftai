# Production readiness status and remaining release gates

Last full operational readiness audit: 2026-10-05. The production-readiness code fixes and legal-page localization follow-up were deployed on 2026-10-06. This is not a claim that every provider delivery, backup, or cross-account production scenario has been tested.

## Current release verified on 2026-10-06

- Production commit: `af562129e36e4f07bf7abdb7d4802e9164eff9c0` (PRs [#62](https://github.com/workcraft-ai/workcraftai/pull/62) and [#63](https://github.com/workcraft-ai/workcraftai/pull/63)). GitHub reported successful Vercel production checks for both `workcraftai-app` and `workcraftai-company-site`.
- Local verification on the shipped changes: 28 unit tests passed; lint, TypeScript, and the Next.js 16.3.6 webpack production build passed.
- Live browser verification: the signed-in estimate form displayed the $0 line-item review confirmation when a described line was temporarily entered; the unsaved input was cleared and no estimate was submitted. Privacy and Terms both rendered their full text in Spanish after selecting Spanish; the test account’s language was restored to English.
- The audit changes did not apply a database migration or alter production data. The RLS regression test now scans every public base/partitioned table, so it does not rely on a manually maintained table-name list.
- The production CSP remains **Report-Only** so a strict policy cannot accidentally block the app while external image, payment, font, and authentication flows are observed. No CSP report collector is configured yet; review browser console reports before considering enforcement.
- The Vercel API integration returned 403 during this review, so production environment variables and deployment logs could not be inspected directly. The successful GitHub Vercel deployment checks and live app pages were verified instead.

## Operational state last independently checked on 2026-10-05

- Production and Staging were reported to have the same 19 migration names applied through `admin_managed_pro_access`; later migrations were not checked in this release. Confirm their current histories before applying anything manually.
- A previous disposable local Supabase run passed 6 pgTAP files / 143 assertions. The free estimate cap admitted exactly 5 of 20 simultaneous inserts; AI per-account and global caps admitted the configured 7 and 11 reservations. These are historical results, not a fresh production isolation test.
- Stripe Live had separate connected-account and platform event destinations for customer payments and subscription lifecycle events. Signature verification and durable event-ID idempotency are implemented. No test-mode event destination/connected-account fixture was verified, and no Live charge was created.
- Estimate email uses `WorkCraft AI <estimates@workcraftai.com>` with Reply-To set to the contractor’s account email. An earlier owner-controlled inbox received a message, but the Resend log and delivery webhook still need a fresh check.
- The encrypted Google Drive backup workflow and 30-day retention are documented, but activation secrets, the first backup, and a restore drill were not verified.
- UptimeRobot and provider-native usage/error alerts were not verified. A previous availability workflow was canceled before it checked URLs because no hosted runner was assigned.
- Supabase’s security advisor showed the previously accepted leaked-password-protection warning. Service-only tables with RLS and no client policies are default-deny; that is expected.

## Remaining production gates

1. **Supabase migration history:** check Production and Staging through `20261006170000_estimate_status_tracking` and resolve any timestamp/name mismatch using the reviewed reconciliation process. Do not apply a migration until its effects and current history are confirmed.
2. **Stripe test flows:** configure a test-mode destination and connected-account test fixture, then verify payment success, failure, expiration, refund, and subscription lifecycle processing. Never create a Live charge as a test.
3. **Estimate email and Resend events:** send one estimate to an owner-controlled test inbox and confirm delivery in Resend from `estimates@workcraftai.com` with Reply-To set to the contractor. Reconfirm `RESEND_WEBHOOK_SECRET` in Vercel Production, configure the delivery events, and verify that an estimate’s delivery status updates. Do not use customer addresses.
4. **Monitoring:** finish UptimeRobot signup, create HTTP monitors for `https://workcraftai.com/` and `https://app.workcraftai.com/api/health`, route outage notices to a monitored inbox, and configure provider usage/error alerts in Vercel, Supabase, Stripe, and Resend. See [the monitoring runbook](OPERATIONS-MONITORING.md).
5. **Backup:** add the five GitHub Actions secrets in [the backup runbook](OPERATIONS-BACKUPS.md), run a full database-and-media backup, and complete a restore drill into a new Supabase project. Supabase Free does not include managed daily backups or PITR; this owner-managed workflow is not active until its secrets are set.
6. **Search discovery:** verify `workcraftai.com` as a Domain property in Google Search Console, submit both sitemaps, and inspect canonical/indexing results for the marketing home, support, privacy, and terms pages. This requires the owner-controlled Google account and DNS verification; submission does not guarantee indexing. See [the marketing guide](WORKCRAFT-AI-MARKETING-GUIDE.md#step-4-set-up-google-discovery-for-free).
7. **Terms review:** the current Terms do not describe every subscription renewal, cancellation, and refund scenario. Confirm the actual policy and have counsel review before treating the terms as final; no policy language was invented in this code update.
8. **Zoho scope:** no Zoho API integration was found in the repository, so OAuth storage/refresh and API timeout behavior could not be audited. Confirm whether Zoho integration is still a product requirement.

These remaining gates need access to GitHub’s runner service, Stripe’s delivery/test UI, Resend’s message log, Vercel/Supabase notification settings, Supabase backup settings, and the owner-controlled Google Search Console account/domain DNS. Close each gate only after recording fresh evidence.

## Automated smoke script

Run `node scripts/production-readiness-smoke.mjs` against localhost or a Vercel branch preview after setting `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and the publishable key. The script checks the health route, key public pages, image alt text, form-control names, and broken ARIA references.

For authenticated checks, provide dedicated Free and Pro test-account credentials through `WORKCRAFT_E2E_FREE_EMAIL`, `WORKCRAFT_E2E_FREE_PASSWORD`, `WORKCRAFT_E2E_PRO_EMAIL`, and `WORKCRAFT_E2E_PRO_PASSWORD`. Set `WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID` to a test estimate and `WORKCRAFT_E2E_ESTIMATE_OWNER` to `free` or `pro` to verify the owner can read it and the other account cannot.

The Stripe webhook checks mutate a payment fixture, so they are disabled by default. Run only against localhost or a `-git-` Vercel branch preview with Stripe **test-mode** credentials, `WORKCRAFT_E2E_ALLOW_FIXTURE_MUTATIONS=1`, and a dedicated pending test payment identified by `WORKCRAFT_E2E_PAYMENT_ID` and `WORKCRAFT_E2E_CONNECT_ACCOUNT_ID`. The script sends signed failure and success events to that fixture; never point this at production or a real payment.

## Rollback

The production hardening migrations are additive or replace function/policy definitions; they do not delete estimate, customer, subscription, or payment rows. If an application deployment must be rolled back, roll back the application while leaving additive database objects in place; the older application can ignore them. Prefer a forward fix for SQL/function issues. Do not drop usage ledgers, acceptance snapshots, webhook idempotency records, or new columns as an ad hoc rollback. Restore a backup only for a verified data-integrity incident, and verify the backup can be restored before depending on it.
