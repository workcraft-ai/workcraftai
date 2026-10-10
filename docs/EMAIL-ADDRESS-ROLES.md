# WorkCraft AI email address roles

Use separate addresses for automated mail, customer support, public inquiries, and internal alerts. An address can be an alias or forwarding destination; it does not need its own paid mailbox if the email provider supports routing it to an existing inbox.

| Address | Role | Current app behavior |
| --- | --- | --- |
| `no-reply@workcraftai.com` | From address for automated WorkCraft AI app email: estimates, invoices, follow-ups, customer-question notices, support-form notifications, account-retention notices, and subscription billing notices. | Resend-backed app messages use `WorkCraft AI <no-reply@workcraftai.com>`. Replies continue to go to the existing contextual Reply-To address. Supabase Auth SMTP should use this as its automated From address after the setting is updated in Supabase. |
| `support@workcraftai.com` | Customer support contact for the app and the public website support page. | Remains `NEXT_PUBLIC_SUPPORT_EMAIL` and the destination for support-form submissions. Account and billing notices use it as Reply-To. |
| `admin@workcraftai.com` | Internal notifications intended for the system owner or administrator. | No dedicated admin notification email flow currently sends to this address. Use it as an inbox/alias when an admin alert recipient is added. |
| `alerts@workcraftai.com` | Notifications from monitoring and service providers, including UptimeRobot, GitHub, Vercel, Supabase, Stripe, Resend, and Gemini. | Configure this as the notification recipient in each provider. Provider-generated alerts should keep their provider's authenticated From identity. |
| `info@workcraftai.com` | General public inquiries and public company/social profiles, except the website's support page. | Not currently used as an app sender or recipient. The public website's support page stays on `support@workcraftai.com`. |

## Configuration notes

- Resend-backed app email uses `RESEND_API_KEY` and defaults to `WorkCraft AI <no-reply@workcraftai.com>`. `RESEND_NO_REPLY_FROM_EMAIL` is an optional server-only override. The domain/sender must be accepted by the configured Resend account.
- Estimate and invoice email replies go to the contractor's account email. A customer-question alert's Reply-To remains the customer's email. The support form Reply-To remains the submitter. Account-retention and subscription billing notices use `support@workcraftai.com` as Reply-To.
- Supabase Auth email is sent through its separate custom SMTP configuration. Set its sender email to `no-reply@workcraftai.com` in each Supabase environment using custom SMTP, then send a confirmation/reset test. This is a dashboard setting, not an application environment variable.
- Remove the old Vercel `RESEND_FROM_EMAIL` and `RESEND_ESTIMATE_FROM_EMAIL` variables after deploying the unified sender. They are no longer read by the app.
- Zoho is not integrated with app sending. The app sends transactional messages through Resend, so changing these From addresses organizes routing and brand identity but does not reduce Zoho's sending usage. If Zoho hosts the addresses, create aliases/forwarding rules there only for messages you need to receive.
- Pro contractors can send or resend an invoice from its invoice page. The message uses the shared no-reply sender, is addressed to the editable customer email, and sets the contractor's account email as Reply-To. Invoice email reservations count against the same 5/day and 100/month per-account customer-email caps and the platform-wide email ceiling. When the invoice is linked to an estimate, the email includes a link to its accepted proposal for available payment options; WorkCraft AI does not process or collect invoice payments itself.
