# WorkCraft AI production-readiness audit

Audit date: 2026-10-09

## Executive Summary Checklist

| Area | Result | Evidence and next action |
| --- | --- | --- |
| Supabase RLS and tenant isolation | **Pass in schema review; production exercise open** | RLS is enabled on every listed public table and Storage objects. Prior SQL results show no cross-account estimate read, update, or delete. Complete the disposable-account app/API and private-media run in Production. |
| Service-role and secret separation | **Pass in source review** | No service-role key or provider secret has a NEXT_PUBLIC_ name in the checked source. Current Vercel Production values could not be inspected because environment-settings access returns 403. |
| Authentication and Pro gates | **Pass in source review** | API routes verify the Supabase user; Pro entitlements and quotas are checked server-side. |
| Stripe billing and connected payments | **Pass in source review; provider matrix incomplete** | Raw-body signature validation, durable event claims, retryable failures, and server-derived prices/amounts are present. Still verify the async Checkout event, transient-error retry, subscription lifecycle, and past-due emails in Preview Test mode. |
| Resend email and abuse controls | **Pass in source review; delivery test open** | Bounded request bodies, durable quotas, sender/Reply-To setup, and signed Resend event handling are implemented. Send one owner-controlled estimate and inspect the received headers and delivery event. |
| Financial calculations and schedules | **Pass with a timezone edge case** | Currency calculations use integer cents and basis points. A repeated fall-back DST time is not disambiguated for the user. |
| GitHub release protection | **Action required — High** | The active main ruleset requires PRs and blocks force-push/deletion, but does not require CI status checks. Add the two CI checks listed under Pillar 6. |
| Vercel plan and configuration | **Action required — High before commercial operation** | Deployments are Ready, but Production settings and current plan were not verifiable through the available Vercel API. Confirm plan and Production environment variables. Hobby is for personal, non-commercial use; move to an appropriate commercial plan before commercial use. |
| Backup and recovery | **Action required — High** | The encrypted Google Drive backup workflow and Auth export are documented. A successful full snapshot and restore drill into a separate Supabase project are not evidenced. |
| Monitoring | **Partial** | Both UptimeRobot test emails reached the support inbox. Actual outage/recovery delivery and provider quota/error alerts remain unverified. |
| Search indexing | **Pass in latest saved evidence** | The readiness runbook records successful sitemap submission and an indexed canonical homepage. Recheck after Google’s next report refresh. |
| Legal terms | **Action required** | The Terms reflect the selected renewal, period-end cancellation, no-refunds-except-where-required, and past-due policy; counsel review remains open. |
| UI/UX and accessibility | **Action required — Medium** | The marketing orange used for text has 2.90:1 contrast on the paper background, below WCAG AA for both normal and large text. Automated markup checks exist, but actual mobile, keyboard, screen-reader, and axe checks are not covered. |
| Local checks | **Pass** | npm test: 38 passing; lint, typecheck, and production build pass. Local npm audit could not reach registry.npmjs.org, so it produced no vulnerability result. |

The initial source audit was read-only against Production. Follow-up release work applied three forward-only database migrations to both Staging and Production: `20261009154058_fix_estimate_media_upload_preflight_rls`, `20261009154714_restore_estimate_media_upload_serialization`, and `20261009161204_fix_estimate_email_quota_usage_date_ambiguity`. These preserve customer records and media. No live Stripe charge was made.

## Scope and evidence limits

The checked-out source was branch codex/mobile-estimate-amount-20261008 at commit 4187d24 (2026-10-08). Vercel metadata showed both Production projects Ready from commit f65f2cb (2026-10-09); the GitHub origin/main ref in this local checkout is stale at 7820511. GitHub file metadata confirmed identical blob hashes between the checked-out branch and current main for the principal audit files, including CSP configuration, marketing CSS, the smoke script, Stripe/Resend handlers, estimate and AI routes, Pro access, money calculations, the quota migration, and operations/quota runbooks. The complete f65f2cb tree was not materialized locally, so this was a targeted source reconciliation rather than a full checkout of the deployed tree.

The app and company-site deployments were Ready. Vercel project/deployment metadata was available, but the API returned 403 for project settings and environment-variable inspection; the Vercel CLI is not installed. Therefore, secret values, exact Production variable presence, domains/settings, and the current plan were not verified.

