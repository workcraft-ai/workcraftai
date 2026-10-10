# WorkCraft AI production readiness audit — October 10, 2026

> Historical audit snapshot. Implementation and deployment follow-up is tracked in [the release checklist](PRODUCTION-READINESS-RELEASE.md). The findings below describe the code before these fixes.

## Executive Summary Checklist

**Decision: action required before treating the product as fully production ready.** No confirmed critical vulnerability or observed exploitation was found. Four high-severity implementation defects affect upload costs, refund accounting, Price Book pricing, and customer package totals. Passing existing tests does not clear these defects.

| Pillar | Result | What remains |
| --- | --- | --- |
| 1. Supabase/database security | Action required | Make monthly media accounting resistant to malicious client finalization; fix lock ordering; repeat authenticated API/Storage isolation. |
| 2. Auth/authorization/tiering | Action required | Preserve refreshed cookies on redirects; finish authenticated browser verification. Server entitlement and ownership checks passed source review. |
| 3. Stripe | Action required | Serialize payment state changes and prevent older refund events from lowering recorded refunds; run the Preview event matrix after fixing it. |
| 4. Resend/integrations | Action required | Repair scheduled follow-ups, Spanish follow-up content, invoice delivery correlation, and notification retries; configure DMARC and bound aggregate email usage. Zoho is out of scope. |
| 5. Business workflows | Action required | Correct package totals, distinguish pricing units, preserve partial-work quantities. |
| 6. Vercel/code/operations | Action required | Fix voice-note CSP and invoice request-body cap; complete a recovery-project restore drill. |
| 7. Marketing/app UI | Action required | Address accessibility findings and small controls; update stale dashboard illustration and remaining Spanish strings. |
| 8. Verification | Action required | New repeatable scripts are provided. Authenticated isolation, payment delivery, and restore verification remain incomplete this audit. |

### Verified evidence

