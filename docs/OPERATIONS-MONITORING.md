# WorkCraft AI monitoring and incident checklist

Last refreshed: 2026-10-09. This runbook contains no credentials or customer data. Mark an alert as verified only after its test notification has reached the intended monitored inbox.

## Current verified state

| Area | Verified state | Remaining evidence |
| --- | --- | --- |
| Public availability | UptimeRobot has HTTP monitors for `https://workcraftai.com/` and `https://app.workcraftai.com/api/health` (app monitor ID `804206941`). The app health endpoint is **Up** at a five-minute interval; it checks the app, Supabase Auth, and database. The owner confirmed receipt of both UptimeRobot test emails at the monitored support inbox. | Verify outage and recovery notifications, then inspect provider quota and error alerts. |
| Database migrations | Production and Staging each report the same 32 migration versions through `20261009161204_fix_estimate_email_quota_usage_date_ambiguity`. The latest fixes cover Storage upload preflight, serialized media limits, and email-quota reservation. The state-aware Stripe claim RPC is installed in both projects with an empty `search_path`; only `service_role` can execute it. | Reconfirm histories after future migrations. |
| Vercel | Both Production deployment checks passed after PR #74 merged as `209daa8`. The app health endpoint returned 200 with Supabase Auth/database healthy, and the marketing homepage returned 200. Deployment/environment API requests returned 403 and the Vercel CLI is not installed, so plan and settings remain unverified. | Confirm provider usage/error alert settings and recheck the Vercel plan before commercial launch. |
| Stripe | Preview Test-mode connected-account destination targets the current branch Preview URL. Connected checkout completion, payment success, refund, and expiration deliveries returned HTTP 200. A connected ACH PaymentIntent moved from `processing` to `succeeded`; `payment_intent.succeeded` returned HTTP 200. Replaying the event returned HTTP 200 with `duplicate: true`. The state-aware route is deployed to Preview and Production; its migration is present in both databases. | Verify `checkout.session.async_payment_succeeded`, recovery after a transient non-2xx response, subscription lifecycle and payment-failure delivery, and the billing notice. Stripe CLI's synthetic Checkout async event did not reach the connected-account destination. Never use a live payment. |
| Resend | The production webhook is enabled for delivered, delayed, bounced, and complained events; recent webhook callbacks succeeded. Estimate email source sets `estimates@workcraftai.com` and contractor Reply-To. The attempted dashboard send produced no new estimate message in Resend, so delivery and Reply-To are unverified. The bilingual transactional past-due email is deployed to Preview and Production but not delivery-tested. | Have the owner send one estimate to an owner-controlled inbox; inspect the Resend event and message headers. Test the billing notice against a Preview Test-mode subscription. Confirm provider quota/error alerts. |
| UptimeRobot | Site and app HTTP monitors are configured at the free five-minute interval. Email alerts are enabled for `support@workcraftai.com`; the owner confirmed both test emails arrived. | Verify outage and recovery delivery. |
| Backups | An encrypted Restic-to-Google-Drive workflow and restore instructions are checked in. | Confirm the first full snapshot and a restore into a new recovery Supabase project. |
| Billing policy | The owner confirmed Pro access should downgrade immediately when Stripe reports `past_due`; account data remains available, and access returns after Stripe confirms payment. A bilingual transactional email is deployed to Preview and Production. | Test the notice on Preview and include this policy in the Terms counsel review. |
| Scope | Zoho is no longer in scope. | No Zoho integration work is required. |

## Availability checks

The repository contains `.github/workflows/availability.yml`, scheduled every 15 minutes and manually runnable. It checks the public home page and the app health endpoint. Treat this workflow as a secondary signal; its success does not prove the owner receives external outage alerts.

The UptimeRobot free plan currently checks every five minutes. Monitors are configured for:

1. `https://workcraftai.com/`
2. `https://app.workcraftai.com/api/health`

Both monitors currently show **Up**, 100% uptime, and no incidents in the last 24 hours. The owner confirmed both UptimeRobot test emails arrived at `support@workcraftai.com`. Actual outage/recovery delivery remains untested. A health monitor does not detect a bad Stripe signing secret, Resend quota exhaustion, Gemini provider failure, or a subscription billing issue.

## Provider usage and error alerts

Configure provider-native alerts where available. Confirm each by checking the destination and, where supported, sending a test alert. Thresholds can vary by plan and provider policy; review the current dashboard before relying on a notification or enabling paid usage.

