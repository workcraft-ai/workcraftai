# Production readiness release and acceptance checklist

Updated October 10, 2026. This is the current checklist; earlier audits remain historical evidence.

## Implemented and verified

| Pillar | Changes | Evidence / remaining acceptance |
| --- | --- | --- |
| Database | Storage-derived monthly upload accounting, consistent locks, protected pending uploads; server-only payment/outbox/share RPCs | 256 local database assertions; four concurrency suites; all 40 migrations match Production and Staging |
| Auth | Refresh cookies retained on redirects; internal routes protected; generic responses and CAPTCHA retained | Public route checks pass. Authenticated Production API/Storage smoke is blocked by the local Cisco Umbrella certificate chain, not missing credentials |
| Stripe | Serialized payment changes; cumulative refunds never regress; delayed success cannot overwrite full refunds | Local SQL and rolled-back Staging integration tests pass. Provider Test-mode delivery matrix remains separate |
| Email | Durable queued notifications, bounded retries/idempotency, atomic customer-question queue, invoice and early delivery correlation, Spanish follow-ups, scheduled GET/POST support | Signed Production Auth hook, reset inbox delivery, delivery webhook and shared Auth budget increment passed. Contractor estimate/invoice Reply-To acceptance remains separate |
| Workflows | Correct package totals; distinct units/pricing basis; incomplete legacy Price Book entries are suggestions; preserve partial-work quantities; reject ambiguous DST times | Unit and regression tests pass; contractor reviews pricing before sharing |
| Operations | Supabase media CSP; bounded invoice-email body; encrypted full restore drill including Auth and private Storage policies | Backup previously succeeded. New isolated restore workflow must run successfully before recovery is verified |
| UI | Contrast/underlines, 48px standalone controls, current dashboard illustration, English/Spanish changes | 42 public page/viewport/language combinations pass WCAG A/AA automated checks and overflow checks; authenticated screens require browser acceptance |
| Verification | Repeatable browser, security, payment ordering, media, quota, outbox and sharing tests | 62 unit tests, 256 SQL assertions, 5 regression probes; source/build/CI checks accompany release |

Three forward-only migrations were applied to Staging first and Production second. Recorded versions were reconciled only after exact migration-name and SQL-hash comparisons: `20261010181731`, `20261010181741`, `20261010181745`. Latest version is `20261010181745_revocable_proposal_sharing`; both environments have 40 versions. No existing customer records were used as write-test fixtures.

Release `a34bd5d8640b26e93cdd6cd2451870ab09fb941c` reached Ready for both Production sites; its branch Preview deployments were also Ready. Required CI/CodeQL checks passed, and live app/Auth/database health passed. Vercel project and environment-name metadata is accessible; private values are redacted. The owner approved rotating `CRON_SECRET`; Vercel Production was updated and the owner confirmed the matching GitHub repository Actions secret was saved. The deployed notification endpoint accepts that secret (HTTP 200), and [workflow run 38077269341](https://github.com/workcraft-ai/workcraftai/actions/runs/38077269341) passed health and queued-notification retry steps with the GitHub secret. Availability workflow runs every 15 minutes and calls `/api/cron/notifications`; follow-ups accept authorized GET or POST.

The first full encrypted snapshot including durable Auth records and private media completed (`daeb5473`, workflow run `38076309317`). Decryption passed, but recovery stopped because the Storage policy exporter had saved an empty file: Docker was not forwarding heredoc stdin. The follow-up adds `--interactive`, verifies nonempty policy output before encryption, and pins the same Supabase CLI version used by CI/local verification. The exact corrected exporter recovered three policies from the disposable local database. A second full snapshot (`144e2ea3`, run `38087180698`) passed policy export, Auth export, private media backup, encryption and decryption. Its isolated restore failed during database/Auth import. Safe import-part and SQLSTATE diagnostics are being added; no raw SQL, account hashes or row contents are published. Recovery acceptance remains open.

The owner enabled the Send Email Hook. A subsequent phone reset reached Production (HTTP 200); the outbox recorded `sent` and the Resend delivery ledger recorded `delivered`. The owner confirmed receipt on the phone. Earlier Mac requests did not appear in recent Auth logs, consistent with the separately observed Cisco Umbrella connection failure. The reset form previously presented network/provider errors as neutral success; the follow-up keeps account/cooldown responses neutral but displays a localized service error for connection/configuration/provider failures.

## Provider and owner acceptance

1. **Auth email pool — passed:** the signed hook is enabled. One legitimate Production reset was sent, delivered and received; `provider_email_daily_usage` recorded one Auth attempt. Preserve the hook/SMTP configuration securely for recovery.
2. **DMARC — initial record added:** `_dmarc.workcraftai.com` now publishes `v=DMARC1; p=none`, verified through Vercel metadata and public DNS. This is a non-enforcing policy; without `rua` it does not collect aggregate reports. Add a monitored reporting destination before report review and stronger enforcement. Existing SPF, DKIM and MX records were preserved.
3. **Production isolation:** local `.env.production-smoke` and the dedicated photo fixture are present. Cisco Umbrella presents an issuer the local Node/curl trust store rejects (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). Ask IT to install the approved root or allowlist the Production Supabase host, or use an approved network. Keep TLS verification enabled. Then run `node --env-file=.env.production-smoke scripts/production-readiness-smoke.mjs`. This path does not modify estimates, send email, or create charges; it creates sign-in activity and an owner-only signed media URL.
4. **Restore:** run the backup workflow on main with `restore_drill: true`. It creates a full encrypted snapshot, decrypts it in a temporary runner, restores an isolated local Supabase stack, checks Auth/schema compatibility, RLS, owner relationships and private media, and destroys plaintext copies. Two active free cloud projects occupy the organization allowance; no paid project or existing-project pause is authorized. Password/MFA and full app recovery acceptance still need a compatible recovery environment.
5. **Stripe and email:** use disposable Preview Test-mode fixtures and an owner-controlled inbox. Inspect actual provider delivery, duplicate/retry/async/subscription events and contractor Reply-To. Preview currently lacks Resend/Turnstile configuration; do not disable Production CAPTCHA or use live payments to work around it.

The owner previously confirmed monitoring delivery and subscription Terms review. These are owner-confirmed. Policies remain immediate Free downgrade on `past_due`, period-end cancellation, no refunds except where required by law; Zoho is out of scope. Vercel Hobby remains a pre-sales decision; review commercial-use eligibility before selling.

## Sharing and recovery notes

Owners can copy, replace or disable customer proposal links. Existing UUID links remain usable until the owner replaces/disables them. New tokens are hashed for verification and encrypted for outbound email using a domain-separated key derived from the backend service key. Rotating that key can require replacing stored share tokens for future email; the public hash verification remains valid. Disabled/expired customer links cannot read, accept, ask questions or initiate payments. Owner access remains available.

Database changes are additive. Roll back app code through Vercel if needed; do not remove applied migrations, payment/event ledgers or customer data. Restore/cutover requires separate owner approval after recovery acceptance.

## Owner decisions — October 10

The owner accepted the iPhone walkthrough, including the current UI changes. Production two-account app/API/private-media isolation is deferred at the owner’s request; earlier SQL tests are not a replacement for that check. Hosting plan review is deferred at the owner’s request. Neither deferred item is marked passed. Continue backup recovery, Preview Stripe provider acceptance, estimate/invoice inbox and Reply-To verification, and documentation updates.