Production and Staging Supabase migration histories were confirmed matching at 32 migrations through 20261009161204_fix_estimate_email_quota_usage_date_ambiguity after the owner completed database housekeeping. RLS is enabled on all listed public tables and storage.objects. Security advisor results were the same in both projects. No destructive or write-based isolation test was run against Production during this audit.

## Pillar 1 — Supabase and database security

### Passes

- Every table returned by the live inventory in schema public, plus storage.objects, has RLS enabled. Core tenant-owned tables include estimates, line items, jobs, customer contacts, attachments, payments, and customer questions. Internal usage, webhook, and admin tables intentionally have no browser policies or browser table grants.
- The estimate-media bucket is private. Storage reads/deletes are restricted to the caller’s user folder. Upload reservation logic checks authenticated ownership, Pro status, MIME type, size, file count, retained capacity, and monthly upload allowance.
- The audited RPCs use an empty search path and explicit auth.uid() ownership checks. The estimate status RPC allowlists values and prevents a contractor from erasing a recorded customer signature/approval.
- The service-role key is used in server-side modules/routes only in the checked source. No secret-looking environment name has a NEXT_PUBLIC_ prefix.
- The existing two-account SQL output showed zero rows visible to the other account and zero update/delete effects. This is useful evidence, but not a substitute for the app/API and private Storage smoke run.

### Findings

1. **[MEDIUM — advisor warning, no exploit found] Three authenticated SECURITY DEFINER RPCs are exposed in the public API schema.**
   - References: supabase/migrations/20261006170000_estimate_status_tracking.sql:3-51; supabase/migrations/20261009025908_per_account_plan_quotas.sql:618-733.
   - Root cause/vector: workcraft_update_estimate_status, workcraft_reserve_estimate_media_upload, and workcraft_finish_estimate_media_upload run with function-owner privileges and can be called by authenticated users. Their explicit ownership and validation checks materially reduce risk; nevertheless, an overlooked check could cross the privilege boundary. Supabase’s advisor reports these as warnings.
   - Fix: retain search_path = '', explicit caller/owner validation, narrow function grants, and regression tests. Do not “fix” this by removing auth checks or granting broad table access. If the warning must be eliminated, move these calls behind authenticated Next.js API routes, verify the session with auth.getUser(), perform a narrowly scoped server operation, then revoke direct authenticated EXECUTE. Test user isolation and atomic quotas before changing the RPC boundary.

2. **[MEDIUM — accepted risk] Leaked-password screening is disabled.**
   - Reference: Supabase Auth configuration; this is not controlled by a repository file.
   - Root cause/vector: Supabase’s leaked-password check is a paid-plan feature and the owner chose not to pay for it. Reused or previously exposed passwords may therefore be accepted if they pass the ordinary password rules.
   - Fix: keep the selected free-plan configuration; retain the existing admin MFA, require a strong minimum password policy where available at no charge, maintain rate limits and account-recovery controls, and monitor suspicious authentication activity. Revisit the decision if the risk or plan changes.

3. **[LOW/MEDIUM — bearer-link privacy] Public proposal access is keyed by the estimate UUID and remains available while that estimate exists.**
   - Reference: app/api/proposals/[id]/route.ts:10-28, 51-79.
   - Root cause/vector: a UUID is difficult to guess, and the endpoint returns a filtered customer-facing record with no-store and noindex; however, anyone receiving or forwarding the link can view proposal/customer details and request refreshed one-hour photo URLs. There is no independent share-token rotation or expiration control.
   - Fix: for stronger customer control, add a separate random share token (store only its hash), support revoke/rotate and optional expiry, and continue selecting only fields needed by the customer. Avoid treating the UUID as authorization for contractor actions.

### Recommended test

Use a disposable estimate owned by Account A with one private photo. Verify Account A can read it and sign a short-lived media URL; Account B gets an empty RLS result/404 and cannot obtain a signed URL. Exercise attempted cross-account update/delete only on disposable fixtures, then verify no row changed. The current smoke script covers read/API and private-media reads, but not cross-account writes.

## Pillar 2 — Authentication, authorization, and subscription tiering

### Passes

