# Account deletion and inactivity retention

## Policy

- An account becomes eligible after **12 months without authenticated activity in the app**. The initial baseline for existing accounts is the latest Supabase Auth sign-in time, falling back to account creation time.
- The app records authenticated activity on page visits and when a signed-in tab returns to the foreground. The browser reports at most every six hours; the database also limits writes to that interval.
- A daily production job sends one account-language-aware warning email at the 12-month mark. It gives the user **30 days** to sign in. A sign-in during that period cancels the pending deletion and resets the inactivity clock.
- After the deadline, a later daily job deletes the WorkCraft AI account and associated app data. Accounts with a WorkCraft AI subscription are not deleted if Stripe cancellation fails. Administrator accounts are excluded from automatic deletion and blocked from the manual deletion workflow.
- Manual deletion is available to a Super Admin with MFA from the selected account panel. It requires the account email and a reason. A user-initiated deletion API also requires an authenticated session, same-origin request, matching email, and reason.
- Deletion removes estimate media, payment ledger records, estimates, and other rows that cascade from the Auth account. It cancels the WorkCraft AI subscription first. It removes the app’s local Stripe Connect reference but does **not** delete or disconnect the contractor’s separate Stripe account.
- The admin audit entry remains as a minimal record of the deletion action and outcome; its Auth user references become null after deletion.

## Production release steps

1. Confirm these Vercel Production variables are present: `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`, and `STRIPE_SECRET_KEY` for accounts with a WorkCraft AI subscription. `NEXT_PUBLIC_SUPPORT_EMAIL` is optional and defaults to `support@workcraftai.com`.
2. Review and apply `supabase/migrations/20261004220558_account_retention_lifecycle.sql` to the intended production Supabase project before deploying the app changes. It seeds existing accounts from Auth sign-in/creation timestamps and installs an Auth-user trigger for new accounts. Do not apply it to production as part of this code change.
3. Deploy the app. Vercel will register `/api/cron/account-retention` for daily execution at 10:00 UTC. The endpoint requires the configured `CRON_SECRET` bearer token.
4. In Supabase, verify the lifecycle table is inaccessible to `anon` and `authenticated`, the RPC grants are service-role only, seeded row counts match Auth users, and admin accounts are present but excluded by the job.
5. Before enabling the policy for real customers, exercise the notice, sign-in cancellation, due-deletion, Stripe-cancellation failure, media-cleanup failure, and manual Super Admin paths with disposable test accounts. Verify Resend delivery and Vercel cron invocation logs.

## Rollback

Disable the retention cron in Vercel or remove its `vercel.json` entry to stop automatic emails and deletions. Reverting the app deployment also removes the admin action. Leave the lifecycle table, seeded timestamps, trigger, and RPCs in place during rollback; dropping them would lose pending-warning state. Accounts already deleted cannot be restored by this migration. A subscription canceled by Stripe remains canceled and may require the customer to resubscribe.

## Verification limits

This change prepares the migration but does not apply it. Local checks cannot verify production Auth data, Resend delivery, Stripe cancellation, Vercel scheduling, Storage cleanup, or the live RLS/RPC grants. Those require applying the migration and using disposable accounts in the target environment.
