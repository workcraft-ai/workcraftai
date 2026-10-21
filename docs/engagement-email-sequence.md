# Account engagement email sequence

The welcome email after account verification remains unchanged. A separate Vercel Cron route, `/api/cron/engagement`, checks eligible accounts daily at 13:00 UTC. On Vercel Hobby, execution may occur later within that hour.

The route is authenticated with `CRON_SECRET`. Product emails include an unsubscribe link and support email in plain-text and HTML footers. `ENGAGEMENT_POSTAL_ADDRESS` is optional in the current deployment; when supplied, its value appears in the footer. This is a known U.S. CAN-SPAM compliance gap until a valid business mailing address or PO box is supplied. Do not use a private home address without deciding to publish it. Essential account, security, trial, payment, and customer emails are unaffected.

Only accounts created after the first enabled daily run are enrolled in the getting-started sequence. Eligibility is based on the first confirmed, authenticated app visit:

| Timing | Condition | One-time email |
| --- | --- | --- |
| Day 2 | No saved estimate | First estimate can be simple |
| Day 7 | Saved estimate, never viewed or shared | See what your customer will see |
| Day 7 | Estimate link copied or estimate emailed, but no Price Book rate | Save a reusable rate |
| 14 days since last app use | Account was used and then inactive | One return reminder for that inactivity period |
| Around day 30 | Account active in prior 7 days and opted into guides | One trade-relevant guide |

The first three messages and return reminder can be disabled from Profile. The day-30 guide is off until the user explicitly opts in. A return reminder cannot repeat until the user returns and subsequently has another inactive period. A queued email is rechecked immediately before sending, so it is skipped if the account has progressed or unsubscribed. Outstanding essential email is processed first; an essential email already sent does not suppress a due tip.

Admin Support → Engagement emails shows the last 90 days of claimed, sent, delivered, failed, and delivery-issue counts. Its seven-day outcome denominator includes only messages sent at least seven days ago. Outcomes are observed estimate creation, owner review/link copy/estimate email, Price Book rate creation, or app return after the send. This is observational, not a causal attribution claim. A copied link does not prove the customer received it.

For rollout, apply the database migration before deploying the app and cron. Inspect the first few daily runs and Resend delivery events. When a publishable mailing address is available, set `ENGAGEMENT_POSTAL_ADDRESS` in Production and redeploy so it appears in future messages. The send volume uses the general app email budget and never consumes a contractor's email allowance.
