# October 10 provider acceptance evidence

## Scope and result

Preview Stripe tests used the owner's authorized shared Test-mode account and dedicated Staging fixtures. No live charge or Production customer mutation was performed. Production two-account isolation and hosting-plan review are deferred by the owner; the owner accepted the iPhone walkthrough. Neither deferred check is marked passed.

| Check | Result | Evidence / limit |
| --- | --- | --- |
| In-flight Stripe event | Passed | Actual destination returned HTTP 503 so Stripe can retry. |
| Stale claim recovery | Passed | Claim aged beyond five minutes; actual provider replay processed on attempt 2. |
| Completed duplicate | Passed | Actual replay returned HTTP 200 with `duplicate: true`. |
| Async Checkout success | Passed for webhook state | Connected test async success processed; later failure and expiry did not regress a succeeded payment. The EUR fixture was a state-ordering probe, not an amount/currency or UI-checkout acceptance test. |
| Subscription lifecycle | Passed for stored billing state | Created/active → renewal failure/past_due → paid recovery/active → period-end cancellation/active → deletion/canceled. |
| Effective downgrade | Open | The dedicated owner has an admin Pro grant. Billing-state transitions do not prove effective Free access for an ordinary subscriber. |
| Refund ordering | Passed | Matching $1 USD test payment refunded 50 cents, then 100 cumulative cents. Stale partial-refund and success events were reprocessed; ledger remained refunded with 100 cents. |
| Billing notice queue | Passed | Exactly one past-due notice queued. Removed the obsolete pending fixture after recording evidence. |
| Billing notice delivery | Open | Preview lacks approved Resend sending/webhook configuration. No billing notice was claimed delivered. |
| Production estimate delivery | Passed | October 10 21:46 UTC message delivered; contractor Reply-To confirmed and sent/delivered correlated to the Production event ledger. |
| Fresh invoice send-from-app | Open | Owner cannot sign in now. Route inspection confirmed owner/Pro guards, shared quotas, branded English/Spanish message and contractor Reply-To; this is not inbox acceptance. |
| Database/Auth encrypted recovery | Passed structurally | Actual Google Drive snapshot decrypted and restored 57 users, 57 identities, one MFA factor, 10 estimates, three jobs and 40 migrations in an isolated local stack. RLS, owner relationships and private Storage policies passed. |
| Production media recovery | Passed | After the owner corrected Storage secrets, guarded run 38092126519 backed up and restored all 3 private files; byte counts and public-access denial passed. Snapshot db1f793c is encrypted in Google Drive. |
| Nonempty media recovery fixture | Passed locally | Synthetic PNG uploaded, downloaded with matching byte counts and remained inaccessible publicly. This does not prove the Production files were backed up. |
| Password/MFA and full app recovery | Open | Requires compatible recovery configuration and owner-controlled sign-in acceptance. No paid project or pause of either existing project was authorized. |

## Provider destinations and retained evidence

Both dedicated Test-mode Stripe destinations target `https://workcraftai-2najy4m4h-workcraftai.vercel.app/api/webhooks/stripe`. Signing secrets and live destinations were not changed. Required CI passed before PRs 106–108 merged; release `7ef57575bd3884a42bcfabbe1131f7a45b493b73` reached Ready for both Production sites. Live app/Auth/database health passed.

The dedicated Staging estimate was `6f3c645c-fced-49a6-82d8-5e4c8b8ed926`. Test payment rows `00861010-0001-4000-8000-000000000001` and `00861010-0001-4000-8000-000000000002`, the canceled subscription row and the obsolete queued notice were removed after evidence collection; processed event ledgers were retained. The remaining incomplete test subscription was terminated, and its fixture-only Staging row was removed. The admin grant was not changed.

Representative processed events:

- Async success: `evt_1UP8VaI4gXr3NtsCOhe1KF8G`; late async failure: `evt_1UP8eHI4gXr3NtsC2Dl9CipK`.
- Past-due update: `evt_1UP8agEZ7pZoq1iG17AGmS0m`; renewal failure: `evt_1UP8ahEZ7pZoq1iGNLjVqPKM`.
- Paid recovery: `evt_1UP8bVEZ7pZoq1iGEv9RbWYG`; subscription deletion: `evt_1UP8dQEZ7pZoq1iG8RsaJQD5`.
- Partial refund: `evt_3UP8gWI4gXr3NtsC0lyNNgT2`; full refund: `evt_3UP8gWI4gXr3NtsC0y9x1BEi`.

Production estimate Resend message `01a127c8-6b62-7150-a41a-11eabf696a55` used `WorkCraft AI <no-reply@workcraftai.com>` and the contractor's address as Reply-To. Delivery was correlated at 21:46:51 UTC. Recipient addresses, message bodies and private proposal tokens are intentionally omitted.

Recovery evidence: [guarded full encrypted restore run 38092126519](https://github.com/workcraft-ai/workcraftai/actions/runs/38092126519), which resolved the earlier zero-file gap in run 38091235906. Earlier failed drills exposed empty Storage-policy export and duplicate Auth import; corrected exports now forward Docker stdin and select non-Auth data schemas explicitly. Raw diagnostic SQL and account hashes are never published.

## Next acceptance steps

1. Repeat full encrypted restore drills periodically and after recovery-tool changes. The initial database/Auth/private-media drill passed; password/MFA sign-in and full recovery-app acceptance remain open.
2. When the owner can sign in, send one disposable invoice to the owner's inbox and verify Resend delivery and contractor Reply-To.
3. Configure approved Preview mail credentials before testing a fresh past-due notice to the owner's inbox. Never enable delivery of obsolete queued fixtures.
4. Complete effective subscriber downgrade and password/MFA/full app recovery acceptance independently of the state/structural tests above.