- Estimate creation verifies the current user, bounds the request body, validates customer fields, line items, package options, deposit/tax/markup ranges, and calls an atomic database RPC: app/api/estimates/route.ts:34-95.
- Pro access is derived from Stripe subscription state or a valid admin grant in server code; it is not trusted from browser storage: lib/pro-access.ts.
- Cloud AI verifies the Supabase user and Pro entitlement before contacting Gemini, then uses durable per-account and platform caps: app/api/generate-estimate/route.ts.
- Pro subscription Checkout uses the configured server-side Stripe price and authenticated account identity: app/api/pro/checkout/route.ts:11-109. Customer checkout derives the amount from the saved estimate/payment records and connected account, not the request body: app/api/proposals/[id]/checkout/route.ts.
- Session refresh runs through the current Next.js proxy.ts Supabase session helper. Authenticated API handlers use auth.getUser() rather than trusting an unverified cookie payload.
- User data remains available after a subscription downgrade; paid operations are gated server-side.

### Finding

1. **[LOW — assurance improvement] The current Production smoke suite does not test unauthenticated access to every protected UI route or write endpoint.**
   - References: proxy.ts:5-19; scripts/production-readiness-smoke.mjs:98-120, 123-150.
   - Root cause/vector: the proxy refreshes sessions, while many pages authenticate through client code and rely on route-level authorization/RLS for actual data. This is not evidence of unauthorized data access, but UI redirects and API denials can regress independently.
   - Fix: add browser tests that open dashboard, customers, profile, and admin logged out; verify redirect or a clear sign-in state; then test each write API without a session and as the wrong account. Keep RLS/API checks as the security boundary.

## Pillar 3 — Stripe payment and webhook integration

### Passes

- Webhooks read a bounded raw request body, require stripe-signature, verify with stripe.webhooks.constructEvent, and accept only configured signing secrets: app/api/webhooks/stripe/route.ts:23-47.
- The durable claim state distinguishes processed duplicates from retryable in-flight/failed events; handler failures return 500 so Stripe can retry: app/api/webhooks/stripe/route.ts:49-64, 280-288.
- Code handles connected checkout completion, asynchronous success/failure, expiration, PaymentIntent success/failure, refunds, and subscription create/update/delete plus invoice-paid/payment-failed/action-required: app/api/webhooks/stripe/route.ts:168-282.
- Pro subscription Checkout uses a server-controlled price ID and idempotency key; the browser cannot supply a price or dollar amount: app/api/pro/checkout/route.ts:29-31, 87-109.
- The contractor payment flow derives totals in integer cents, verifies the estimate is accepted, checks Pro and connected-account charge capability, and creates checkout for the contractor’s connected account.
- The state-aware webhook migration is present in both Supabase histories. Saved evidence records successful Preview deliveries for several connected-account events and a duplicate replay.

### Action required

1. **[MEDIUM — release verification] Finish the Preview Test-mode event matrix.**
   - The saved readiness evidence still lacks a successful checkout.session.async_payment_succeeded delivery to the connected-account destination and a demonstrated retry after a transient non-2xx response. Subscription lifecycle/payment-failure and the bilingual past-due email also need a delivery test.
   - Fix: use a disposable Preview Test-mode account/payment only; verify event delivery response, database status, duplicate replay, and recovery after a temporary handler failure. Never use a live charge for this test. The script’s fixture tests are deliberately disabled by default and restricted to local/branch Preview: scripts/production-readiness-smoke.mjs:201-217, 221-250, 253-297.

2. **[LOW — business-policy clarity] Keep contractor/customer payment policy distinct from WorkCraft AI subscription refunds.**
   - References: docs/PRODUCTION-READINESS-RELEASE.md:18-19; public Terms.
   - Contractors receive customer payments through their connected Stripe accounts and handle customer refunds/disputes. WorkCraft AI subscription refund/cancellation terms are separate. Counsel review remains open under Pillar 7.

## Pillar 4 — Resend and other API integrations

### Passes

- Estimate email requires authentication, estimate ownership, and Pro; the contractor’s address is set as Reply-To, and mail attempts are quota-limited/idempotency-aware: app/api/estimates/[id]/send/route.ts.
- Resend delivery webhooks verify the raw signed payload and use bounded parsing/idempotent event recording: app/api/webhooks/resend/route.ts.
- Public support submissions validate same-origin, cap body size, reject a honeypot, and use a durable per-IP rate limit plus global app-email limits: app/api/support/route.ts.
- Zoho has explicitly been removed from scope. No Zoho OAuth token flow or API timeout work is required.

### Finding

