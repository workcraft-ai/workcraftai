> Current implementation and acceptance status: [release checklist](PRODUCTION-READINESS-RELEASE.md). Historical delivery observations below are not new failed tests.

# WorkCraft AI monitoring and incident checklist

Last refreshed: 2026-10-12. This runbook contains no credentials or customer data. Mark an alert as verified only after its test notification has reached the intended monitored inbox.

## Current verified state

| Area | Verified state | Remaining evidence |
| --- | --- | --- |
| Public availability | UptimeRobot monitors the site and app health at five-minute intervals. The owner confirmed test, outage/recovery and provider alert delivery. | Review provider configuration periodically. |
| Database migrations | Production and Staging have matching 40 versions through `20261010181745_revocable_proposal_sharing`. Server-only claim/payment/outbox/share RPCs are installed. | Reconfirm histories after future migrations. |
| Vercel | Connected project and environment-name metadata is accessible; private values are redacted. Reviewed release `7ef5757` reached Ready for the app Production project. | Hosting plan review is deferred by the owner. |
| Stripe | October 10 Preview provider tests verified async success, in-flight 503, stale-claim recovery, duplicate 200, late failure/expiry preservation, subscription activation/past-due/recovery/cancellation, and cumulative USD refunds with stale replays. See the provider evidence report. | Full checkout UI/effective Free entitlement and billing-email inbox acceptance are separate. |
| Resend | Estimate email on October 10 21:46 UTC was delivered; From is WorkCraft AI no-reply and Reply-To is the contractor. Both sent and delivered appear in the Production ledger. Auth reset delivery was also confirmed. | Invoice send-from-app is pending owner login; Preview billing queuing passed, but delivery needs Preview Resend configuration. The obsolete test queue row was removed. |
| UptimeRobot | Both monitors and alert delivery are owner-confirmed. | Periodic monitor and destination review. |
| Backups | Corrected Auth separation passes a fresh local fixture restore. Guarded run `38092126519` decrypted and restored database/Auth, 40 migrations, private policies and all 3 private media files after the owner corrected Storage secrets. | Password/MFA sign-in and full recovery-app acceptance remain separate. |
| Billing policy | Immediate past-due downgrade, period-end cancellation, and no refunds except where law requires are owner-approved; subscription state transitions and queued notice passed Preview tests. Terms review is owner-confirmed. | Billing-email inbox acceptance remains pending Preview mail configuration. |
| Scope | Zoho is no longer in scope. | No Zoho integration work is required. |

## Availability checks

The repository contains `.github/workflows/availability.yml`, scheduled every 15 minutes and manually runnable. It checks the public home page and the app health endpoint. Treat this workflow as a secondary signal; its success does not prove the owner receives external outage alerts.

The UptimeRobot free plan currently checks every five minutes. Monitors are configured for:

1. `https://workcraftai.com/`
2. `https://app.workcraftai.com/api/health`

Both monitors currently show **Up**, 100% uptime, and no incidents in the last 24 hours. The owner confirmed both UptimeRobot test emails arrived at `support@workcraftai.com`. The owner has confirmed monitoring delivery; provider-native configuration should still be reviewed periodically. A health monitor does not detect a bad Stripe signing secret, Resend quota exhaustion, Gemini provider failure, or a subscription billing issue.

## Automated operational alerts

The application and GitHub workflow changes add two server-side monitors:

- The 15-minute Availability monitor checks aggregate Production records for failed or stuck Stripe webhook processing, failed/overdue/stuck notification outbox rows, and recent Resend failure, suppression, bounce, complaint, or long-delay events. It prints counts and a suggested response in the Actions run and fails the job when an issue needs attention.
- A daily audit at 07:15 UTC checks the latest successful encrypted database/Auth snapshot (26-hour freshness target) and private-media snapshot (8-day target). It also fails when Resend provider email usage reaches 80% of its live daily/monthly limit, or when app-enforced Resend admission pools or the global AI allowance reach 80% of their daily allocation. The workflow token is read-only (`actions: read`, `contents: read`); it uses the existing `CRON_SECRET` for the Production aggregate endpoint.

