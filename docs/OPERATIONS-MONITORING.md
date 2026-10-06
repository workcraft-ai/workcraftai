# WorkCraft AI monitoring and incident checklist

Last verified: 2026-10-05 after production commit `12459feb2b8a1aab9a2d1073d9b999e0b48ff5ce`. This runbook contains no credentials or customer data.

## Current verified state

| Area | Verified state | Still to verify |
| --- | --- | --- |
| Production availability | `https://workcraftai.com/` returned HTTP 200. `https://app.workcraftai.com/api/health` returned HTTP 200 with app, Supabase Auth, and Supabase database checks all `ok`. | Add an external monitor that sends an alert when either URL fails. |
| Database deployments | Production and staging have the same 19 migration names applied, through `admin_managed_pro_access`. The health endpoint confirms the production database responds. | Confirm a recent restorable production backup or PITR in Supabase. |
| GitHub CI | GitHub Actions CI run 94 passed for the merged change, including audit, lint, unit tests, typecheck, build, database security tests, and concurrency checks. | No CI action remains for this release. |
| Stripe | Stripe Live has enabled `@self` and `@accounts` destinations targeting `https://app.workcraftai.com/api/webhooks/stripe`. The dashboard showed zero Live deliveries over the last 7 days; no test-mode destination is configured. | Configure a dedicated test destination/account and verify synthetic event deliveries. No live payment was created. |
| Email | `workcraftai.com` was reported verified by Resend. An owner-controlled Gmail inbox received an earlier estimate email in Inbox immediately (per screenshot); Resend logs were not inspected. The dedicated estimate sender and contractor Reply-To are now deployed. | Send a new estimate to an owner-controlled inbox and confirm both sender and Reply-To, then inspect the Resend delivery event. |
| UptimeRobot | Signup magic link sent to `support@workcraftai.com`. | Owner must click the link; then add the public-site and app-health monitors and verify notification delivery. |

## Uptime checks and alerts

The repository includes `.github/workflows/availability.yml`, scheduled every 15 minutes and manually runnable. It checks the marketing home page and the app health endpoint. A previous scheduled run was cancelled before its HTTP checks because GitHub did not allocate a hosted runner. The latest CI run succeeded after retrying its database job. Treat the workflow as a useful backstop, not as the only paging channel.

Recommended no-cost external layer: [UptimeRobot's free plan](https://uptimerobot.com/pricing/) supports up to 50 monitors, five-minute checks, and email notifications. Signup is pending email verification. After verification, create HTTP monitors for:

1. `https://workcraftai.com/`
2. `https://app.workcraftai.com/api/health`

Route notifications to `support@workcraftai.com` or the owner’s actively monitored inbox. The health endpoint also checks Supabase Auth and the production database, so a database outage should fail the second monitor. Uptime monitoring will not detect a bad Stripe webhook secret, Resend quota exhaustion, or billing-limit warnings.

GitHub Actions failure emails go to the GitHub account’s configured notification address; the workflow does not currently send email to the support inbox. Configure GitHub Actions notifications on the repository owner account. Configure provider-native usage/error alerts separately in Vercel, Supabase, Stripe, and Resend, and confirm each destination.

### Provider thresholds to watch

| Provider | Review | Alert/response |
| --- | --- | --- |
| Vercel | Production deployment failures, function errors, invocations, and bandwidth/usage limits. | Enable available notifications at the team/project level; investigate error spikes and unexpected usage before increasing limits. |
| Supabase | Production database size, egress, storage, Auth/API usage, backup/PITR availability, and project health. | Enable available usage notifications and check backup retention. The free-estimate and Gemini quotas do not replace provider-level spend/usage alerts. |
| Stripe | Live webhook delivery failures, subscription lifecycle events, disputes/refunds, and account notices. | Inspect the relevant event destination’s delivery history; keep the endpoint signing secrets server-only. |
| Resend | Daily/monthly quota, failed/suppressed sends, bounces, and complaints. | Alert before the account reaches its limits and review individual delivery events for user-reported missing mail. |
| Gemini | Generation usage and provider quota. | The app enforces per-user and global daily generation limits; review provider consumption as the friends-and-family cohort grows. |

Provider notification availability and thresholds can vary by plan. Check the current dashboard before relying on any alert; do not upgrade a paid plan or enable automatic pausing without deciding the budget.

## Stripe event coverage

The Live `@accounts` destination includes:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

The Live `@self` destination includes:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`

The webhook handler verifies Stripe signatures against the raw request body, supports the separate platform and connected-account signing secrets, and claims/completes event IDs through the database idempotency RPC. Event-destination configuration is verified; successful delivery and test-mode lifecycle handling still need a test event and delivery-history review.

Use a dedicated Stripe test-mode destination and connected-account test fixture for synthetic events. Do not point a test destination at production unless the production endpoint is deliberately configured to accept that test signing secret; never create a live charge just to test delivery.

## Email verification

Resend domain verification and recent password-reset/support deliveries were confirmed in the previous provider check. An owner-controlled inbox received an earlier estimate email immediately, but its Resend event was not inspected. Production estimate messages now use `WorkCraft AI <estimates@workcraftai.com>` and set Reply-To to the contractor’s account email. Send a new test estimate to an owner-controlled inbox and inspect its Resend event and headers. Do not use a real customer address for smoke tests. Setting `NEXT_PUBLIC_SUPPORT_EMAIL` only changes the public support contact; it does not route provider alerts.

## Abuse and cost controls

- Free users have a durable, atomic 10-saved-estimates-per-UTC-day limit, adjustable by an authorized administrator.
- Pro cloud estimate generation has durable per-user and global daily limits; monitor Gemini usage as account volume grows.
- Support submissions are rate limited. Hosting, database, email, and AI provider quotas still need provider-level usage notifications.
- Review aggregate Vercel function counts/errors, Supabase Auth/API activity, Resend delivery status, and Gemini consumption weekly while onboarding test users. Investigate sudden request/usage increases, repeated 401/403/429 responses, high function duration, or elevated database connections. Keep customer content, email addresses, access tokens, and keys out of incident notes.

## First response

1. Confirm an uptime alert by opening the affected public URL and the provider status page.
2. For app health failures, inspect Vercel Production function logs, then Supabase project health and Auth/API logs.
3. For email issues, inspect Resend domain status, usage, and the message’s delivery event.
4. For subscription/payment issues, inspect the matching Stripe event destination and delivery attempt before changing subscription or payment records.
5. For suspected abuse, preserve timestamps and aggregate counts, restrict the affected integration using its provider controls, and rotate credentials only when exposure is indicated. Do not export customer content into incident notes.
