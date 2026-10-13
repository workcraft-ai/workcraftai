# Stripe live-mode cutover

The app uses direct charges on contractor connected accounts. Pro subscriptions belong to the WorkCraft AI platform account. Preview stays in Stripe test mode; only Production switches to live mode.

## Verified inventory, October 11, 2026

- Stripe platform account `acct_1EboulEZ7pZoq1iG` has live charges and payouts enabled.
- Active live Pro monthly price: `price_1UMXPCEZ7pZoq1iGAJgCG14x` ($9.99 USD).
- Two enabled **live** webhook endpoints already point to `https://app.workcraftai.com/api/webhooks/stripe`: one subscription endpoint and one payment endpoint. Verify the payment endpoint is scoped to **Connected accounts** in the Stripe Dashboard. Its current event list lacks the dispute events handled by the app.
- Production has one connected-account row from the prior test setup, zero subscription rows, zero checkout-attempt rows, and zero customer-payment rows. One admin-managed Pro grant is active. The saved connected account is not accessible through the live platform account.

## Sequence

1. Deploy migration `20261011140000_stripe_connect_live_mode_cutover.sql` to Production and Preview, followed by the matching app code. The migration marks existing connected accounts as test mode. It preserves a replaced test account ID in `stripe_connected_account_replacements` when a contractor creates a live connection.
2. In Stripe **live mode**, confirm the $9.99 monthly Pro price and the Customer Portal settings for payment method updates, invoices, and cancellation at period end. Confirm the platform account can create Full Dashboard connected accounts with Stripe collecting processing fees and losses.
3. In Stripe live mode, inspect both webhook destinations. The platform subscription endpoint must be scoped to **Your account** and include `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, and `invoice.payment_action_required`. The customer-payment endpoint must be scoped to **Connected accounts** and include `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`.
4. In the Vercel **app** project, update **Production only**: `STRIPE_SECRET_KEY` to the platform's `sk_live_...` key, `STRIPE_PRO_PRICE_ID` to `price_1UMXPCEZ7pZoq1iGAJgCG14x`, `STRIPE_WEBHOOK_SECRET` to the live **Your account** destination's `whsec_...`, and `STRIPE_CONNECT_WEBHOOK_SECRET` to the live **Connected accounts** destination's *different* `whsec_...`. Keep these as private server-side variables. Leave Preview test values unchanged. Vercel does not apply changed values to existing deployments; redeploy Production after all four are saved together.
5. Confirm the deployed app serves the new version. In a Pro contractor account, open Profile → Connect Stripe. The old test connection should show as disconnected, then Stripe should open **live** onboarding without a test-data banner. The contractor must complete verification and payout setup before payments can be enabled. Do not transfer test connected-account IDs to live mode.
6. Use an owner-controlled contractor/customer pair to make one small **live** charge on a disposable accepted estimate. Verify Stripe Checkout says live, the connected account receives the direct charge, the app records it once, and the estimate balance updates. Refund the charge from the contractor's Stripe Dashboard, then verify the app records the refund. This step moves real money and should be performed deliberately by the owner.
7. Verify the live no-card trial using an eligible account: start the 14-day Pro trial, confirm Stripe reports `trialing`, the app grants Pro, and the account returns to Free after cancellation or trial end if no payment method is added. Do not add a payment method unless you intend the $9.99/month subscription to begin after the trial. To test an immediate paid subscription, use an account that is ineligible for the trial and explicitly approve the real $9.99 charge first; verify the subscription webhook grants Pro once and the Customer Portal opens.

## Rollback

If onboarding or payments fail, restore the four previous Production Stripe values together and redeploy. The code will treat live connected accounts as unavailable while the test key is active and vice versa. Do not restore a test-mode key with live webhook secrets. Preserve the database rows and webhook event ledger for investigation; do not delete live payments or subscriptions to roll back an app deployment.
