This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## WorkCraft AI business features

The marketing and social launch steps are in [`docs/WORKCRAFT-AI-MARKETING-GUIDE.md`](docs/WORKCRAFT-AI-MARKETING-GUIDE.md).

The availability monitor and provider alert checklist are in [`docs/OPERATIONS-MONITORING.md`](docs/OPERATIONS-MONITORING.md). GitHub Actions checks the public marketing site and app/Supabase Auth and database health every 15 minutes after the workflow reaches the default branch.

The smoke and accessibility checks, test-account setup, safe cross-account RLS probe, and opt-in Stripe test webhook fixture procedure are documented in [`docs/PRODUCTION-READINESS-RELEASE.md`](docs/PRODUCTION-READINESS-RELEASE.md) and automated by `node scripts/production-readiness-smoke.mjs`.

The free-tier estimate cap, accounting rules, database migration, and release/rollback steps are in [`docs/FREE-ESTIMATE-LIMIT.md`](docs/FREE-ESTIMATE-LIMIT.md). The initial limit is 10 saved estimates per free account per UTC day.

The app includes contractor price books and estimate templates, a scheduled job board with status tracking and actual job costs, estimate and job reports with gross profit, printable proposals/invoices, customer approval capture and proposal questions, Good/Better/Best options, contractor branding and default markup/tax settings, private job voice notes, proposal photos, Pro subscriptions, cloud estimate drafting, branded estimate email, and automatic follow-up scheduling. Estimate drafts and media can be saved in browser storage for offline editing on that device; creating/syncing the estimate requires a connection.

### Supabase setup

Apply [`supabase/migrations/202609270001_tradeflow_operations.sql`](supabase/migrations/202609270001_tradeflow_operations.sql) to the Supabase project before using the new price book, templates, jobs, reporting, subscription, and email tracking features. The migration adds row-level policies for the new user-owned tables and extra columns to the existing `estimates` table.

Before production, also review and apply [`supabase/migrations/202609280001_lock_down_estimates.sql`](supabase/migrations/202609280001_lock_down_estimates.sql). Back up the database and identify estimates with a null `user_id` first; those records cannot be assigned to a contractor automatically. The migration removes existing policies on `estimates` and `line_items` and replaces them with owner-only policies. Proposal links are served through a limited server endpoint after this deploy.

Apply [`supabase/migrations/202609290001_proposals_field_tools.sql`](supabase/migrations/202609290001_proposals_field_tools.sql) in Supabase SQL Editor after the earlier migrations. It adds estimate tax/markup snapshots, customer-question storage and policies, private estimate attachment records, and the private `estimate-media` Storage bucket/policies. The app changes depend on this migration; photo/audio upload and customer questions will fail until it is applied. In Profile & Preferences, contractors can add their business name, phone, address, public HTTPS logo URL, proposal accent color, and default tax/markup percentages. Verify logo URLs are publicly reachable over HTTPS. Tax calculations apply the entered percentage to subtotal plus markup; selected Good/Better/Best package totals are treated as already-marked-up prices and receive tax only. Contractors must confirm local taxability and rates.

Apply [`supabase/migrations/202609290002_language_and_estimate_handoff.sql`](supabase/migrations/202609290002_language_and_estimate_handoff.sql) after the prior migrations. It adds English/Spanish proposal fields and an atomic conversion from an approved estimate to one scheduled job. The header language switch translates the core estimate, schedule, price book, reports, profile, sign-in, and invoice screens. Proposal language is selected per estimate. Spanish service and package descriptions are contractor-entered; if a Spanish description is missing, the proposal shows the original description. The interface does not automatically translate contractor-entered scope.

Photos are shared on the customer proposal; voice recordings remain visible only to the signed-in contractor. Device drafts, including customer details and media, remain in that browser's IndexedDB and are not synced between devices. Clear them from the estimate form when no longer needed.

### Internal admin support console

Apply [`supabase/migrations/202609300001_admin_support_console.sql`](supabase/migrations/202609300001_admin_support_console.sql) to enable the private admin tables. Then in Supabase SQL Editor, replace the example email in the commented grant statement at the bottom of that migration with the exact email on your Supabase Auth account, uncomment it, and run it. Assign `support` to support staff who need account lookup, recovery emails, and notes; assign `billing` for coupon actions; reserve `super_admin` for the owner. The console is at `/admin` and requires `SUPABASE_SERVICE_ROLE_KEY` to be configured as a private server variable. Admin sessions must complete Supabase TOTP multi-factor authentication before accessing customer or billing data; the console provides an enrollment/verification screen. Enroll a second authenticator factor for recovery before relying on this for production support. Never add admin membership from the browser or expose the service-role key.

Billing support requires an active or trialing Stripe subscription and an existing Stripe coupon that is 100% off, one-time or repeating for no more than 3 months. Create the coupon in Stripe first; the console applies it and records the reason. Supabase Auth sends password recovery using the existing Auth SMTP/template and `/auth/confirm?next=%2Freset-password` redirect. All support notes and administrative actions are private to server-side admin APIs and are recorded in the audit log. Admin access is tied to the account UUID, so changing an email address does not grant admin permissions.