1. **[MEDIUM — delivery unverified] Estimate email and Reply-To were not verified end-to-end.**
   - Reference: docs/PRODUCTION-READINESS-RELEASE.md:16, 24; source: app/api/estimates/[id]/send/route.ts.
   - Root cause/vector: the last recorded signed-in button attempt showed no sent status, no Resend email request, and no new received message. Code configuration alone does not prove the provider accepted/delivered mail or that the recipient sees the contractor Reply-To.
   - Fix: click Email client once on a dedicated Pro Preview estimate addressed to an inbox you control. Confirm visible success/error, Resend message/event status, and the received raw headers showing the contractor’s email in Reply-To. If no request appears, inspect the browser network request and app function log before trying another send.

2. **[LOW — operations] Provider DNS and alert thresholds are not established by code review.**
   - References: docs/OPERATIONS-MONITORING.md:30-40.
   - Fix: verify Resend’s domain authentication (SPF/DKIM/DMARC) and configure provider usage/error notifications in the dashboards. A successful app health check cannot detect provider quota exhaustion or message suppression.

## Pillar 5 — Estimate, invoice, and scheduling edge cases

### Passes

- Monetary conversions and percentage math use cents/basis points with deterministic rounding: lib/estimate-money.mjs:6-16, 23-60.
- Server input validation rejects invalid/oversized customer data and line items, restricts percentage ranges, and maps invalid or overlarge totals to sanitized responses: app/api/estimates/route.ts:39-89.
- Subscription/estimate caps and estimate creation are durable and atomic across Vercel instances. Database concurrency tests are part of CI.

### Findings

1. **[LOW — timezone edge case] Repeated local times during the fall DST transition are ambiguous.**
   - Reference: lib/localDateTime.mjs:9-16.
   - Root cause/vector: conversion validates nonexistent spring-forward times, but a fall-back wall time such as 1:30 AM occurs twice. JavaScript selects one occurrence without asking which UTC offset the contractor intends.
   - Fix: show the business/device timezone and UTC offset in the schedule editor; for an ambiguous time, ask the user to choose the first or second occurrence. If multi-timezone teams become a use case, store an explicit IANA timezone with each job.

2. **[LOW — additional test coverage] Extreme text, offline recovery, and mobile speed have not been measured with browser automation.**
   - References: app/api/estimates/route.ts:48-63; scripts/production-readiness-smoke.mjs.
   - Fix: add bounded-input cases for long Unicode/special-character descriptions, zero/negative quantities and rates, and interrupted network saves. Measure estimate creation on a 375px viewport with keyboard-only navigation. The backend rejects invalid values, but no claim is made that every user workflow was stress-tested.

## Pillar 6 — Vercel environment and code hygiene

### Passes

- Public environment variables in source are limited to public configuration such as NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy anon key), NEXT_PUBLIC_APP_URL, and NEXT_PUBLIC_SUPPORT_EMAIL.
- Server-only secrets include SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, Stripe webhook signing secrets, RESEND_API_KEY, RESEND_WEBHOOK_SECRET, GEMINI_API_KEY, and CRON_SECRET. No secret name has a NEXT_PUBLIC_ prefix in the checked source.
- API responses use user-facing error messages; database/provider errors are logged server-side rather than returned with stack traces.
- CI runs a blocking production dependency audit, lint, unit tests, typecheck, build, Supabase database security tests, and quota/concurrency checks: .github/workflows/ci.yml:16-100.
- Local lint, typecheck, tests, and webpack production build passed. The application build generated all 42 static pages.

### Findings

1. **[HIGH — release control] Main ruleset does not require CI status checks.**
   - Reference: GitHub repository Ruleset targeting refs/heads/main; workflow check names in .github/workflows/ci.yml:17-18, 62-64.
   - Root cause/vector: PR review and force-push/deletion protections are active, but no required-check rule is configured. A PR can therefore be merged while CI is failing or pending.
   - Fix: add both required checks to the active main ruleset after confirming GitHub’s exact labels:
     - CI / Lint, typecheck, and build
     - CI / Supabase database security tests

