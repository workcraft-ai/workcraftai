# Founder cohort: first 90 days

## Who this is for

Start with approximately a dozen independent trade and service contractors who create estimates on their phones. The initial promise is a clear estimate, a customer link, and an approval path without requiring the customer to create an account. Pro adds branded email, assisted drafting, job scheduling, invoices, and Stripe payments. Avoid positioning this as a full crew-management or accounting suite.

## First-value journey

1. Confirm the contractor's signup email arrives and they can sign in on their phone.
2. Ask them to make **one real estimate**: customer, scope, quantity, unit, price, then save. They can set up a price book later. Check that tax, markup, assumptions, and the customer-facing summary are understood before sharing.
3. Have them copy the customer link from the dashboard or estimate and send it using their own text/email app. Pro subscribers can choose branded email instead. Copying a link does not deliver it. A viewed proposal is a better signal than a copied link.
4. Ask the customer to review, ask a question, and approve or decline. Typed-name approval records intent; it is not a separate e-signature service.
5. If the customer accepts, ask whether the contractor can find the next step (job, invoice, deposit) without coaching. Record the friction before adding features.

## Weekly scorecard

Review aggregate counts from existing account, estimate, proposal-view, question, and subscription records. The public website uses optional, consent-based Google Analytics for page views and signup-link clicks; the signed-in app and customer proposal pages have no Google Analytics tag. Do not send customer content or account identifiers to analytics. Public-site counts include only visitors who allow analytics, so they are not a complete visitor census. Record a weekly snapshot with its date and definitions; exclude known founder/test accounts only when clearly tagged in the notes, so the denominator does not shift silently.

| Measure | Definition | Why it matters |
| --- | --- | --- |
| New verified accounts | New accounts that completed email confirmation during the week | Signup delivery and activation baseline |
| First estimate | New accounts with at least one saved estimate within 7 days of confirmation | Time to first value |
| Repeat estimate | Activated accounts with at least two saved estimates within 30 days | Early retention |
| Customer viewed | Accounts with at least one estimate with `proposal_viewed_at` set | Evidence that a link reached a customer |
| Customer response | Accounts with an approval, decline, or proposal question | Evidence of a useful two-way workflow |
| Pro conversion | Accounts with an active paid Pro subscription; report admin grants separately | Whether the upgrade solves a real need |
| Support friction | Count of distinct account-reported blockers and their resolution time | Priority for fixes |

Do not label link-copy requests as “sent” or count them as customer views. Do not infer estimate acceptance or payment from an email delivery event. Follow the data-retention and access rules in the production runbooks when reviewing account-level records.

## Days 1–30: observe first quotes

- Recruit a small, consent-based cohort across a few trades and phone types. Use fictional examples in public screenshots.
- Sit with at least a few contractors as they try signup, first estimate, price entry, sharing, and customer approval. Record the step where they need help and the time from sign-in to the first saved estimate.
- Review the weekly scorecard and support questions. Fix repeatable first-quote failures before adding more features.
- Inspect Resend usage and suppression, Supabase Auth delivery, AI errors, backup status, and uptime alerts weekly. Keep the existing per-account and shared provider caps enforced.

## Days 31–60: improve repeat use

- Test whether a small price book and saved customers make the second estimate faster. Ask contractors which rates they trust and which items still need manual review.
- Verify that summary versus detailed proposals are understood, and that totals, tax, markup, and deposit terms are reviewed before sharing.
- Validate Pro email, invoice, Stripe onboarding, deposit, and recovery flows with owner-controlled test accounts. Use test mode for payments; do not describe a test event as a live sale.
- Decide whether branded email capacity is reliable enough to expand Free sending. A Free allowance must be enforced in the server quota and abuse controls, backed by adequate provider capacity, and reflected in both plans before launch. The current Free offer is a copyable link.

## Days 61–90: decide on positioning and pricing

- Compare weekly first-estimate, customer-view, repeat-use, and paid-conversion trends with interview notes. Segment by trade only if the sample is large enough to avoid misleading conclusions.
- Ask paying users which Pro task they would lose if they cancelled. Review support and churn reasons before changing the $9.99 price or adding payment markup.
- Prioritize one repeated blocker at a time. Do not promise crew roles, bookkeeping integrations, richer job photo workflows, supplier import tools, SMS, or customer self-booking until they are designed and shipped.
- If commercial sales begin, the owner must move the Vercel deployment off Hobby under Vercel's applicable plan terms and review Resend/provider capacity. Confirm the resulting operating cost against actual Pro revenue before expanding email or AI caps.

## Release truth and guardrails

- Free has manual and price-book estimates, a copyable customer proposal link, customer review/approval, and basic reports. It does not send branded estimate email through WorkCraft AI.
- Pro provides limited branded email, AI attempts, jobs, invoices, and Stripe payment access. Stripe processing fees are separate from the Pro subscription; WorkCraft AI currently adds no per-payment fee.
- AI rates are broad starting estimates, not live local supplier quotes. The contractor must review units, quantities, scope, prices, tax, and terms.
- A customer-view timestamp means the proposal page was opened. It does not prove understanding, acceptance, or payment.
- Keep production isolation, backup restore, alerting, and payment acceptance checks in the existing readiness runbooks. This cohort plan does not replace those gates.
