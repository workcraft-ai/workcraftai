# WorkCraft AI plans and feature boundaries

This is the source-of-truth feature matrix for the app and public pricing page.

| Feature | Free | Pro ($9.99/month) |
| --- | --- | --- |
| Saved estimates | 10 per UTC day; 50 per UTC month | 50 per UTC day; 500 per UTC month |
| Estimate drafting | Manual line items with an optional price-book picker | Cloud AI drafts editable scope, quantities, units, and suggested starting customer rates; clear Price Book matches replace AI rates |
| Customer proposal detail | Detailed line items or summary and total only | Detailed line items or summary and total only |
| Price book and reusable estimate templates | Included | Included |
| Saved customer contacts for reuse on estimates | Included | Included |
| Customer proposal links, review, and approval | Included | Included |
| Customer proposal questions | Saved in the app; no contractor email alert | Saved in the app with contractor email alert |
| Basic estimate pipeline and acceptance reports | Included | Included |
| Branded proposal email and automated follow-ups | Not included | 5 customer-facing messages per UTC day; 100 per UTC month |
| Estimate photos and voice-note cloud storage | Not included | 100 MB uploaded per UTC month; 250 MB and 100 files retained |
| Job scheduling, job tracking, actual costs, and invoice status | Not included | Included |
| Create and print an invoice from an accepted estimate/job | Not included | Included; customers pay from the accepted proposal link |
| Job-value and gross-profit report metrics | Not included | Included |
| Good / Better / Best package options and proposal deposit terms | Not included | Included |
| Customer down payments, pay-in-full, and remaining-balance payments through Stripe | Not included | Included; requires contractor Stripe setup |

Free estimates use manually entered line items and optional Price Book items. Both Free and Pro contractors can choose whether a customer proposal shows detailed line items or a work summary and final total only. In summary mode, detailed line items are omitted from the public proposal response, while remaining available to the contractor. Reusable customer contacts, templates, and basic estimate reporting are included. Pro cloud AI drafts editable scope, quantities, units, and broad starting customer rates; a clear match in the contractor's Price Book replaces the AI rate. AI rates are not live local supplier quotes and must be reviewed before sharing. Pro cloud AI has 5 attempts per UTC day and 50 per UTC month. Provider failures count once an attempt is admitted. Gemini remains on the configured provider tier and existing data-handling setup; these app quotas limit workload, not the provider's terms or processing. Pro estimate emails, follow-ups, proposal-question email alerts, and invoice emails use provider-backed services and share a 5/day, 100/month per-account allowance. All caps reset at 00:00 UTC or the start of a UTC month. The platform-wide Resend ceiling remains 75 messages per UTC day (admin-adjustable up to 90); platform capacity can pause messages before a user's own allowance is exhausted. A saved estimate is counted when its database row is successfully created; the quota is atomic and failed inserts do not consume quota. Existing estimates are counted toward the current period when the migration is applied, and deleting an estimate does not restore a quota slot.

Pro includes 50 estimates per day and 500 per UTC month, replacing the previous unlimited-estimate description. The Free daily ceiling can be lowered by a super administrator (0–10); it cannot be raised above the plan's advertised maximum. The Pro AI per-account daily ceiling can be lowered (1–5); the monthly cap is 50. The platform AI safety ceiling remains 250 attempts per UTC day. Private media permits 100 MB of newly uploaded data per UTC month, 250 MB retained at a time, and 100 files. Deleting uploaded media frees retained storage but does not restore monthly upload bytes. Per-account media reservations are serialized across app instances; the uploaded-byte counter is durable.

The app shows current usage and remaining allowances on Profile and surfaces estimates/AI allowances in their creation flow and remaining email capacity after a successful send. Daily allowances reset at 00:00 UTC; monthly allowances reset at 00:00 UTC on the first of each month. Unused quota does not roll over. A later higher tier may offer different caps, but no additional tier is available today.

Jobs, invoices, and uploaded estimate media remain in the database/storage if a Pro subscription ends. Owners retain read access to those records and can use them again if Pro is reactivated; database row-level security blocks free-tier writes to job/invoice data, new estimate attachments, and storage uploads. The database also blocks free-tier changes that enable deposit terms or package options.

Pro checkout and subscription management are available from **Profile & Preferences → Your plan**. The marketing site's plan links lead to app signup; customers can create a free account and upgrade from Profile. Pro has no separate trial requirement.

The public support form remains available to prospective customers and is protected by request size checks, origin validation, a honeypot, and IP-based rate limits. Support and retention mail count against the shared 75/day platform email ceiling, but not an individual Pro customer's 5/day and 100/month allowance. Those business-support messages are operational overhead rather than an app tier feature.

## Planned security improvement with a Supabase plan upgrade

When WorkCraft AI upgrades Supabase to a plan that supports Auth session duration controls, configure a **30-day inactivity timeout** and a **90-day maximum session lifetime**. Keep the current refreshable session behavior until then so contractors can work on phones without unnecessary daily sign-ins. Before enabling the limits, verify that normal use refreshes the session, inactive users are asked to sign in again, and estimates in progress recover safely after reauthentication. This is a future Auth configuration and verification task; it does not change the current session behavior or require a schema migration.

## Invoice and payment flow

An accepted estimate can be converted into a Pro job and a printable invoice. The invoice view links back to the accepted proposal, where customers can pay an enabled deposit or remaining balance through Stripe Checkout. WorkCraft AI does not currently provide a separate emailed, customer-facing invoice portal. Customer charges use Stripe Connect direct charges on the contractor's connected account; WorkCraft AI does not receive or transfer customer funds. Stripe-hosted onboarding collects contractor verification and payout details. The contractor is responsible for the work, payment terms, customer support, refunds, and disputes.
