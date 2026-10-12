# Customer success and support: founder cohort

This playbook is for the first contractor cohort. The product has a public Help Center at `/help`, a support form at `/support`, and email at `support@workcraftai.com`. It does **not** offer staffed chat or phone support. Do not promise round-the-clock availability or a guaranteed resolution time.

## First five minutes

1. A new contractor acknowledges the Terms and Privacy Policy during signup and confirms their email. One idempotent welcome email links to the Dashboard and Help Center. Existing accounts are not backfilled.
2. On first Dashboard visit, guide them through business name, default tax and markup, plus optional name, business address, phone, public logo URL, and brand color. Explain that tax settings are starting values to verify locally.
3. Guide them to create one estimate with their own scope and prices. AI and Price Book are optional for the first estimate.
4. Guide them to preview the customer view, then copy a test customer link. Copying a link does not notify the customer.
5. Guide them to save one reusable Price Book rate. They may skip the checklist and resume it later.

Track the fraction of new confirmed users who save a first estimate within seven days, plus the step where they stop. Never count link copying as delivery or a customer view. Review the weekly activation scorecard in `docs/FOUNDER-FIRST-90-DAYS.md`.

Before releasing this flow, apply the signup Terms record migration and `20261012002952_customer_onboarding_welcome.sql` to the target Supabase project, then deploy the matching app revision. Confirm that the no-reply sender is verified in Resend and the notification retry schedule is active. In Preview, use a fresh account and an inbox you control to check one confirmation email, one welcome email, and the first-login checklist; confirm that a Dashboard reload does not send a second welcome. Watch the shared 75/day app email pool as the cohort grows.

## Self-service articles

The Help Center has ten English and Spanish guides: first estimate; business name and logo; Price Book; AI draft pricing; sharing an estimate; finding customer questions; accepted-work invoices; Stripe connection; customer payments and payouts; and sign-in recovery. Update a guide when the corresponding UI or payment flow changes. Each guide should remain short enough to follow while using a phone.

## Channels and case handling

| Channel | Current use | Handling |
| --- | --- | --- |
| Help Center | How-to and account-recovery guidance | Update when repeat questions reveal a confusing step. |
| In-app/public support form | Product problems and account questions | Sends one email to support with a `WC-SUP-…` case reference and requester Reply-To. The sender gets that reference on screen. Public form submissions do not trigger automatic reply mail. |
| Support email | Follow-up, screenshots, complex cases | Keep the case reference in the subject and reply in the same thread. |
| Chat/phone | Not staffed | Do not display or advertise them until coverage and tooling exist. |

The case reference is an inbox-thread identifier, not a database ticket or a promise of SLA. The form is rate-limited and draws from the shared email budget. If the form fails, ask the user to email support directly. Never request passwords, reset links, MFA codes, full card numbers, bank details, or identity documents.

### Internal response targets

These are founder-operated **targets**, not public contractual SLAs. Revisit when staffing or volume changes.

| Priority | Examples | First human response target | Next action |
| --- | --- | --- | --- |
| P0 | Suspected unauthorized access; confirmed customer charged twice; broad payment outage | During staffed hours, as soon as noticed; aim for 2 hours | Preserve evidence, verify in Stripe/Supabase, contain if necessary, and communicate an owner and next update time. |
| P1 | Payment taken but app unpaid; contractor cannot sign in; estimate cannot be sent | Within 1 business day | Confirm account/estimate reference and time; inspect provider event and app log; avoid asking customer to pay again. |
| P2 | Wrong rate, confusing workflow, individual feature failure | Within 2 business days | Give a safe workaround or reproduction request; file a product issue if repeatable. |
| P3 | How-to, feature suggestion | Within 3 business days | Link to the relevant guide and record the request. |

Use the contractor's time zone when setting a follow-up time. If an issue is unresolved at the target, acknowledge it and provide the next update time. Resolution depends on the provider and cause; do not promise a fix date without evidence.

### Triage checklist

