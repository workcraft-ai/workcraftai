# WorkCraft AI monitoring and incident checklist

Last refreshed: 2026-10-07. This runbook contains no credentials or customer data. Mark an alert as verified only after its test notification has reached the intended monitored inbox.

## Current verified state

| Area | Verified state | Remaining evidence |
| --- | --- | --- |
| Public availability | UptimeRobot has HTTP monitors for `https://workcraftai.com/` and `https://app.workcraftai.com/api/health` (app monitor ID `804206941`). The app health endpoint is **Up** at a five-minute interval; it checks the app, Supabase Auth, and database. The owner confirmed receipt of both UptimeRobot test emails at the monitored support inbox. | Verify outage and recovery notifications, then inspect provider quota and error alerts. |
| Database migrations | Production shows 26 migration versions through `20261006170000`. Staging now also has `20261008010250_stripe_webhook_state_aware_claims` applied for the Preview webhook rollout; the RPC is installed and execution is restricted to `service_role`. | Deploy and verify the matching handler in Preview. Keep Production unchanged until Preview verification succeeds. |
| Vercel | The app project and deployment metadata are accessible. Preview deployment and environment-variable names were inspected; secret values were not copied into this runbook. | Recheck Production variable names after a release and confirm provider usage/error alert settings. |
| Stripe | Preview Test-mode connected-account destination targets the current branch Preview URL. Connected checkout completion, payment success, refund, and expiration deliveries returned HTTP 200. A connected ACH PaymentIntent moved from `processing` to `succeeded`; `payment_intent.succeeded` returned HTTP 200. Replaying the event returned HTTP 200 with `duplicate: true`. The state-aware route and migration are deployed to Preview/Staging; Production remains unchanged. | Verify `checkout.session.async_payment_succeeded`, recovery after a transient non-2xx response, subscription lifecycle and payment-failure delivery, and the billing notice. Stripe CLI's synthetic Checkout async event did not reach the connected-account destination. Never use a live payment. |
| Resend | The production webhook is enabled for delivered, delayed, bounced, and complained events; recent webhook callbacks succeeded. Estimate email source sets `estimates@workcraftai.com` and contractor Reply-To. The attempted dashboard send produced no new estimate message in Resend, so delivery and Reply-To are unverified. The bilingual transactional past-due email is deployed to Preview but not delivery-tested. | Have the owner send one estimate to an owner-controlled inbox; inspect the Resend event and message headers. Test the billing notice against a Preview Test-mode subscription. Confirm provider quota/error alerts. |
| UptimeRobot | Site and app HTTP monitors are configured at the free five-minute interval. Email alerts are enabled for `support@workcraftai.com`; the owner confirmed both test emails arrived. | Verify outage and recovery delivery. |
| Backups | An encrypted Restic-to-Google-Drive workflow and restore instructions are checked in. | Confirm the first full snapshot and a restore into a new recovery Supabase project. |
| Billing policy | The owner confirmed Pro access should downgrade immediately when Stripe reports `past_due`; account data remains available, and access returns after Stripe confirms payment. A bilingual transactional email is deployed to Preview. | Test the notice on Preview and include this policy in the Terms counsel review. |
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

The encrypted backup workflow stores its Restic repository in the owner-controlled Google Drive account. Drive storage is shared with Gmail and Photos; low space or an expired OAuth grant can fail a run. The first successful backup and a restore drill into a separate recovery project are still required. Configure these GitHub Actions repository secrets without sharing them in chat or committing them: `PROD_SUPABASE_DB_URL`, `PROD_SUPABASE_URL`, `PROD_SUPABASE_SERVICE_ROLE_KEY`, `RCLONE_CONFIG_B64`, and `RESTIC_PASSWORD`. Enable GitHub Actions failure notifications and investigate before the last known-good backup ages out. Restic retains 30 daily snapshots; private media is included weekly, so changes to media since the previous full-media run may not be recoverable.

The app also has durable application-level controls:

- Free users have a configurable limit of 10 saved estimates per UTC day.
- Pro cloud estimate drafting has per-account and platform-wide UTC-day limits.
- App-originated Resend sends share a daily ceiling.
- Public support submissions are rate-limited.

These controls reduce abuse and bound feature use. They do not replace provider usage alerts or periodic restore tests.

## Stripe event coverage and retry semantics

Stripe webhook requests are verified using the raw request body and the destination-specific signing secret. Durable event IDs prevent duplicate business actions. The state-aware handler acknowledges completed duplicates, returns a retryable non-2xx response while another invocation is processing or a claim is unknown, and recovers stale claims after five minutes. Its RPC is added by `20261008010250_stripe_webhook_state_aware_claims.sql`, applied to Staging and deployed to Preview. A successful duplicate replay returned HTTP 200 with `duplicate: true`. Automatic recovery after a deliberately induced transient non-2xx response still needs a safe Preview test.

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
