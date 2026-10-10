# Production readiness release and acceptance checklist

Updated October 10, 2026. This is the current checklist; earlier audits remain historical evidence.

## Implemented and verified

| Pillar | Changes | Evidence / remaining acceptance |
| --- | --- | --- |
| Database | Storage-derived monthly upload accounting, consistent locks, protected pending uploads; server-only payment/outbox/share RPCs | 256 local database assertions; four concurrency suites; all 40 migrations match Production and Staging |
| Auth | Refresh cookies retained on redirects; internal routes protected; generic responses and CAPTCHA retained | Public route checks pass. Authenticated Production API/Storage smoke is blocked by the local Cisco Umbrella certificate chain, not missing credentials |
| Stripe | Serialized payment changes; cumulative refunds never regress; delayed success cannot overwrite full refunds | Local SQL and rolled-back Staging integration tests pass. Provider Test-mode delivery matrix remains separate |
| Email | Durable queued notifications, bounded retries/idempotency, atomic customer-question queue, invoice and early delivery correlation, Spanish follow-ups, scheduled GET/POST support | Database regressions pass. Shared Auth/billing allowance requires Send Email Hook activation; actual inbox/header acceptance remains separate |
| Workflows | Correct package totals; distinct units/pricing basis; incomplete legacy Price Book entries are suggestions; preserve partial-work quantities; reject ambiguous DST times | Unit and regression tests pass; contractor reviews pricing before sharing |
| Operations | Supabase media CSP; bounded invoice-email body; encrypted full restore drill including Auth and private Storage policies | Backup previously succeeded. New isolated restore workflow must run successfully before recovery is verified |
| UI | Contrast/underlines, 48px standalone controls, current dashboard illustration, English/Spanish changes | 42 public page/viewport/language combinations pass WCAG A/AA automated checks and overflow checks; authenticated screens require browser acceptance |
| Verification | Repeatable browser, security, payment ordering, media, quota, outbox and sharing tests | 60 unit tests, 256 SQL assertions, 5 regression probes; source/build/CI checks accompany release |

Three forward-only migrations were applied to Staging first and Production second. Recorded versions were reconciled only after exact migration-name and SQL-hash comparisons: `20261010181731`, `20261010181741`, `20261010181745`. Latest version is `20261010181745_revocable_proposal_sharing`; both environments have 40 versions. No existing customer records were used as write-test fixtures.

Vercel project and environment-name metadata is accessible. Private values are redacted. The owner approved rotating `CRON_SECRET`; Vercel Production was updated and the owner confirmed the matching GitHub repository Actions secret was saved. A new deployment is required to load the value. Availability workflow runs every 15 minutes and calls `/api/cron/notifications`; follow-ups accept authorized GET or POST.

## Provider and owner acceptance

1. **Auth email pool:** configure the signed Supabase Send Email Hook and matching server-only `SUPABASE_SEND_EMAIL_HOOK_SECRET` in Vercel Production. Deploy the variable first; enable the hook second, so signup/reset mail is not interrupted. Until enabled, existing custom SMTP Auth mail bypasses the app's shared provider counter. See the monitoring runbook.
2. **DMARC:** add a DNS TXT record named `_dmarc` with `v=DMARC1; p=none` initially. Add a `rua` reporting address only if a monitored reporting mailbox is available. Inspect reports before tightening policy. The DNS connector replaces the entire zone; do not use it blindly to add one record.
3. **Production isolation:** local `.env.production-smoke` and the dedicated photo fixture are present. Cisco Umbrella presents an issuer the local Node/curl trust store rejects (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). Ask IT to install the approved root or allowlist the Production Supabase host, or use an approved network. Keep TLS verification enabled. Then run `node --env-file=.env.production-smoke scripts/production-readiness-smoke.mjs`. This path does not modify estimates, send email, or create charges; it creates sign-in activity and an owner-only signed media URL.
4. **Restore:** run the backup workflow on main with `restore_drill: true`. It creates a full encrypted snapshot, decrypts it in a temporary runner, restores an isolated local Supabase stack, checks Auth/schema compatibility, RLS, owner relationships and private media, and destroys plaintext copies. Two active free cloud projects occupy the organization allowance; no paid project or existing-project pause is authorized. Password/MFA and full app recovery acceptance still need a compatible recovery environment.
5. **Stripe and email:** use disposable Preview Test-mode fixtures and an owner-controlled inbox. Inspect actual provider delivery, duplicate/retry/async/subscription events and contractor Reply-To. Preview currently lacks Resend/Turnstile configuration; do not disable Production CAPTCHA or use live payments to work around it.

The owner previously confirmed monitoring delivery and subscription Terms review. These are owner-confirmed. Policies remain immediate Free downgrade on `past_due`, period-end cancellation, no refunds except where required by law; Zoho is out of scope. Vercel Hobby remains a pre-sales decision; review commercial-use eligibility before selling.

## Sharing and recovery notes

Owners can copy, replace or disable customer proposal links. Existing UUID links remain usable until the owner replaces/disables them. New tokens are hashed for verification and encrypted for outbound email using a domain-separated key derived from the backend service key. Rotating that key can require replacing stored share tokens for future email; the public hash verification remains valid. Disabled/expired customer links cannot read, accept, ask questions or initiate payments. Owner access remains available.

Database changes are additive. Roll back app code through Vercel if needed; do not remove applied migrations, payment/event ledgers or customer data. Restore/cutover requires separate owner approval after recovery acceptance.