- Source audited: `codex/ai-estimate-accuracy-20261010`, commit `69bb11aafb2f38e9c0e3f5ecf58bfe070190efba`. GitHub's deployed main commit is `0f2046d6d1e8629bd819fc3eec24defc636856a0` (squashed AI accuracy changes). Current main was checked through GitHub rather than relying on the stale local `origin/main` ref.
- Vercel app deployment `dpl_9xCdRMZSpD46wF7LcMQ4T1QZHvsc` is Ready. Project and environment metadata are accessible now. Production secret **names and targets** were checked; secret values were not printed or independently validated.
- Production `ivioejiiigtbmhpzjuni` and Staging `wuebymyvhzieockrohyp` have **37 matching migration versions**, through `20261010115121_invoice_email_quota_and_tracking`.
- Live inventory: all returned public/private/storage tables have RLS enabled. The `estimate-media` bucket is private. Zero-policy internal tables are intentionally inaccessible to browser roles; `force_rls=false` does not itself mean tenant isolation is absent.
- `npm test`: **45/45 passed**. Typecheck and production build passed. Lint passed with one warning. Production dependency audit reported **zero vulnerabilities**.
- [Deployed-main CI](https://github.com/workcraft-ai/workcraftai/actions/runs/38068724792) succeeded, including database security and estimate/AI/checkout/email concurrency checks.
- [Daily encrypted backup](https://github.com/workcraft-ai/workcraftai/actions/runs/38023344154) succeeded, including Auth export. [Manual full-media backup](https://github.com/workcraft-ai/workcraftai/actions/runs/37784983957) also succeeded, including private media. **Successful backups are not evidence of a successful restore.**
- Production smoke passed health and six public-page markup checks. It stopped on a Pro test-account Auth fetch error; the new two-account API/Storage checks therefore **did not complete**. Earlier owner-supplied SQL isolation results remain useful historical evidence, not a substitute for this check.
- Unauthenticated entitlement, AI, and admin APIs returned 401; an unsigned Stripe webhook returned 400. Production GET `/api/cron/followups` returned **405**.
- Browser audit completed **42 public page/viewport/language checks** at 375, 768, and 1280 px. All had the requested HTML language, zero navigation errors and zero horizontal overflow. All exposed contrast findings; signup also exposed a link distinguished only by color. Sanitized machine output is `.audit-results/browser-readiness.json`; see Pillar 7. Authenticated browser checks were not run without usable browser states.
- The owner previously confirmed monitoring alert delivery and subscription Terms review. Those are **owner-confirmed**, not re-opened as missing work. Immediate downgrade on `past_due`, cancellation at period end, and no refunds except where law requires remain the selected policies.

### Scope and limits

Repository review covered API routes, auth/session helpers, migrations and policies, payments, email flows, AI generation/matching, money calculations, public/app UI, environment declarations, workflows, and runbooks. Live inspection covered database metadata, Vercel metadata, Resend domain/webhook metadata, GitHub CI/backups, public HTTP responses, and public browser behavior. This is not a claim that every possible execution path or signed-in interaction was dynamically exercised.

No deployment, migration, live charge, customer email, or production application-data mutation was performed. Proposed patches below are reviewable implementation guidance, **not applied fixes**. Auth calls can create login/audit records even when a smoke script does not change application data. Do not disable CAPTCHA to run the smoke suite; use a legitimate browser session instead.

## Pillar 1 — Supabase and database security

### Passes

Tenant-owned estimates, customer contacts, line items, jobs, attachments, and payment records use caller ownership or parent-estimate ownership policies. Server-only usage/admin/webhook tables have restricted grants. Audited privileged RPCs use an empty `search_path` and explicit caller checks. Service-role keys are used by backend modules; no secret was found behind a `NEXT_PUBLIC_` name. Share links use non-guessable UUIDs and filtered customer-facing responses with no-store/noindex.

### DB-1 [HIGH] Monthly media allowance can be bypassed by the caller

**Reference:** `supabase/migrations/20261009025908_per_account_plan_quotas.sql:703` and `:718`; current live `public.workcraft_finish_estimate_media_upload(uuid,boolean)` has the same logic. The current upload guard is in `20261009154714_restore_estimate_media_upload_serialization.sql:59`.

**Vector:** an authenticated Pro user can upload an object, finalize with `p_uploaded=false`, then delete the object and repeat. The reservation is released without charging monthly bytes. Retained-file/byte caps still constrain stored files, but the advertised 100 MB monthly upload ceiling does not reliably constrain consumed upload traffic. Deleting before the abandoned-reservation reconciliation also loses evidence. This is a cost-control vulnerability, not demonstrated cross-account access.

**Fix:** treat Storage evidence as authoritative, serialize reservation lookup/upload/finalization/deletion with the same user lock, and prevent deletion while a successful upload remains uncharged. Removing the Boolean condition alone is insufficient. Implement all of these together:

1. In the current four-argument `private.workcraft_can_upload_estimate_media`, move the existing advisory lock **before** selecting/checking the reservation, retaining all ownership, Pro, MIME, size, and retained-cap checks.
2. Replace the finalizer with the function below. The Boolean remains only for call compatibility.
3. Replace the delete policy with a helper that obtains that lock before checking for a reserved object, so a caller cannot erase accounting evidence before finalization. After uploading, finalize before enabling the delete button. On a failed finalization, retain the pending state and retry it.

```sql
create or replace function public.workcraft_finish_estimate_media_upload(
  p_reservation_id uuid, p_uploaded boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_row public.tradeflow_media_upload_reservations%rowtype;
  v_bytes bigint;
begin
  if v_user is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':estimate-media', 0));
  select r.* into v_row from public.tradeflow_media_upload_reservations r
    where r.id = p_reservation_id and r.user_id = v_user for update;
  if not found then return false; end if;
  if v_row.status = 'consumed' then return true; end if;
  if v_row.status <> 'reserved' then return false; end if;
  select case when (o.metadata ->> 'size') ~ '^[0-9]+$'
    then (o.metadata ->> 'size')::bigint else null end into v_bytes
    from storage.objects o
    where o.bucket_id = 'estimate-media' and o.name = v_row.storage_path;
  if found then
    -- Keep a malformed-size object pending for server reconciliation.
    if v_bytes is null or v_bytes < 1 then return false; end if;
    insert into public.tradeflow_media_monthly_usage(user_id,usage_month,bytes_uploaded)
      values(v_user,v_row.usage_month,v_bytes)
      on conflict(user_id,usage_month) do update set bytes_uploaded =
        public.tradeflow_media_monthly_usage.bytes_uploaded + excluded.bytes_uploaded;
    update public.tradeflow_media_upload_reservations
      set status='consumed',finished_at=pg_catalog.now() where id=v_row.id;
    return true;
  end if;
  update public.tradeflow_media_upload_reservations
    set status='released',finished_at=pg_catalog.now() where id=v_row.id;
  return false;
end; $$;
revoke all on function public.workcraft_finish_estimate_media_upload(uuid,boolean)
  from public,anon;
grant execute on function public.workcraft_finish_estimate_media_upload(uuid,boolean)
  to authenticated;

create or replace function private.workcraft_can_delete_estimate_media(p_path text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or pg_catalog.split_part(p_path,'/',1) <> v_user::text
    then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':estimate-media',0));
  return not exists(select 1 from public.tradeflow_media_upload_reservations r
    where r.user_id=v_user and r.storage_path=p_path and r.status='reserved');
end; $$;
revoke all on function private.workcraft_can_delete_estimate_media(text) from public,anon;
grant execute on function private.workcraft_can_delete_estimate_media(text) to authenticated;
drop policy if exists "Users delete their own estimate media" on storage.objects;
create policy "Users delete their own estimate media" on storage.objects
  for delete to authenticated using(bucket_id='estimate-media'
    and private.workcraft_can_delete_estimate_media(name));
```

**Verification:** in a disposable Staging fixture, upload then finalize false; bytes must still increase. Attempt delete before finalization, double finalization, overlapping upload/finalize/delete, expired reservations, unknown metadata, and account-B access. The historical source probe is not a replacement for those transactional tests.

### DB-2 [MEDIUM] Inconsistent lock ordering permits a deadlock

**Reference:** quota migration `:640` / `:714` / `:717`.

**Vector:** reservation reconciliation takes the advisory lock then reservation-row locks; finalization currently takes a row lock then the advisory lock. An expired reservation being finalized concurrently can deadlock and make a legitimate upload fail.

**Fix:** acquire the shared advisory lock before any reservation row lock, as in DB-1, and use that order in all related functions. Add the overlap case to the concurrency suite.

### DB-3 [LOW] Bearer proposal links cannot be revoked independently

**Reference:** `app/api/proposals/[id]/route.ts:20` and `:58`.

**Vector:** forwarding a UUID link grants access to customer-facing contact details and refreshed photo URLs while the estimate exists. UUID entropy prevents practical guessing, but does not prevent unwanted forwarding.

**Fix:** add revocable, optional-expiry share tokens. Store a SHA-256 token hash; look it up through a narrowly scoped backend query and check revocation/expiry before signing media. Do not change contractor API ownership checks.

```ts
import { randomBytes, createHash } from 'node:crypto';
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
// Persist tokenHash + estimate_id + revoked_at + expires_at server-side.
// Show token once in the new customer link; never expose the stored hash.
```

**Configuration note:** leaked-password screening remains disabled on the selected free Supabase plan. This is an accepted constraint, not a newly discovered bypass. Existing admin MFA and Auth protections should remain enabled. SECURITY DEFINER advisor warnings for caller-scoped RPCs require continued review, not broad grants or removing RLS. See [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Pillar 2 — Authentication, authorization, tiering

### Passes

API handlers verify Supabase sessions and derive Pro access from subscription state/admin grants. Estimate, AI, email, payment, and media caps use server/database checks, not editable React state. Downgrade preserves saved data. Production admin access is MFA gated. Signup/recovery responses and CAPTCHA components were reviewed; widget presence alone does not prove server-side CAPTCHA configuration.

### AUTH-1 [MEDIUM] Redirects discard refreshed session cookies

**Reference:** `app/utils/supabase/middleware.ts:17`, `:51`, `:57`.

**Vector:** `setAll` puts renewed cookies on `supabaseResponse`, but login/protected-route branches return a new redirect response without copying them. A refresh followed by a redirect can leave a stale session cookie and cause extra login/refresh loops.

**Fix:** copy renewed cookies to redirects; do not log them.

```ts
const redirectWithSession = (url: URL) => {
  const response = NextResponse.redirect(url);
  for (const cookie of supabaseResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
};
// Both redirect branches return redirectWithSession(url).
```

### AUTH-2 [LOW] Protected-page redirect coverage is inconsistent

**Reference:** `app/utils/supabase/middleware.ts:39`; `/customers`, `/profile`, `/admin/support` pages.

**Vector:** those pages are omitted from the optimistic route redirect list, while backend/RLS protection still exists. Logged-out visitors can encounter a partial form or client error instead of a consistent sign-in flow. No tenant-data leak was demonstrated.

**Fix:** use exact route boundaries and protect the full internal navigation set, preserving public estimate views.

```ts
const internalRoots = ['/dashboard','/customers','/schedule','/pricebook',
  '/reports','/profile','/admin','/invoice'];
const isProtectedRoute = internalRoots.some(root =>
  path === root || path.startsWith(root + '/'))
  || path === '/estimate/new'
  || /^\/estimate\/[^/]+\/edit$/.test(path);
```

**Still unverified:** complete legitimate Free/Pro browser logins, server-side Turnstile enforcement in both environments, and authenticated isolation. Preview is missing the Turnstile public key in the inspected environment metadata. If Preview Auth enforces CAPTCHA, give it a separately configured test widget; do not turn off Production protection. Production smoke login fetch failure is not proof of an authorization defect.

## Pillar 3 — Stripe payment/webhook integration

### Passes

Raw bounded bodies are signature verified. Durable webhook claims distinguish processed duplicates from retryable processing/failure states. Subscription sync retrieves the current Stripe subscription. Prices and customer payment amounts are server derived, Pro checks are server side, and connected-account identity is checked. Full Stripe Dashboard onboarding is consistent with the selected model. Failed payments only transition pending records; they do not erase an already succeeded payment.

### STRIPE-1 [HIGH] Older refund snapshots can undo newer refunds

**Reference:** `app/api/webhooks/stripe/route.ts:89–109`, especially `:97–104`.

**Vector:** a full refund processed before an older partial-refund event can be overwritten with the older lower amount. Payment totals and the estimate's paid state become incorrect. Different event IDs evade duplicate-event protection. Stripe does not guarantee event order; see [Stripe webhook guidance](https://docs.stripe.com/webhooks).

**Fix:** retrieve the current charge in the correct connected-account context, then apply monotonic cumulative refund accounting inside a service-only transaction. Serialize all success/refund updates and estimate-state recalculation on the same estimate lock. Fetching the current charge alone does not resolve concurrent writes.

```ts
const currentCharge = await stripe.charges.retrieve(charge.id,
  { expand: [] }, { stripeAccount: connectedAccountId });
const { error } = await admin.rpc('workcraft_apply_customer_payment_state', {
  p_payment_intent_id: typeof currentCharge.payment_intent === 'string'
    ? currentCharge.payment_intent : currentCharge.payment_intent?.id,
  p_stripe_account_id: connectedAccountId,
  p_state: 'refund',
  p_refunded_cents: currentCharge.amount_refunded,
});
if (error) throw error; // Preserve webhook retry behavior.
```

The new RPC must take `pg_advisory_xact_lock(hashtextextended(estimate_id::text,0))` before locking the estimate/payment, validate the connected account, and use this update. Its same transaction recalculates saved-estimate cents using the existing package/markup/tax logic in `20261006140740_harden_payment_amounts_and_pro_checkout.sql:58–80`, sums net succeeded/refunded payments, and updates the estimate. Route **success** updates through that RPC too. Revoke EXECUTE from public/anon/authenticated and grant only service_role.

```sql
-- Inside the service-only RPC after the common estimate lock:
update public.customer_payments cp set
  amount_refunded_cents = greatest(cp.amount_refunded_cents,
    least(cp.amount_cents, greatest(p_refunded_cents,0))),
  status = case
    when greatest(cp.amount_refunded_cents,p_refunded_cents) >= cp.amount_cents
      then 'refunded'
    when greatest(cp.amount_refunded_cents,p_refunded_cents) > 0
      then 'partially_refunded'
    else cp.status end,
  updated_at = pg_catalog.now()
where cp.stripe_payment_intent_id=p_payment_intent_id
  and cp.stripe_account_id=p_stripe_account_id;
```

**Tests:** partial→full, full→older partial, duplicates, simultaneous refunds, success after refund, failure after success, async success/failure, connected-account mismatch. Run against Preview fixtures; no live customer charges are needed. This audit checked unsigned rejection and current CI, not a fresh signed-event matrix.

## Pillar 4 — Resend and external integrations

### Passes

Resend's `workcraftai.com` domain is verified; DKIM and sending SPF records show verified. Production delivery webhook is enabled with delivered/delayed/bounced/complained events and its environment secret is present. Estimate/invoice messages use no-reply From and contractor Reply-To. Customer-question notices use customer Reply-To. HTML escaping, bounded provider timeouts, idempotency, and quota reservation are present in principal flows. Zoho application integration is no longer in scope; mailbox administration is separate.

### EMAIL-1 [MEDIUM] Scheduled follow-ups never run through Vercel Cron

**Reference:** `vercel.json:5`; `app/api/cron/followups/route.ts:9`, `:20`, `:47`.

**Vector:** Vercel sends GET; the route exports only POST. Live GET returned 405. Separately, 100 candidates in ten batches with 10-second provider timeouts can exceed the 60-second function duration.

**Fix:** factor the authenticated implementation into a shared function and export GET/POST. Claim a small bounded batch (initially 20), enforce a time budget before additional work, and ensure unprocessed claims are recoverable. A small batch can delay follow-ups at scale; add a durable worker before advertising high-volume timely automation. Vercel documents its request behavior in [Cron Jobs](https://vercel.com/docs/cron-jobs).

```ts
// Add after the existing POST implementation. It retains all existing guards.
export const GET = POST;
// Separately reduce the existing claim's p_limit from 100 to 20 and make
// unfinished claims recoverable before production load increases.
```

### EMAIL-2 [MEDIUM] Spanish proposals receive English follow-ups

**Reference:** follow-up route `:26` and `:76–78`; follow-up RPC return projection in `supabase/migrations/20261005164159_admin_managed_pro_access.sql:248`.

**Vector:** the worker never retrieves `proposal_language`, and subject/body are English literals. Main email translation does not cover this path.

**Fix:** add proposal language to the claimed projection/type, and use the same branded bilingual template infrastructure as the original estimate email. Fetch reference/business name for useful identification. At minimum:

```ts
const spanish = estimate.proposal_language === 'es';
const subject = spanish ? 'Seguimiento de tu cotización' : 'Following up on your estimate';
const introduction = spanish
  ? `Hola ${estimate.client_name || 'cliente'}, ¿tienes alguna pregunta sobre tu cotización?`
  : `Hi ${estimate.client_name || 'there'}, do you have any questions about your estimate?`;
const action = spanish ? 'Ver cotización' : 'View estimate';
// escapeHtml(introduction/action) when constructing HTML; retain contractor Reply-To.
```

### EMAIL-3 [MEDIUM] Invoice delivery events cannot be correlated

**Reference:** `app/api/jobs/[id]/invoice-email/route.ts:200–245`; `app/api/webhooks/resend/route.ts:59–69`.

**Vector:** invoice sending updates the job to sent and returns the provider ID, but does not create the sent ledger entry used by the webhook. The webhook searches only estimate sent/follow-up entries and silently ignores invoice delivery/bounce events. A migration named “tracking” does not prove provider events are tracked.

**Fix:** persist invoice provider IDs in a generalized email ledger including user, job, optional estimate, recipient, source, and event. Webhook lookup should use that ledger, with a unique provider_event_id and service-only writes. Keep the recipient ledger owner-readable through RLS. If an unknown provider ID could be caused by a send/ledger race, retry rather than permanently accepting the first event as ignored.

```ts
const { error: recordError } = await admin.from('transactional_email_events').insert({
  user_id: user.id, job_id: job.id, estimate_id: job.estimate_id,
  recipient, source: 'invoice', event: 'sent', provider_email_id: responseData.id,
});
if (recordError) throw new Error('Invoice delivery tracking could not be recorded.');
// Pair with a durable send outbox so retrying this bookkeeping failure uses
// the same logical send/idempotency key and does not resend the invoice.
```

### EMAIL-4 [MEDIUM] Saved customer questions have no durable mail retry

**Reference:** `app/api/proposals/[id]/questions/route.ts:37–99`.

**Vector:** the question is saved, then a failed provider request returns `success:true,emailSent:false`. Dashboard data survives, but there is no queued retry to notify a contractor who relies on email. Similar send/bookkeeping gaps affect invoice and follow-up tracking.

**Fix:** insert a notification outbox entry with the question in the same database transaction. Worker retries 429/5xx/timeouts with bounded backoff and a stable send key; it records sent/provider ID atomically and distinguishes permanent recipient failures. Keep dashboard access independent of email failure. Show “Question saved; notification pending” / “Pregunta guardada; notificación pendiente” where applicable.

```sql
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source text not null,
  source_id uuid not null,
  status text not null default 'pending' check(status in('pending','sending','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_email_id text,
  unique(source,source_id)
);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public,anon,authenticated;
grant all on public.notification_outbox to service_role;
-- Insert from the existing question RPC; use a service-only SKIP LOCKED
-- claim RPC with a recoverable lease, then quota-reserved idempotent sends.
```

### EMAIL-5 [MEDIUM] The shared app cap does not bound all Resend traffic

**Reference:** `app/api/webhooks/stripe/route.ts:132–160`; `lib/email-quota.ts`; Supabase custom-SMTP configuration.

**Vector:** billing emails use direct Resend calls outside the app reservation pool; Auth SMTP emails also bypass it. Per-user caps and a 75/day app ceiling cannot guarantee staying inside Resend Free's 100/day total when recovery/signup traffic increases. CAPTCHA and per-IP throttling reduce abuse but do not establish a shared daily email budget. [Resend pricing](https://resend.com/pricing) currently documents the daily free limit.

**Fix:** reserve separate Auth, critical billing, and customer-message budgets whose sum fits the provider allowance, or upgrade/separate the Auth provider. Put billing notifications behind a durable, quota-aware outbox. To enforce the Auth allowance, use Supabase's authenticated Send Email hook with a server-managed budget; ordinary SMTP settings alone cannot share the app counter. Preserve generic recovery replies. Never permanently lock an account because someone else requested resets.

```ts
// Admission must be atomic in the database, by source and UTC day.
const { reservation, error } = await reserveAppEmail(admin, 'billing', userId, null);
if (error || !reservation?.allowed) {
  // Leave the outbox pending; subscription downgrade still completes.
  return;
}
// Add 'billing' to the database source allowlist and reserved budget first.
```

### EMAIL-6 [MEDIUM] DMARC was not published at the checked domain

**Reference:** DNS `_dmarc.workcraftai.com`; read-only TXT lookup returned no record.

**Vector:** verified sending SPF/DKIM does not supply a domain-wide anti-spoofing policy. This is primarily brand/reputation protection; it does not explain a recipient's full mailbox.

**Fix:** publish a DMARC record, start with monitoring, inspect alignment for app/Auth/mailbox senders, then move to quarantine/reject. Confirm the report mailbox exists before using it:

```text
Name: _dmarc
Type: TXT
Value: v=DMARC1; p=none; rua=mailto:admin@workcraftai.com
```

**Owner action:** DNS changes/report mailbox setup and provider plan decisions require account access. Preview has no inspected Resend key/webhook secret; configure a test inbox/provider setup if Preview email verification is desired. No fresh email was sent this audit.

## Pillar 5 — Estimates, pricing, scheduling, edge cases

### MONEY-1 [HIGH] Package totals are returned as zero in the proposal API

**Reference:** `app/api/proposals/[id]/route.ts:77`.

**Vector:** the calculator receives only `{tax_rate}` and an empty item list; it cannot find `package_options`. Each `packageTotalsCents` entry becomes zero. Summary-mode package rendering relies on those totals. A $1,000 package with 10% tax should produce 110,000 cents; the present call produces zero. Checkout independently calculates from saved data, so the customer can see a misleading amount even when server checkout is protected.

**Fix:** pass the full estimate to the existing cents calculator and validate option names/totals when saving.

```ts
const totalCents = calculateEstimateMoney(estimate, [], option.name).totalCents;
```

**Tests:** detailed/summary × no package/selected package × markup/tax/deposit; confirm public display, approval, invoice, and checkout all use the same total.

### AI-1 [HIGH] Price Book matching conflates incompatible units

**Reference:** `lib/priceBookPricing.mjs:39` and `:96–120`.

**Vector:** job, sheet, roll, box, visit, system, and each all become “count.” An exact description match can apply a $750/job rate to ten sheets and keep the sheet quantity, producing $7,500. The deterministic audit probe reproduced that behavior.

**Fix:** canonicalize only genuine aliases, retain distinct units, and do not infer a unit from task-description text. Unknown units should require review. A price match must agree on unit and pricing basis; a high text score is insufficient.

```js
function unitGroup(unit) {
  const value = normalize(unit);
  const aliases = new Map([
    ['ea','each'],['piece','each'],['pieces','each'],['unit','each'],['units','each'],
    ['sheet','sheet'],['sheets','sheet'],['roll','roll'],['rolls','roll'],
    ['box','box'],['boxes','box'],['job','job'],['jobs','job'],
    ['visit','visit'],['visits','visit'],['system','system'],['systems','system'],
    ['hr','hour'],['hrs','hour'],['hours','hour'],
    ['sqft','sq ft'],['square feet','sq ft'],['square foot','sq ft'],
    ['lf','linear ft'],['linear feet','linear ft'],
    ['roofing squares','roofing square'],
  ]);
  return aliases.get(value) ?? value;
}
// In applyPriceBookRates, before candidate matching:
const lineUnit = unitGroup(line.unit ?? 'unknown');
if (!lineUnit || ['unknown','unspecified','n a','na'].includes(lineUnit)) {
  return zeroUnmatched ? {...line, unit_price: 0} : line;
}
// Existing candidate filter must compare lineUnit === unitGroup(rate.unit).
```

### AI-2 [MEDIUM] Labor/material scope can be lost during fuzzy matching

**Reference:** `lib/priceBookPricing.mjs:4–7`, `:23–25`.

**Vector:** labor/material/install/replace words are removed before similarity scoring. Distinct material-only and installed rates with the same measurement can look identical or strongly similar. Ambiguity checks help when both options exist but cannot infer the inclusion basis from one candidate.

**Fix:** store explicit basis (`labor`, `materials`, `installed`, `other`) on saved rates and draft items. Only auto-apply a matching known basis; otherwise show a suggestion requiring confirmation. Preserve existing data with `unknown`, not a guessed default. Provide “Pricing basis” / “Base del precio” labels.

```js
const knownBasis = new Set(['labor','materials','installed','other']);
if (!knownBasis.has(line.pricing_basis)
    || line.pricing_basis !== rate.pricing_basis) return [];
```

### AI-3 [MEDIUM] Full roof area overrides quantities for partial repairs

**Reference:** `app/api/generate-estimate/route.ts:206`, `:321–327`.

**Vector:** a roofing/decking description with sq-ft units receives the full measured roof area, even if the prompt specifies repairing only 50 sq ft of damaged decking on a 2,000 sq-ft roof. The code can inflate an otherwise reasonable generated quantity.

**Fix:** add validated `quantity_basis` to the response schema (`full_roof`, `specified_area`, `count`, `unverified`). Apply measured full area only to full-roof tasks; preserve explicitly stated partial quantities. Explain the basis in English and Spanish and require review of ambiguous measurements.

```ts
if (measuredRoofAreaSqFt !== null && item.quantity_basis === 'full_roof') {
  if (unit === 'roofing square') quantity = measuredRoofAreaSqFt / 100;
  else if (unit === 'sq ft') quantity = measuredRoofAreaSqFt;
}
```

### TIME-1 [LOW] DST overlap lacks an explicit choice

**Reference:** `lib/localDateTime.mjs:14`; `app/schedule/page.tsx:248`.

**Vector:** spring-forward nonexistent times are rejected, which is good. Fall-back 01:30 occurs twice; JavaScript chooses an occurrence without asking. A user in a different timezone also views the same instant in their own local zone, not a saved job-location zone.

**Fix:** retain UTC storage, add an IANA job timezone and explicit ambiguity handling when scheduling. Show the offset when two possible instants exist; avoid changing persisted instants on display. Use a maintained timezone/Temporal implementation and test America/New_York on November 1, 2026. This is lower priority for ordinary daytime jobs.

**Other passes/limits:** line-level cent rounding and tax/markup/deposit math have existing tests; server save validation bounds quantities/rates and disallows negatives. Draft recovery is per user/browser with explicit save/restore controls. Offline photo upload cannot be assumed successful; the current partial-save warning correctly warns against creating duplicates. No mobile under-60-second creation/send benchmark was performed, because that would require saving and sending a test fixture.

## Pillar 6 — Vercel, code hygiene, operations

### ENV-1 [MEDIUM] CSP prevents private voice-note playback

**Reference:** `next.config.ts:43`; `app/estimate/[id]/page.tsx:369`.

**Vector:** `media-src 'self' blob:` excludes HTTPS signed audio URLs from the Supabase Storage origin. CSP is enforced, so the browser can block playback even though the file and owner authorization are valid.

**Fix:** scope media access to this project's Supabase origin; do not allow every HTTPS host. Derive only from a validated configuration URL.

```ts
const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
// Require https and the expected Supabase domain when validating config.
`media-src 'self' blob: ${supabaseOrigin}`;
```

### ENV-2 [MEDIUM] Invoice email request cap trusts Content-Length

**Reference:** `app/api/jobs/[id]/invoice-email/route.ts:46–51`.

**Vector:** an authenticated request without an accurate Content-Length reaches unbounded `request.json()`. Platform limits still apply, but the route's 2 KB application limit can be bypassed.

**Fix:** use the existing streaming reader, then retain existing recipient validation.

```ts
import { readLimitedJsonObject } from '@/lib/read-limited-body.mjs';
const parsed = await readLimitedJsonObject(request, 2048);
if (!parsed.ok) return jsonError('Invalid invoice email request.',
  parsed.reason === 'too_large' ? 413 : 400);
const body = parsed.value;
```

### OPS-1 [HIGH — readiness gap] Restore capability is not demonstrated

**Reference:** `docs/OPERATIONS-BACKUPS.md:73–115`; successful backup runs linked above.

**Vector:** snapshots now include Auth accounts and selected media, but a successful encrypted write does not prove compatible Auth recovery, MFA login, RLS, application relationships, or media recovery. Restore failure during an outage could cause prolonged downtime/data loss.

**Fix:** follow the existing runbook into a **new recovery Supabase project**, select a full-media snapshot, verify matching Auth schema compatibility before importing, restore database/Auth/files, then test password and MFA sign-in, owner isolation, private media, estimates/jobs/invoices and migration history. Record snapshot ID, recovery duration, counts, and test results. Keep payment/email integrations disabled in recovery until explicitly enabling tests.

```sh
restic snapshots --host workcraftai-production --tag full-media
# Use the selected snapshot ID, never “latest” without checking its media tag.
restic restore "$RESTORE_SNAPSHOT_ID" --target ./workcraftai-restore
# Then use the exact staged restore commands and checks in OPERATIONS-BACKUPS.md.
# No cutover or import into Production is part of a restore drill.
```

**Owner action:** select/create a recovery project and provide its access through the connected account or an ignored local file. Do not send database passwords or Restic credentials in chat. No production migration or restore was performed this audit.

### OPS-2 [LOW] Historical readiness records contradict current evidence

**Reference:** `docs/PRODUCTION-READINESS-AUDIT-2026-10-09.md:20–24` and older sections in release/monitoring docs.

**Vector:** notes about Vercel 403, missing Auth backups, smaller migration/test counts, or unavailable local fixtures can cause duplicate work and hide genuine remaining tasks.

**Fix:** retain historical audit dates, point the active checklist/runbook to this report, and replace the current-state section with: environment metadata accessible; 37 matching migrations; 45 unit tests; Auth/full-media backups successful; restore drill unverified; authenticated smoke incomplete. Never rewrite a historical result as if a test had passed then.

### CODE-1 [LOW] Turnstile effect causes a redundant state update

**Reference:** `app/components/TurnstileCaptcha.tsx:82`; current lint warning.

**Vector:** synchronous state update in the effect creates an extra render. This is not evidence of a CAPTCHA bypass.

**Fix:** isolate external widget initialization in an adapter with ready/error callbacks and cleanup, rather than synchronously setting component state in the effect's initialization catch. Keep verified/expired/error state driven by actual widget events, preserving reset and token invalidation. The warning is a maintainability/performance issue; do not silence it by removing error feedback or weakening verification.

**Environment classification:** public configuration is Supabase URL/publishable/temporary anon key, app/support URLs, and Turnstile sitekey. Private variables include Supabase service role, Stripe secret/webhook keys and server price ID, Resend API/signing keys, Gemini API key, and CRON_SECRET. No private-secret NEXT_PUBLIC_ declaration was found. Generic API errors generally avoid returning stack traces/database internals. Vercel Hobby remains the owner's pre-sales choice; the planned commercial-plan review remains a launch/sales prerequisite rather than an unauthorized upgrade.

## Pillar 7 — Marketing and tradesman UI/UX

### Passes and evidence limits

The marketing message identifies contractor estimating/job tools above the fold. Primary signup/app links and current Free/Pro limits are coherent. Native SVG icons avoid platform-dependent emoji rendering. Public marketing had no horizontal overflow at the inspected 375/768/1280 widths. Auth email/password/submit controls measured 48 px tall. Navigation and email templates have extensive Spanish coverage. The demo video already contains captions per the owner.

These passes do not imply every contrast ratio, signed-in form, customer approval/payment flow, or assistive-technology interaction passed. Automated axe findings are recorded separately; human review remains necessary for incomplete rules and task speed.

### UX-1 [MEDIUM] Small links and footer controls hinder mobile use

**Reference:** `app/components/Footer.tsx:34–52`; `marketing-site/styles.css:62`; login signup/forgot-password links; inline public support links.

**Vector:** several links measure 12–16 px tall; footer text is only 8–9 px. These may be technically operable with spacing but do not meet the requested 48×48 job-site design target and are hard to tap outdoors.

**Fix:** give independent actions at least 48 px hit areas, readable text, spacing, and visible keyboard focus. Avoid treating every short inline prose link as a WCAG failure; prioritize standalone navigation/actions.

```css
.footer-app-link, .footer-bottom a, .text-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  min-width: 48px;
  padding: 8px 12px;
  font-size: 12px;
}
.footer-bottom { gap: 12px; flex-wrap: wrap; }
a:focus-visible, button:focus-visible { outline: 3px solid #9b3e1f; outline-offset: 3px; }
```

For Tailwind footer links use `inline-flex min-h-12 min-w-12 items-center px-3 text-xs`; preserve English/Spanish labels and verify wrapping.

### UX-2 [LOW] Marketing illustration contains superseded navigation

**Reference:** `marketing-site/index.html:123`, `:131–133`; corresponding entries in `marketing-site/assets/site.js`.

**Vector:** the example still says Estimates, View Link, and duplicates New estimate. Actual navigation now says Dashboard/View Estimate and page-level actions were standardized. New users see a slightly different product than the current app.

**Fix:** update the illustration and translation map together:

```js
// Illustration labels: Dashboard; View estimate; one global + New estimate.
const labels = { en: { dashboard: 'Dashboard', view: 'View estimate' },
  es: { dashboard: 'Panel', view: 'Ver cotización' } };
```

### UX-3 [LOW] Dynamic scheduling strings escape translation lookup

**Reference:** `app/schedule/page.tsx:116`, `:165`, `:248`.

**Vector:** `Reschedule (${localTimeZone})` is a composed string, so an exact English translation dictionary does not match it. The DST validation error also lacks a checked Spanish entry.

**Fix:** translate the static label before adding the timezone and provide explicit bilingual errors.

```tsx
<label>{language === 'es' ? 'Reprogramar' : 'Reschedule'} ({localTimeZone})</label>
const dstError = language === 'es'
  ? 'Esa hora local no existe por el cambio de horario. Elige otra hora.'
  : 'That local time does not exist because of the daylight-saving clock change. Choose a different time.';
```

### UX-4 [MEDIUM] Muted text fails 4.5:1 contrast on public pages

**Reference:** `app/globals.css:24`; `app/signup/SignupForm.tsx:99`, `:218`; `app/login/LoginForm.tsx:151`; `app/reset-password/page.tsx:62`; `app/components/TurnstileCaptcha.tsx:107`, `:120`; `app/components/Footer.tsx:27`; marketing About paragraphs at `marketing-site/index.html:191` and the `.about-copy` / mock selectors in `marketing-site/styles.css`.

**Vector:** the global slate-400 color is appropriate for some light backgrounds but is also used inside dark Auth panels. Verified computed colors produce only **3.05:1** (`#68736b` on `#1d2925`) and **3.52:1** (`#68736b` on `#131c19`). Footer tagline is **3.44:1**; marketing About paragraphs are **4.20:1**. All are small text needing 4.5:1. This directly affects readability outdoors. Axe flagged contrast in every tested public page/language/width; marketing also has illustrative mock text findings, which should be reviewed in its visual context rather than treated as actual app controls.

**Fix:** create background-specific text styles rather than globally changing one muted color used by both dark and light surfaces. These measured replacement colors exceed 4.5:1 on their indicated backgrounds:

```css
/* Apply auth-page to the dark outer wrapper and auth-panel to its form card. */
.auth-page .auth-secondary, .auth-panel .auth-secondary { color: #c8d1ca; }
/* #c8d1ca on #1d2925 = 9.62:1 */
.footer-tagline { color: #56615a; } /* on #e9e7df = 5.21:1 */
.about-copy > p:not(.eyebrow) { color: #545f58; } /* on #ece9de = 5.48:1 */
```

Replace only affected text classes with these semantic styles, including security-check messages. Re-run both themes/languages and all viewports; also check placeholders, disabled controls, hover/focus states and signed-in pages. Keep decorative illustrations distinguishable from live inputs.

### UX-5 [MEDIUM] Signup sign-in link relies on color alone

**Reference:** `app/signup/SignupForm.tsx:222`.

**Vector:** “Sign in” within the existing-account sentence is only visually distinguished by color until hover. Axe `link-in-text-block` fails at all tested widths/languages. Touch users do not have a dependable hover state.

**Fix:** show a persistent underline, readable contrasting color, and keyboard focus. The existing translated link label can remain unchanged.

```tsx
<Link href="/login" className="text-[#f3b28f] underline underline-offset-4
  hover:text-white focus-visible:outline focus-visible:outline-2
  focus-visible:outline-offset-4 focus-visible:outline-white">
  {language === 'es' ? 'Iniciar sesión' : 'Sign in'}
</Link>
```

## Pillar 8 — Repeatable verification scripts

### Provided tools

1. `scripts/readiness-regressions.mjs`: five no-network probes for incompatible Price Book units, package projection, cron method, unconditional refund overwrite, and original upload finalizer. **0/5 pass on the audited source**, reproducing open defects. Source probes deliberately remain separate from normal CI tests; replace them with behavioral/integration tests after correcting the implementations. The upload probe inspects historical migration text; live definition was separately confirmed this audit.
2. `scripts/readiness-browser.mjs`: Playwright + axe; public app/marketing pages in EN/ES at 375/768/1280; overflow, WCAG rules, names/labels/alt/ARIA checks and small-target review flags. Optional Free/Pro browser states add authenticated read-only route, entitlement, and API isolation checks. Report omits page HTML, credentials, cookie values, and customer names.
3. Existing `scripts/production-readiness-smoke.mjs`: health/public markup, Free/Pro entitlement checks, owner/other-user API and direct database reads, private media isolation, and **opt-in Preview-only** signed Stripe duplicate/success/failure simulations. Its mutation mode requires a test Stripe key and disposable payment fixture. It changes test database/payment state; it must not be run against Production.

### Commands

```sh
# No credentials; intentionally fails while the five defects remain.
node scripts/readiness-regressions.mjs

# Optional audit tools; no runtime dependency changes needed.
# These versions were used for this audit. Install into an audit checkout:
npm install --no-save --package-lock=false playwright@1.62.1 axe-core@4.13.0
npx playwright install chromium
node scripts/readiness-browser.mjs
# This Codex host can use the bundled runtime without adding repo dependencies:
PLAYWRIGHT_MODULE=/Users/bdeleeuw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/readiness-browser.mjs

# Production fixture read checks only, with credentials in the ignored file:
WORKCRAFT_E2E_ALLOW_FIXTURE_MUTATIONS=0 \
node --env-file=.env.production-smoke scripts/production-readiness-smoke.mjs

# Preview fixtures only. Review the script's required WORKCRAFT_E2E_* values first.
WORKCRAFT_E2E_ALLOW_FIXTURE_MUTATIONS=1 \
node --env-file=.env.preview-smoke scripts/production-readiness-smoke.mjs
```

If Auth requires CAPTCHA, use manual legitimate login to create ignored Playwright storage states, set `WORKCRAFT_FREE_STORAGE_STATE` / `WORKCRAFT_PRO_STORAGE_STATE`, and run the browser script. Do not commit those files or circumvent CAPTCHA. Expired states fail; missing states are explicitly skipped. Direct database/private-media checks still use the existing smoke suite or equivalent authenticated browser-session requests.

### Additional required coverage after fixes

| Check | Required assertion |
| --- | --- |
| Free vs Pro | Free AI/upload/customer-email denial; Free estimate/status/customer tools work; Pro caps enforced server-side. |
| Isolation | Other user API returns 404/403 or empty RLS result; cannot read/sign/list private media; disposable write attempts affect zero rows. |
| Stripe | Raw signature rejection, duplicates, failed→success, async success, late failure, ordered/reversed/concurrent refund events, account mismatch, subscription cancel/past_due policy. |
| Email | One test send to owner inbox; provider ID → delivery event; contractor Reply-To; bilingual invoice/follow-up; retry after 429/5xx without duplicate delivery. |
| Money/AI | Unit/basis mismatches; explicit partial roof repair; packages/detail/summary all share totals; zero/negative/extreme input rejected or explicitly confirmed. |
| Mobile/a11y | No overflow; accessible names, alt, valid labels/ARIA references; daylight contrast; keyboard/focus; 48 px actions; EN/ES parity. |
| Recovery | Full encrypted snapshot restored to separate project, Auth/MFA and private media working, tenant isolation preserved, recovery time recorded. |

### Priority and division of work

**Code first:** DB-1/2, STRIPE-1, MONEY-1, AI-1; then follow-up execution, CSP/body limits, email reliability/Spanish, UI accessibility. Re-run database concurrency and Preview payments before deploying fixes. Larger changes (payment-state RPC, notification outbox, Auth budget hook, and share-token lifecycle) need coordinated migrations and route integration; the excerpts here must not be pasted as isolated fixes or treated as verified implementations.

**Owner/account steps:** recovery-project access, DMARC/report mailbox, provider-budget/paid-plan decisions at sales launch, authenticated test sessions if needed. Uptime delivery and Terms review remain owner-confirmed. Search Console verification/indexing was not rechecked with account access in this audit; sitemap availability alone is not proof of indexing.

**No readiness claim until:** high defects fixed and tested; signed-in isolation and payment/email evidence recorded; restore drill passes. A dozen-user pilot needs clear AI review warnings and active monitoring, but should not be used to bypass those correctness/security fixes.