1. Identify the case reference, reporter, environment (Production or Preview), account email, URL or estimate reference, device/browser, and approximate time. Request the least information needed.
2. Separate account access, app workflow, email delivery, subscription billing, and contractor customer payment. Stripe connected-account payments and WorkCraft AI Pro subscriptions are different flows.
3. For payment reports, check Stripe's live/test mode, connected account, Checkout Session/payment status, webhook deliveries, and the app's payment record before advising a retry. Do not infer payment from a screenshot alone.
4. For delivery reports, check the app outbox/event state and Resend delivery or suppression event. If provider outcome is uncertain, do not resubmit blindly.
5. Keep the case thread and record the action, evidence, customer update, and final outcome. Escalate P0/P1 to the owner immediately.
6. Remove personal details from product issue tickets. Keep payment, identity, and support data within their existing retention rules.

## Canned replies

Use the case reference and adapt the facts. Never imply a payment is complete or an email delivered until the provider confirms it.

**Estimate link / English**

> Hi {name}, saving an estimate creates its customer link but does not send it. Open the estimate from Dashboard, review the customer view, then copy the link. You can send it from your own text or email app; Pro also has Email client. If you still cannot find the link, reply with the estimate reference and what you see. Case {case_reference}.

**Enlace de cotización / Español**

> Hola, {name}: guardar una cotización crea su enlace para el cliente, pero no lo envía. Ábrela desde el Panel, revisa la vista del cliente y copia el enlace. Puedes enviarlo desde tu aplicación de mensajes o correo; Pro también incluye Enviar correo al cliente. Si no encuentras el enlace, responde con la referencia de la cotización y lo que aparece. Caso {case_reference}.

**Payment discrepancy / English**

> Hi {name}, thanks for reporting this. Please do not ask the customer to pay again while we check. Send the estimate reference, amount, approximate payment time and time zone, and whether Stripe shows a completed payment. Do not send card or bank details. We will compare Stripe and the app record and update you by {time}. Case {case_reference}.

**Diferencia de pago / Español**

> Hola, {name}: gracias por avisarnos. No pidas al cliente que vuelva a pagar mientras revisamos el caso. Envíanos la referencia de la cotización, el importe, la hora aproximada y zona horaria, e indica si Stripe muestra el pago completado. No envíes datos de tarjeta ni de banco. Compararemos Stripe con el registro de la aplicación y te informaremos antes de {time}. Caso {case_reference}.

**Sign-in / English**

> Hi {name}, please use Forgot password with your WorkCraft AI account email and allow a short time for delivery. Check spam as well. If a workplace security page blocks the app, send the blocked hostname and the reason shown, but not your password, reset link, or security code. Case {case_reference}.

**Acceso / Español**

> Hola, {name}: usa Olvidé mi contraseña con el correo de tu cuenta y espera un momento. Revisa también la carpeta de spam. Si una página de seguridad del trabajo bloquea la aplicación, envíanos el dominio bloqueado y el motivo indicado, pero no tu contraseña, enlace de restablecimiento ni código de seguridad. Caso {case_reference}.

**AI rate / English**

> Hi {name}, AI prices are broad starting estimates. A clear Price Book match uses your saved rate; weaker matches remain suggestions for you to choose. Please verify the unit, quantity, labor/material assumptions, local price, and tax before sharing. If a saved rate should have matched, send the estimate reference and the Price Book item name, without customer private details. Case {case_reference}.

**Precio de IA / Español**

> Hola, {name}: los precios de IA son puntos de partida generales. Una coincidencia clara con la lista de precios usa tu tarifa guardada; las menos claras quedan como sugerencias para que las elijas. Verifica unidad, cantidad, mano de obra/materiales, precio local e impuestos antes de compartir. Si esperabas una coincidencia, envía la referencia de la cotización y el nombre del artículo, sin datos privados del cliente. Caso {case_reference}.

## Ongoing review

Review volume by topic, response time, repeat contacts, first-estimate blockers, welcome delivery, shared provider quota, and guide usefulness weekly. When a question repeats three times, improve the product or article before adding another canned answer. Consider chat or phone only after staffing, hours, identity verification, audit logging, and abuse controls are ready.