2. **[HIGH — plan compliance before commercial use] Confirm the Vercel plan before taking paid customers.**
   - References: Vercel project plan was not visible through the available settings API; internal policy is documented in docs/ACCOUNT-QUOTAS.md:39 and docs/OPERATIONS-MONITORING.md:54.
   - Root cause/vector: Hobby is appropriate for personal/non-commercial development and testing. Vercel’s current terms restrict Hobby to personal, non-commercial use. If WorkCraft AI is operated commercially or paid subscriptions are accepted, staying on Hobby can violate plan terms and puts availability at risk.
   - Fix: inspect the project’s plan in Vercel and move to the appropriate commercial plan before commercial use. See [Vercel Terms](https://vercel.com/legal/terms) and [Hobby plan documentation](https://vercel.com/docs/plans/hobby).

3. **[MEDIUM — defense in depth] Content Security Policy permits inline scripts and HTTPS images from any host.**
   - Reference: next.config.ts:29-46, especially lines 36 and 39. Session refresh is in proxy.ts:1-7.
   - Root cause/vector: script-src 'unsafe-inline' weakens CSP against injected inline script; unrestricted https: images allow any host to load images. The CSP is present, but is not a strict script policy.
   - Fix: move to a per-request nonce-based script policy compatible with the current Next.js version, Stripe.js, and Supabase session refresh; allow only necessary image origins, including the configured Supabase Storage host. Preserve cookies when proxy.ts adds request/response headers. Validate the policy in Preview and check static-page rendering before release.

   Suggested policy shape (the nonce must be generated per request; this is not a literal value):

   ~~~text
   default-src 'self';
   script-src 'self' 'nonce-{per-request-nonce}' https://js.stripe.com;
   script-src-attr 'none';
   img-src 'self' data: blob: https://{production-project}.supabase.co;
   object-src 'none'; base-uri 'self'; frame-ancestors 'none'
   ~~~

4. **[MEDIUM — stale operations instructions; corrected in this release] Readiness runbooks trailed current release state.**
   - References: docs/PRODUCTION-READINESS-RELEASE.md:3, 7-16; docs/OPERATIONS-MONITORING.md:3, 9-16.
   - Root cause/vector: documents still said release a7f27f4 and 27 migrations through 20261008010250; follow-up evidence shows Production commit f65f2cb and matching 32-migration histories through 20261009161204. Current Vercel deployment/environment API requests return 403 and the CLI is unavailable.
   - Fix: the readiness and operations runbooks now record the current migration history and Vercel access limit. Keep still-open email, webhook, restore, and isolation items open until delivery/restore evidence exists.

5. **[MEDIUM — dependency status unknown locally] npm audit could not complete.**
   - Reference: .github/workflows/ci.yml:40-48.
   - Root cause/vector: the local audit failed to resolve registry.npmjs.org (ENOTFOUND), so it returned no vulnerability result. CI’s production audit is blocking; the full development-tree audit is informational because the known GHSA affects a development-only dependency.
   - Fix: use a network-enabled CI run or restore npm registry access, then inspect the latest production and full-tree audit results. Do not interpret the local network error as “zero vulnerabilities.”

## Pillar 7 — Website/app layout, accessibility, and usability

### Passes

- Live marketing site presented a clear contractor value proposition, free/Pro comparison, demo video, and signup/app calls to action. Current copy reflects the documented quotas/features.
- App controls and marketing primary buttons, the language toggle, plan buttons, and secondary hero action have 48px mobile minimum heights in source: app/globals.css:71-91; marketing-site/styles.css:54, 72, 76, 85.
- Sign-up email has an email autocomplete value; login/signup forms have required fields and visible error handling in source. The existing smoke script checks basic server-rendered accessible names/label references and alt attributes.
- Public proposal pages provide customer approval/payment actions and suppress indexing; estimate IDs are UUIDs and the response omits internal user_id and converted-job ID.

### Findings

1. **[MEDIUM — WCAG contrast] Brand orange text fails contrast on the marketing paper background.**
   - Reference: marketing-site/styles.css:1 (orange #dd7144, paper #f5f3ec) and styles applying the orange token to heading spans and hover text.
   - Root cause/vector: computed contrast is 2.90:1 on the paper background. WCAG AA requires 4.5:1 for normal text and 3:1 for large text, so the highlighted large heading text is also just below threshold.
   - Fix: keep the current orange for decorative surfaces, but use a darker text token for orange copy on light backgrounds; for example #a84320 is 5.42:1 on #f5f3ec. Recheck every foreground/background combination, including focus and hover states.

   ~~~css
   :root {
     --orange: #dd7144;       /* decorative brand accent */
     --orange-text: #a84320;  /* text on light backgrounds */
   }
   .hero h1 span,
   .about-copy h2 span,
   .main-nav a:hover,
   .text-link:hover,
   .footer-app-link:hover {
     color: var(--orange-text);
   }
   ~~~

2. **[MEDIUM — incomplete accessibility assurance] The current accessibility check parses HTML with regular expressions.**
   - Reference: scripts/production-readiness-smoke.mjs:56-96.
   - Root cause/vector: static markup checks can detect missing names/IDs, but cannot reliably test keyboard focus order, runtime labels, contrast, responsive overflow, touch targets after CSS, or screen-reader behavior.
   - Fix: add Playwright checks at 375px, 768px, and 1280px plus axe-core; cover login/signup, estimate creation, dashboard, customer proposal, and invoice/payment views. Include keyboard-only navigation and verify no horizontal overflow. Keep the current fast smoke test as a separate health gate.

3. **[LOW — field usability not measured] Estimate creation under 60 seconds and outdoor daylight readability are not measured.**
   - Root cause/vector: screenshot/source inspection does not establish that a first-time contractor can complete the flow quickly or read the live color combinations in sunlight.
   - Fix: run a short moderated task with a new user on a 375px phone. Measure create/edit/send time, missed taps, contrast on actual text combinations, and recovery after network errors. Do not infer usability from the desktop screenshot alone.

4. **[LOW — status-feedback verification] Slow-network and offline behavior has not been exercised in a browser.**
   - Fix: add throttled-network checks for saving an estimate, sending email, approving a proposal, and starting payment; verify progress, duplicate-submit protection, and a useful retry state.

## Pillar 8 — End-to-end verification script

The repository already contains scripts/production-readiness-smoke.mjs; no second overlapping smoke script was added. It covers:

- app/Auth/database health plus basic public-page markup for /, /login, /signup, /support, /privacy, and /terms;
- Free account denied cloud AI and Pro account allowance;
- Account A vs Account B estimate reads through Supabase REST and the app API;
- owner vs other-account signed URL access for a private estimate photo when a photo fixture is present;
- opt-in Preview-only signed Stripe fixture tests for duplicate delivery and PaymentIntent failure then success.

Use the existing safe read-only Production check as documented in docs/PRODUCTION-READINESS-RELEASE.md:30-36. It needs dedicated Free/Pro test accounts and a disposable estimate/photo fixture; do not put credentials in chat or commit .env.local. It creates Auth sign-in activity and a short-lived owner-signed media URL. Leave the Stripe fixture mutation switch unset in Production.

Coverage gaps to close before broad launch:

1. Add negative cross-account write tests on disposable fixtures (attempt update/delete and assert the row remains unchanged).
2. Add real Playwright/axe coverage; the existing accessibility parser is not a browser accessibility audit.
3. Keep Stripe event delivery testing on a Preview Test-mode destination and verify provider delivery records in Stripe, not only locally signed requests.
4. Add Resend end-to-end receipt plus Reply-To-header verification.

## Recommended order of action

1. Add the two CI status checks to the main ruleset.
2. Confirm Vercel Production environment configuration and commercial-plan eligibility.
3. Complete Production isolation using two test accounts and a dedicated estimate/photo.
4. Complete Preview Stripe retry/async/subscription tests and one estimate email with Resend delivery/Reply-To verification.
5. Run the first encrypted Auth-plus-database backup and restore into a separate Supabase project.
6. Verify outage/recovery and provider quota/error alerts; review remaining Terms with counsel.
7. Implement the CSP and color-contrast fixes and browser-level accessibility suite; the runbook refresh is complete.

## Check results and limitations

- npm test: 38 tests passed.
- npm run lint: passed.
- npm run typecheck: passed.
- npm run build: passed; Next.js built 42 static pages with Webpack.
- npm audit --omit=dev --audit-level=high: could not reach registry.npmjs.org, so no audit conclusion.
- Supabase Production and Staging: 32 migration versions match through 20261009161204_fix_estimate_email_quota_usage_date_ambiguity; all listed tables have RLS enabled.
- Vercel: after PR #74 merged as 209daa8, both Production deployment checks passed; the app health endpoint and marketing homepage returned 200. Current deployment/environment API requests returned 403 and the CLI is unavailable, so project settings and plan remain unverified.
- This audit did not execute a new live Production two-account Storage/API check, Stripe provider event, Resend delivery, outage simulation, or backup restore.
