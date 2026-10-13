# Production configuration and recovery inventory

This inventory contains names and recovery steps only. Keep values in the provider's secret store or an owner-controlled password manager. Never commit `.env` files, tokens, customer records, or a plaintext backup.

## Service inventory

| Service | Required recovery settings | Verification |
| --- | --- | --- |
| Vercel app | `NEXT_PUBLIC_APP_URL`, Supabase URL/publishable key, `SUPABASE_SERVICE_ROLE_KEY`, `PROPOSAL_SHARE_ENCRYPTION_KEY`, `CRON_SECRET`, `SCHEDULER_SECRET`, Stripe/Resend/Gemini credentials, Auth email-hook secret, Turnstile keys | Production and Preview have intentionally separate values; record the project IDs and custom domains. |
| Supabase Production | Project ref `ivioejiiigtbmhpzjuni`, Auth providers/redirect URLs, Send Email Hook, Storage bucket/policies, database extensions, Vault scheduler entries | Compare migration history to this repository. Restore Auth and Storage from the encrypted backup; reset active sessions. |
| Supabase Staging | Project ref `wuebymyvhzieockrohyp`, isolated credentials and redirects | Apply additive migrations here before Production. Its Cron job remains inert until separate Vault scheduler entries are installed. |
| Stripe | Platform live API key, Pro price ID, separate platform and Connect webhook signing secrets and event selections | Verify both live destinations and replay an owner-controlled test event after recovery. Never copy test-mode keys into Production. |
| Resend | Sending-domain DNS, transactional API key, usage key, webhook secret and event subscriptions | Verify a message to an owner-controlled inbox and its delivery ledger. |
| GitHub Actions | `CRON_SECRET`, Production Supabase backup credentials, Restic password, rclone configuration | Inspect the latest backup and availability run; decrypt a snapshot during an isolated drill. |
| DNS and Google Drive | App/site records and backup repository access | Keep a separate owner-controlled export of DNS settings and Restic recovery instructions. |

## Release and rollback order

1. Confirm required CI checks on the exact commit and a recent successful backup.
2. Apply only backward-compatible, additive migrations to Staging; inspect the schema and Preview app.
3. Apply the same migrations to Production before deploying app code that depends on them. Keep old columns and RPCs until all old deployments can safely finish.
4. Deploy the app; inspect `/api/health`, the operations check, Stripe/Resend delivery, and the new database scheduler heartbeat. Promote the marketing site only when it changed.
5. If app code fails, roll back the Vercel deployment. Leave applied migrations and payment/event ledgers in place; make a new forward migration for a database correction.

## Scheduler activation and rotation

Production Supabase Vault stores `workcraft_scheduler_secret` and `workcraft_scheduler_origin`; Vercel Production stores matching `SCHEDULER_SECRET`. The Supabase Cron job runs every five minutes and calls the authenticated notification, Stripe worker, and operations endpoints. GitHub Actions continues as a fallback with its separate `CRON_SECRET`. The app health endpoint returns 503 if the database scheduler has not completed a notification retry within twenty minutes. Do not print either credential while inspecting the Vault or Vercel configuration.

For scheduler-secret rotation, create a new random credential; update the app to accept both old and new values briefly, add the new value to Vercel and Vault, redeploy, verify a scheduler heartbeat, then remove the old value. For the existing paired Vercel/GitHub `CRON_SECRET`, coordinate both sides and verify the next GitHub workflow before retiring the prior value. Rotate Stripe and Resend webhook signing secrets using each provider's overlap/replay procedure. Never change a key based on a stale runbook alone.

## Recovery drill

Use [the backup runbook](OPERATIONS-BACKUPS.md) to restore an encrypted snapshot into an isolated environment. Time the full process. Verify password/MFA sign-in, estimates, private media, invoice balances, customer links, and a signed webhook replay with non-production fixtures. Recreate external provider settings from the inventory above. Record achieved database/media recovery points and the elapsed recovery time before assigning a customer-facing recovery target.
