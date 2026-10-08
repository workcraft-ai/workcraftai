# WorkCraft AI plans and feature boundaries

This is the source-of-truth feature matrix for the app and public pricing page.

| Feature | Free | Pro ($9.99/month) |
| --- | --- | --- |
| Saved estimates | 10 new estimates per UTC day | Unlimited |
| Estimate drafting | Manual line items with an optional price-book picker | Cloud AI drafts editable scope and quantities, matched against the user's price book |
| Price book and reusable estimate templates | Included | Included |
| Saved customer contacts for reuse on estimates | Included | Included |
| Customer proposal links, review, and approval | Included | Included |
| Customer proposal questions | Saved in the app; no contractor email alert | Saved in the app with contractor email alert |
| Basic estimate pipeline and acceptance reports | Included | Included |
| Branded proposal email and automated follow-ups | Not included | Included |
| Estimate photos and voice-note cloud storage | Not included | Included |
| Job scheduling, job tracking, actual costs, and invoice status | Not included | Included |
| Create and print an invoice from an accepted estimate/job | Not included | Included; customers pay from the accepted proposal link |
| Job-value and gross-profit report metrics | Not included | Included |
| Good / Better / Best package options and proposal deposit terms | Not included | Included |
| Customer down payments, pay-in-full, and remaining-balance payments through Stripe | Not included | Included; requires contractor Stripe setup |

Free estimates use manually entered line items and optional price-book items. Reusable customer contacts, templates, and basic estimate reporting are included. Pro cloud AI drafts editable scope and quantities using the contractor's price book. Pro estimate email, follow-ups, and proposal-question email alerts use provider-backed services and require an active subscription. A saved estimate is counted when its database row is successfully created; the quota is atomic and resets at 00:00 UTC. Failed inserts do not consume quota.

Jobs, invoices, and uploaded estimate media remain in the database/storage if a Pro subscription ends. Owners retain read access to those records and can use them again if Pro is reactivated; database row-level security blocks free-tier writes to job/invoice data, new estimate attachments, and storage uploads. The database also blocks free-tier changes that enable deposit terms or package options.

Pro checkout and subscription management are available from **Profile & Preferences → Your plan**. The marketing site's plan links lead to app signup; customers can create a free account and upgrade from Profile. Pro has no separate trial requirement.

The public support form remains available to prospective customers and is protected by request size checks, origin validation, a honeypot, and IP-based rate limits. Those business-support messages are operational overhead rather than an app tier feature.

## Invoice and payment flow

An accepted estimate can be converted into a Pro job and a printable invoice. The invoice view links back to the accepted proposal, where customers can pay an enabled deposit or remaining balance through Stripe Checkout. WorkCraft AI does not currently provide a separate emailed, customer-facing invoice portal. Customer charges use Stripe Connect direct charges on the contractor's connected account; WorkCraft AI does not receive or transfer customer funds. Stripe-hosted onboarding collects contractor verification and payout details. The contractor is responsible for the work, payment terms, customer support, refunds, and disputes.
