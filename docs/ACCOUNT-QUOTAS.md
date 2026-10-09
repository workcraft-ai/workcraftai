# WorkCraft AI account usage allowances

This document is the operational reference for the initial Free and Pro per-account caps. The same allowances are reflected in the Profile page, estimate editor, support FAQ, legal pages, and marketing plan cards.

## Customer allowances

| Usage | Free | Pro ($9.99/month) | Reset / counting rule |
| --- | --- | --- | --- |
| Saved estimates | 10 per day; 50 per month | 50 per day; 500 per month | UTC calendar day/month. New saved rows count, including rows that have not yet been emailed. Edits, browser-only drafts, and failed inserts do not count. Deleting an estimate does not refund a slot. Existing estimates remain available. |
| Cloud AI estimate drafts | Not included | 5 per day; 50 per month | An attempt counts when admitted to Gemini processing, including provider failures. WorkCraft AI does not store prompt or generated text in its usage log. Gemini's provider tier, data handling, and terms are unchanged by this cap. The shared platform limit is 250 attempts per UTC day. |
| Customer-facing estimate emails | Not included | 5 per day; 100 per month | Estimate emails, scheduled follow-ups, and contractor alerts for proposal questions share this allowance. Definite provider rejections release their reservation; successful or delivery-uncertain requests count. The shared platform limit is 75 app emails per UTC day (admin may lower/raise it only up to 90); support and retention notices count against this platform pool, not a customer account. |
| New private estimate media uploads | Not included | 100 MB per month | Total bytes accepted for new uploads during the UTC month. Deleting a file does not restore the monthly upload allowance. One file is limited to 15 MB. |
| Retained private estimate media | Not included | 250 MB and 100 files at a time | Current stored size and file count are checked before each upload. Deleting a file frees retained capacity. |

Daily limits reset at 00:00 UTC. Monthly limits reset at 00:00 UTC on the first day of the next month. Unused allowances do not roll over. Shared provider capacity can pause an action before the account cap is reached. A future higher plan may be considered, but it is not currently offered.

The app shows estimates remaining in the estimate editor and Profile; Pro AI remaining in the estimate editor and Profile; customer email remaining on the Dashboard, after an estimate email is sent, and in Profile; and media remaining in the estimate editor and Profile. Quota displays use warning color near the cap and red at zero. Profile is the central view for current daily and monthly totals.

## Enforcement and data handling

- Estimate counts use durable Postgres daily and monthly rows, updated in the same transaction as estimate creation. The trigger applies the correct Free or Pro limits on the server.
- AI reservations atomically check the per-account daily/monthly limits and existing platform-wide daily ceiling. Failed provider attempts count after admission. The usage event records model, prompt length, outcome, response status, and provider-reported token totals when available; it does not store the prompt or generated content. Existing Gemini account tier and data handling remain unchanged.
- Customer email counters use durable daily/monthly reservations in addition to the existing shared platform mail ceiling. A reservation is released only for a definite provider rejection or a known failure; a timeout with uncertain delivery remains counted.
- Private media reservations serialize uploads per account across application instances. The migration backfills current-month object sizes and creates durable monthly upload counters. Retained bytes and file count are checked from Storage objects, including pending reservations.
- Usage data is private. Counter tables have RLS enabled and no `anon` or `authenticated` table access; service-role operations and authenticated, owner-scoped RPCs enforce each flow. The account summary route authenticates the caller before requesting that caller's snapshot.
- Usage rows are retained only as needed for the current/nearby periods; account-linked quota summaries older than three months and AI events older than 90 days are pruned during later quota activity. If a feature is unused, its cleanup runs when that feature is next used.

## Migration and release sequence

The migration `supabase/migrations/20261009025908_per_account_plan_quotas.sql` has been applied to both Staging and Production on 2026-10-09. Both histories record the same version. It does not delete customer estimates, email events, or media. It seeds current-period counters from existing estimates, email events/reservations, AI events, and current-month media objects. Consequently, existing activity in the active UTC period counts toward that period's initial allowance. The Free daily admin setting is clamped to a maximum of 10; the AI daily setting is set to the advertised 5 and cannot be raised above 5.

As of 2026-10-09, Staging and Production histories match through `20261009161204_fix_estimate_email_quota_usage_date_ambiguity` (32 migration versions). The follow-up migrations correct estimate-media Storage preflight authorization, preserve serialization of per-account media limits, and fix an ambiguous `usage_date` reference in the app-email reservation function. They do not reset quota counters or remove customer data.

Release verification record:

1. **Complete:** Staging and Production histories were aligned before rollout; the exact version `20261009025908` was applied to both.
2. **Complete:** App and marketing Preview builds for the release commit completed successfully. Lint, typecheck, and build had passed before deployment.
3. **Follow-up verification:** The database quota concurrency scripts and authenticated cap-exhaustion acceptance flows were not run in this release. Run them against Staging when test-account credentials are available: estimate daily/monthly contention, AI daily/monthly and global contention, email reservation/release, and concurrent media uploads at the cap. Production limits are server-enforced in the meantime.
4. **After merge:** Confirm the Vercel Production deployments for the app and marketing site reach Ready, then monitor database, Storage, Gemini, and Resend usage/error dashboards. App caps do not expand free provider quotas or prevent unrelated platform usage from reaching provider-wide limits.

Vercel remains on the Hobby plan during noncommercial development and testing. Move to an appropriate commercial plan before accepting paid production customers or otherwise using the deployment commercially; recheck current function, bandwidth, and plan requirements at that point. These app caps do not create per-user Vercel or GitHub quotas.

## Rollback and support notes

The migration preserves existing customer data, and no destructive down migration is provided. Once counters have accumulated, do not drop quota tables or rewind usage. If application rollback is needed, retain the migration and counter data; restore an application revision compatible with the deployed RPCs or prepare a forward-compatible SQL adjustment first. Do not promise restored quota after deleting estimates, email reservations, or media. Investigate a specific counter discrepancy before issuing any support adjustment.