| Provider | Review | Alert/response |
| --- | --- | --- |
| Vercel | Production deployment failures, function errors, invocations, bandwidth, and project/team usage limits. | Enable available project/team notifications. Investigate error spikes and unexpected usage before increasing limits. |
| Supabase | Database size, egress, Storage, Auth/API usage, project health, and backup availability. | Enable available usage notifications. A successful health check is not a backup or restore test. |
| Stripe | Subscription lifecycle, payment disputes/refunds, connected-account notices, and webhook failures. | Inspect the matching event destination and failed delivery response. Keep signing secrets server-only. |
| Resend | Usage, failed/suppressed sends, bounces, complaints, and delivery delay. | Alert before limits are reached and inspect the individual message delivery event for reported missing mail. |
| Gemini | Model usage, quota, and provider errors. | The app enforces per-account and global daily generation limits; also monitor provider-level quotas. |

## Backups and usage limits

The encrypted backup workflow stores its Restic repository in the owner-controlled Google Drive account. Daily snapshots include database data plus a separate Auth account export; private estimate media is included weekly. Drive storage is shared with Gmail and Photos; low space or an expired OAuth grant can fail a run. The first successful full backup and a restore drill into a separate recovery project are still required. Configure these GitHub Actions repository secrets without sharing them in chat or committing them: `PROD_SUPABASE_DB_URL`, `PROD_SUPABASE_URL`, `PROD_SUPABASE_SERVICE_ROLE_KEY`, `RCLONE_CONFIG_B64`, and `RESTIC_PASSWORD`. Enable GitHub Actions failure notifications and investigate before the last known-good backup ages out. Restic retains 30 daily snapshots; changes to media since the previous full-media run may not be recoverable.

The app also has durable application-level controls:

- Free accounts can save 10 estimates per UTC day and 50 per UTC month. Pro accounts can save 50 per day and 500 per month.
- Pro cloud AI has a 5/day and 50/month account limit; the platform-wide ceiling remains 250 attempts per UTC day. Attempts count when admitted, including provider failures.
- Pro estimate emails, follow-ups, and proposal-question alerts share a 5/day and 100/month account allowance. All app mail shares the 75/day global Resend ceiling (admin-adjustable up to 90); support and retention messages use only that shared platform pool.
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

Stripe webhook requests are verified using the raw request body and the destination-specific signing secret. Durable event IDs prevent duplicate business actions. The state-aware handler acknowledges completed duplicates, returns a retryable non-2xx response while another invocation is processing or a claim is unknown, and recovers stale claims after five minutes. Its RPC is added by `20261008010250_stripe_webhook_state_aware_claims.sql`, applied to Production and Staging, and the handler is deployed to both Preview and Production. A successful duplicate replay returned HTTP 200 with `duplicate: true`. Automatic recovery after a deliberately induced transient non-2xx response still needs a safe Preview test.

Use the dedicated Stripe Test-mode destinations and disposable connected-account/payment fixtures. Preview evidence covers connected checkout completion, payment success, refund, and expiration; every fresh delivery returned HTTP 200. A connected Test-mode ACH PaymentIntent moved from `processing` to `succeeded` and its success event returned HTTP 200. Replaying that event returned `200` with `duplicate: true`. The exact `checkout.session.async_payment_succeeded` event and subscription lifecycle remain open; the Stripe CLI's synthetic async Checkout event did not appear in the connected-account destination history. Earlier 503 entries refer to the previous Preview URL; fresh events reached the updated URL successfully. Never send test events to Production unless Production is deliberately configured for them, and never create a live payment as a delivery test.

## Email verification

Estimate messages use `WorkCraft AI <estimates@workcraftai.com>` with Reply-To set to the contractor's account email. A dashboard send attempt produced no confirmation and no provider request, so do not treat it as sent. Have the owner trigger one send to an owner-controlled inbox; inspect the email in Resend, confirm the delivery event, and check the message headers for the contractor Reply-To. The support email is a separate public contact and does not route provider alerts.

Resend webhook endpoint: `https://app.workcraftai.com/api/webhooks/resend`. Its event signing secret must stay server-only. Confirm the webhook's configured delivery events, latest delivery attempts, and the resulting estimate activity status in the app. A generic test event may be acknowledged but ignored when it does not match an estimate email already recorded by the app.

## Weekly review

Review aggregate Vercel function counts/errors, Supabase Auth/API and Storage usage, Stripe webhook delivery, Resend message status, Gemini consumption, and the latest successful encrypted backup. Investigate sudden request/usage increases, repeated 401/403/429 responses, high function duration, database connection pressure, delivery failures, or backup age. Keep customer content, email addresses, access tokens, and keys out of incident notes.

## First response

1. Confirm an outage alert by opening the affected public URL and checking the provider status page.
2. For app health failures, inspect Vercel Production function logs, then Supabase project health and Auth/API logs.
3. For email issues, inspect Resend domain status, usage, suppression state, and the message delivery event.
4. For payment or subscription issues, inspect the matching Stripe event and delivery attempt before changing local subscription or payment records.
5. For suspected abuse, preserve timestamps and aggregate counts, then restrict the affected integration using its provider controls. Rotate credentials only when exposure is indicated; do not copy customer content into incident notes.