### Pro integrations

Copy `.env.example` to `.env.local` and set the values for integrations you enable. Configure `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for new deployments; `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains a temporary fallback during rollout:

- Stripe Pro subscriptions and contractor payments: `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, and (for Connect customer payments) `STRIPE_CONNECT_WEBHOOK_SECRET`. The live WorkCraft AI Pro price is $9.99/month with no card-based trial; free features remain available. Configure two Stripe webhook endpoints at `https://app.workcraftai.com/api/webhooks/stripe`: one for **Your account** events using `STRIPE_WEBHOOK_SECRET`, with `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, and `invoice.payment_action_required`; one for **Connected accounts** events using `STRIPE_CONNECT_WEBHOOK_SECRET`, with `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `payment_intent.succeeded`, and `charge.refunded`. Each endpoint has its own signing secret. Configure the Stripe Customer Portal to allow payment-method updates, invoice history, and cancellation at period end. The app creates authenticated portal sessions at `/api/pro/portal`.
- Also subscribe the **Connected accounts** endpoint to `checkout.session.async_payment_failed` and `payment_intent.payment_failed` so failed or delayed payment states are recorded promptly.
- Enable Stripe Connect for the WorkCraft AI Stripe platform before exposing customer payment collection. The app creates v2 Express connected accounts with Stripe-hosted onboarding, direct charges, Stripe-collected processing fees, and Stripe-managed negative-balance risk where approved. Set optional `STRIPE_CONNECT_ACCOUNT_COUNTRY` (ISO 3166-1 country code; defaults to `US`) before onboarding the first contractor. Account country cannot be changed after account creation. Use Stripe's sandbox first, then complete the live Connect platform setup and account review. Contractors must complete Stripe verification and add payout details; Checkout sessions are created on their connected accounts. They manage refunds and disputes in Stripe. WorkCraft AI does not hold or transfer customer funds.
- Cloud estimate drafts: `GEMINI_API_KEY` (optionally set `GEMINI_MODEL`). The Gemini key stays server-side.
- Cloud drafting is limited to 20 attempts per Pro account and an initial platform-wide ceiling of 250 attempts per UTC day. The global ceiling can be lowered or raised up to 5,000 in Admin Support. Provider failures consume an attempt because they can still incur cost.
- Branded estimate email is Pro-only and capped at 50 messages per account per UTC day. Public support remains rate-limited separately.
- Branded email and follow-ups: `RESEND_API_KEY` and `RESEND_FROM_EMAIL`, using a sender domain verified with Resend.
- Scheduled follow-ups: Vercel Cron calls `/api/cron/followups` daily at 09:00 UTC in production. Set `CRON_SECRET` as a private Vercel environment variable; the handler verifies the `Authorization: Bearer <CRON_SECRET>` header. The app schedules a follow-up seven days after sending an estimate email, and each run handles up to 100 due messages in small concurrent batches. Preview deployments do not run Vercel Cron jobs.
- Set `SUPABASE_SERVICE_ROLE_KEY` for signed customer approvals, proposal view tracking, Stripe webhooks, and the follow-up worker. Keep this key private and server-side.
- In Vercel Production environment variables, set `NEXT_PUBLIC_APP_URL=https://app.workcraftai.com` and `NEXT_PUBLIC_SUPPORT_EMAIL=support@workcraftai.com`. This public address appears in app support links; do not set a public-prefixed variable to secret-only visibility.
- For Supabase Auth email, configure a verified sender and custom SMTP in the Supabase dashboard. For Resend SMTP use host `smtp.resend.com`, port `587`, username `resend`, and the Resend API key as the password. Keep credentials in the Supabase dashboard, not Git.
- In Supabase Auth URL Configuration, set Site URL to `https://app.workcraftai.com` and allow the production confirmation redirect `https://app.workcraftai.com/auth/confirm`.
- To prevent email scanners from consuming reset links, update Supabase Auth → Email Templates → Reset Password. Set the link to `<a href="{{ .SiteURL }}/confirm-reset?token_hash={{ .TokenHash }}&amp;type=recovery">Continue password reset</a>`. The new `/confirm-reset` page verifies the one-time token only after the user clicks its button.

The app reads subscription state from Stripe webhook updates. Pro tools stay locked until the webhook records an active or trialing subscription.

Customer down payments and full payments are Pro-only. The app creates direct Stripe Checkout charges on a contractor's connected account and updates payment status from signed connected-account webhooks. Customer payment collection remains unavailable in production until Connect is enabled and approved, the webhook is configured for connected-account events, the migration is applied, and a complete sandbox-to-live verification is done. Stripe Pro subscriptions are a separate WorkCraft AI billing flow.

### Production-readiness changes awaiting release

Review the ordered migration and rollback steps in [`docs/PRODUCTION-READINESS-RELEASE.md`](docs/PRODUCTION-READINESS-RELEASE.md) before shipping changes that include the latest hardening migrations. Production database changes are not applied automatically by this repository.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