Resend usage comes from the provider's `GET /usage` endpoint, using the existing server-only `RESEND_API_KEY`; the endpoint requires a full-access key. It reports the provider's live daily and monthly email usage and limits. If the key cannot read usage, the daily audit calls that out and points to the Resend Usage page. App mail and AI counters are **application admission allocations**, not billing totals. They help identify when WorkCraft AI's own caps are near; the Gemini warning still reflects the app-enforced global cap and must be compared with Gemini's provider console. This change does not create provider console alert rules or change Vercel/Supabase/Resend/Gemini plans. See [Resend's Account Usage API](https://www.resend.com/changelog/account-usage-api).

The main branch ruleset is active and requires both CI status checks: `Lint, typecheck, and build` and `Supabase database security tests`. The ruleset does not require the branch to be up to date with `main`. Keep the required CI contexts unchanged when editing workflow names.

Webhook request and outbound service calls now have explicit bounds: raw request bodies time out after 8–10 seconds, Supabase REST calls after 5 seconds, Stripe calls after 8 seconds with no internal retry, and Resend event handling has a 15-second function budget. The Supabase Auth email hook has a 30-second budget and bounded 5-second database requests; its Resend attempt remains limited to 3 seconds. Stripe retries transient server/network failures, and the existing idempotent event claim protects retried work. The Vercel route budgets are within the current Hobby function duration ceiling.

These GitHub Actions failure notifications can be delivered only according to repository notification settings. The owner has already received workflow failure emails. After the code is merged and deployed, manually run **Availability monitor** and **Daily operations audit** once to verify the new steps and confirm the failure-notification path if desired; do not induce production webhook or backup failures just to test alerts.

Read-only Production snapshot on 2026-10-12: no failed Stripe webhook rows or failed notification outbox rows; app mail pool 1/75, Auth pool 2/20, AI pool 0/250. Resend's account usage API reported 3/100 daily emails and 124/3,000 monthly emails. This point-in-time sample does not prove alert delivery.

## Provider usage and error alerts

Route provider and monitoring notifications to the owner-controlled `alerts@workcraftai.com` inbox (or an alias that forwards to it). Keep each provider's own authenticated sender identity; `alerts@` is the receiving address, not a replacement From address for UptimeRobot, GitHub, Vercel, Supabase, Stripe, or Resend. The app sends its own automated notices through Resend using `WorkCraft AI <no-reply@workcraftai.com>`. For the address roles and remaining setup, see [`EMAIL-ADDRESS-ROLES.md`](EMAIL-ADDRESS-ROLES.md).

Configure provider-native alerts where available. Confirm each by checking the destination and, where supported, sending a test alert. Thresholds can vary by plan and provider policy; review the current dashboard before relying on a notification or enabling paid usage.

| Provider | Review | Alert/response |
| --- | --- | --- |
| Vercel | Connected project and environment-name metadata is accessible; private values are redacted. Reviewed release `7ef5757` reached Ready for the app Production project. | Hosting plan review is deferred by the owner. |
| Supabase | Database size, egress, Storage, Auth/API usage, project health, and backup availability. | Enable available usage notifications. A successful health check is not a backup or restore test. |
| Stripe | October 10 Preview provider tests verified async success, in-flight 503, stale-claim recovery, duplicate 200, late failure/expiry preservation, subscription activation/past-due/recovery/cancellation, and cumulative USD refunds with stale replays. See the provider evidence report. | Full checkout UI/effective Free entitlement and billing-email inbox acceptance are separate. |
| Resend | Estimate email on October 10 21:46 UTC was delivered; From is WorkCraft AI no-reply and Reply-To is the contractor. Both sent and delivered appear in the Production ledger. Auth reset delivery was also confirmed. The Operations API check reads provider daily/monthly quotas. | Invoice send-from-app is pending owner login; Preview billing queuing passed, but delivery needs Preview Resend configuration. Confirm the Vercel `RESEND_API_KEY` has full-access permission so the Usage API check succeeds. |
| Gemini | Model usage, quota, and provider errors. | The app enforces per-account and global daily generation limits; also monitor provider-level quotas. |

## Backups and usage limits

The encrypted backup workflow stores its Restic repository in the owner-controlled Google Drive account. Daily snapshots include database data plus a separate Auth account export; private estimate media is included weekly. Drive storage is shared with Gmail and Photos; low space or an expired OAuth grant can fail a run. Run `38091235906` exposed a zero-file download despite three Production objects. After the owner corrected Storage secrets, guarded run `38092126519` passed: encrypted snapshot `db1f793c` restored database/Auth, private policies and all three media files, with file byte counts and public-access denial checked. Password/MFA and full recovery-app acceptance remain separate. See the backup runbook. Configure these GitHub Actions repository secrets without sharing them in chat or committing them: `PROD_SUPABASE_DB_URL`, `PROD_SUPABASE_URL`, `PROD_SUPABASE_SERVICE_ROLE_KEY`, `RCLONE_CONFIG_B64`, and `RESTIC_PASSWORD`. Enable GitHub Actions failure notifications and investigate before the last known-good backup ages out. Restic retains 30 daily snapshots; changes to media since the previous full-media run may not be recoverable.

The app also has durable application-level controls:

- Free accounts can save 10 estimates per UTC day and 50 per UTC month. Pro accounts can save 50 per day and 500 per month.
- Pro cloud AI has a 5/day and 50/month account limit; the platform-wide ceiling remains 250 attempts per UTC day. Attempts count when admitted, including provider failures.
- Pro estimate emails, follow-ups, proposal-question alerts, and invoice emails share a 5/day and 100/month account allowance. All app mail shares the 75/day global Resend ceiling (admin-adjustable up to 75); support and retention messages use only that shared platform pool.
- Pro private media permits 100 MB uploaded per UTC month, 250 MB retained, and 100 files. Deleting media frees retained capacity but not the monthly upload allowance.
- Public support submissions are rate-limited.

All account caps are enforced server-side with durable Postgres counters and storage reservations, and reset on UTC calendar boundaries. Customers can see remaining allowances in Profile and at estimate/AI creation points. Provider-wide service limits can still bind before a user's account quota does. Vercel remains on Hobby until the product begins selling; revisit its plan and current quotas before commercial launch. Gemini remains on its configured provider tier and existing data-handling setup; app caps bound use but do not change the provider plan or processing terms.

These controls reduce abuse and bound feature use. They do not replace provider usage alerts or periodic restore tests.

## Auth abuse resistance and email verification

The signup, sign-in, and password-reset forms use Cloudflare Turnstile. Supabase remains responsible for short-lived IP-based Auth throttling; the application does not impose permanent lockouts after failed passwords or reset requests. The signup page returns the same confirmation guidance for a newly eligible address and a duplicate-account response. Password-reset requests use a generic response, and Auth provider errors are not rendered directly to users. Keep these behaviors when changing the auth UI.

Verified dashboard state on 2026-10-09:

| Setting | Production | Preview |
| --- | --- | --- |
| Auth rate limits | 30 signup/sign-in requests per 5 minutes; 30 verification requests per 5 minutes; 150 token refreshes per 5 minutes | Same values |
| Per-address auth email cooldown | 60 seconds in SMTP settings | Supabase documents 60 seconds by default |
| Project Auth email limit | 30 emails per hour | 2 emails per hour |
| New user signup / email confirmation | Enabled / enabled | Enabled / enabled |
| Custom SMTP | Enabled; Resend SMTP; minimum interval per user is 60 seconds | Disabled; uses Supabase's built-in email provider |

Dashboard links: [Production Rate Limits](https://supabase.com/dashboard/project/ivioejiiigtbmhpzjuni/auth/rate-limits), [Preview Rate Limits](https://supabase.com/dashboard/project/wuebymyvhzieockrohyp/auth/rate-limits), [Production SMTP](https://supabase.com/dashboard/project/ivioejiiigtbmhpzjuni/auth/smtp), [Preview SMTP](https://supabase.com/dashboard/project/wuebymyvhzieockrohyp/auth/smtp), and each project's Authentication → Sign In / Providers and Authentication → Audit Logs pages.

Preview's built-in mailer is limited to 2 emails per hour project-wide. Do not repeatedly test signup confirmations or password resets there; use a disposable address sparingly. If Preview auth-email delivery needs regular testing, the owner should configure Preview custom SMTP with the approved provider and verify delivery there. Production uses Resend SMTP and is limited to 30 Auth emails per hour. Supabase documents a 60-second default cooldown between auth email sends to one address, while project IP limits and email-provider limits are separate controls. Its documented default custom-SMTP limit is 30 new users per hour. See [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

During weekly operations review, inspect Supabase Authentication → Audit Logs and Auth logs for bursts of signup, recovery, and verification requests, repeated `429` responses, and failed CAPTCHA checks. Then inspect Resend's email logs, suppression/bounce/complaint events, and usage for auth verification and recovery messages. Supabase Auth emails sent through Resend SMTP are not the same as estimate-email events in the WorkCraft AI dashboard. Never manually ban an account solely because it received failed login or reset attempts; use CAPTCHA, the configured cooldowns, and provider IP throttling. Escalate suspicious traffic using aggregate timestamps and counts, not customer email addresses or message contents.

## Stripe event coverage and retry semantics

Stripe verifies the exact raw body against the destination signing secret. October 10 provider tests returned 503 for an in-flight fixture, recovered the claim after five minutes, and acknowledged the completed duplicate with 200 and `duplicate: true`. The Stage ledger recorded two processing attempts with no error. This intentionally induced 503 is expected test evidence, not an unresolved outage.

The dedicated Preview destinations target `https://workcraftai-2najy4m4h-workcraftai.vercel.app/api/webhooks/stripe`. Both retain their signing secrets and Test-mode scope. Connected async Checkout success and late failure/expiry were delivered; the successful fixture did not regress. A matching $1 USD PaymentIntent refunded first 50 cents and then 100 cumulative cents; stale partial-refund and success events were reprocessed and preserved `refunded` / 100 cents. Subscription create, past-due renewal failure, paid recovery, period-end cancellation and deletion reached the Stage ledger. Invoice reference parsing supports current and legacy webhook formats. Never send these fixtures to Production or use a live charge.

See [provider acceptance evidence](PROVIDER-ACCEPTANCE-2026-10-10.md) for limits and fixture identifiers. Provider event/state tests do not replace a signed-in checkout walkthrough. The designated Stage account has an admin Pro grant, so its effective access does not become Free during billing-state tests.

## Email verification

The October 10 21:46 UTC estimate message was delivered in Resend and correlated to `sent`/`delivered` Production transactional events. Headers confirmed `WorkCraft AI <no-reply@workcraftai.com>` and the contractor as Reply-To. A fresh invoice send-from-app is pending because the owner could not sign in during this session. The invoice route checks the owner and Pro entitlement, applies shared quotas, and queues the contractor Reply-To; code inspection is not inbox acceptance.

Preview's past-due test queued one billing notice. Preview lacks `RESEND_API_KEY` and sender/Resend webhook configuration, so no billing message was claimed delivered. Configure an approved Preview mail credential and owner-controlled fixture inbox before that acceptance test. The obsolete past-due fixture was deleted after collecting queue evidence; it no longer represented a real unpaid subscription.

Resend webhook endpoint: `https://app.workcraftai.com/api/webhooks/resend`. Keep its secret server-only. Inspect actual message delivery and the matching app ledger; a generic event with no recorded message can be acknowledged but ignored.

## Weekly review

Review aggregate Vercel function counts/errors, Supabase Auth/API and Storage usage, Stripe webhook delivery, Resend message status, Gemini consumption, and the latest successful encrypted backup. Investigate sudden request/usage increases, repeated 401/403/429 responses, high function duration, database connection pressure, delivery failures, or backup age. Keep customer content, email addresses, access tokens, and keys out of incident notes.

## First response

1. Confirm an outage alert by opening the affected public URL and checking the provider status page.
2. For app health failures, inspect Vercel Production function logs, then Supabase project health and Auth/API logs.
3. For email issues, inspect Resend domain status, usage, suppression state, and the message delivery event.
4. For payment or subscription issues, inspect the matching Stripe event and delivery attempt before changing local subscription or payment records.
5. For suspected abuse, preserve timestamps and aggregate counts, then restrict the affected integration using its provider controls. Rotate credentials only when exposure is indicated; do not copy customer content into incident notes.

## Notification worker and signed Auth email hook

The availability workflow calls `GET /api/cron/notifications` with the encrypted repository `CRON_SECRET` every 15 minutes. It retries bounded outbox batches; leases, backoff and provider idempotency prevent parallel duplicate sends. Follow-ups also accept authenticated GET or POST. Quota-denied mail remains queued, so a queued response is not a sent/delivered response. Auth links expire from the queue after ten minutes. Other ambiguous sends stop within Resend's 24-hour idempotency window. Sent/failed payloads are scrubbed and terminal rows are pruned after 90 days.

The 100/day provider allocation is app 75, Auth 20, billing 5 (UTC). Per-account 5/day and 100/month customer-email limits remain unchanged. Auth only participates when the **Send Email Hook** is enabled; custom SMTP alone bypasses the shared counter. Do not describe aggregate Auth usage as bounded before activation.

Activation: generate a signing secret in Supabase Production → Authentication → Hooks → Send Email Hook, set the same secret as server-only `SUPABASE_SEND_EMAIL_HOOK_SECRET` in Vercel Production, redeploy, then enable the HTTPS hook `https://app.workcraftai.com/api/auth/email-hook`. Keep the Supabase-generated versioned secret intact. Test one signup/reset to an owner-controlled inbox; verify signature acceptance and delivery. Save hook/SMTP settings securely for recovery. If activation fails, revert to the previous SMTP configuration while diagnosing it; never leave signup unable to send confirmation mail.

Production acceptance on October 10: one signed reset-hook request returned 200, the outbox recorded `sent`, the Resend event ledger recorded `delivered`, the shared Auth counter increased by one, and the owner confirmed inbox receipt on a phone. GitHub [run 38077269341](https://github.com/workcraft-ai/workcraftai/actions/runs/38077269341) passed the health and notification-retry steps with the matching secret. Earlier SMTP-only observations above are historical.

DMARC now publishes `v=DMARC1; p=none` at `_dmarc.workcraftai.com`, verified through Vercel metadata and public DNS on October 10. It does not enforce rejection or collect aggregate reports without a `rua` destination. Add a reporting address only after confirming a monitored mailbox, review alignment reports, then consider enforcement. Existing SPF/DKIM/MX records were preserved.

## Latest readiness release verification

The current migration baseline is 43 matching Production/Staging versions, through
`20261011024002`. Release `2b9c006` passed CI and reached Ready on both Production
sites. Its public-browser audit covers 102 combinations, with no automated WCAG,
overflow or locale failures. Resend delivery subscriptions now include failed and
suppressed events, preserving the endpoint and signing secret. Billing refreshes
use per-account leases and ignore superseded subscriptions. Final public release
checks are repeatable with `scripts/production-public-checks.mjs` and
`scripts/launch-readiness-audit.mjs`; these do not certify current signed-in,
checkout, inbox or recovery-login task completion.
