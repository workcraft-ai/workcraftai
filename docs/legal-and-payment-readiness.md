# Current payment and policy controls

- Customer cards are entered in Stripe-hosted Checkout. WorkCraft AI stores payment references and status, not card numbers. Do not describe the platform as PCI certified; the merchant and Stripe still have their own obligations.
- Estimate sales tax is a contractor-entered percentage. The app calculates from that percentage; Stripe Tax is not enabled. Contractors must check whether work is taxable and handle collection and filing.
- Customer charges are direct charges on connected Stripe accounts. Contractors manage service refunds and disputes in their own Stripe Dashboard. WorkCraft AI Pro subscription refunds follow the separate Terms policy.
- Contractors may enter job-specific payment, cancellation, and refund terms in English and optionally Spanish. The customer sees those terms on the proposal before accepting or paying. The accepted terms are copied into the signed proposal snapshot; accepted estimates cannot be edited. Older estimates have no custom terms unless their owner edits them while pending.
- Signup requires an affirmative Terms and Privacy checkbox. `20261012001000_record_signup_terms_acceptance.sql` records the submitted policy version with a server timestamp in a private table. The record is tied to the Auth user and removed with account deletion; it is evidence of the app signup flow, not proof that a person read every clause.
- The Connect webhook handler notifies a contractor when Stripe reports a new dispute state for a payment recorded in WorkCraft AI. Stripe must deliver `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed` to the **connected accounts** webhook endpoint. Notices use the existing durable email outbox and its reserved billing pool; Stripe Dashboard remains the place to view deadlines and submit evidence. A full billing pool can delay a notice.
- Privacy wording matches the configured 12-month inactivity warning, 30-day response window, backup expiration, and external processor retention. It does not promise deletion from Stripe or Resend.

## Release order

1. Review the new Terms language with qualified counsel for the relevant jurisdictions before a broad public launch. The liability cap and warranty disclaimer are draft product terms.
2. Apply `20261012001000_record_signup_terms_acceptance.sql` and `20261012001100_estimate_payment_terms.sql` to Preview, then Production before deploying the app. Verify the private assent table and Auth trigger exist, browser roles cannot access the assent table, and the estimate terms RPCs exist. Keep the policy version in the form, Terms date, and trigger in sync when policy text changes.
3. Confirm the connected-account Stripe webhook endpoint includes the three dispute events above and that the endpoint signing secret is current. Dispute notifications cannot be verified from a platform-only webhook event.
4. Deploy the app after both migrations are present. Review one new disposable signup's acceptance record, a proposal acceptance snapshot containing custom payment terms, and one connected-account test dispute alert before relying on those controls.

No automated SMS, Stripe Tax, or platform chargeback adjudication is represented as active.
