begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.stripe_webhook_events'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.estimate_email_daily_usage'::regclass),
  'private webhook and email quota tables have RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.stripe_webhook_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.stripe_webhook_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.estimate_email_daily_usage', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.estimate_email_daily_usage', 'SELECT,INSERT,UPDATE,DELETE'),
  'browser roles cannot access webhook events or email usage counters'
);
select ok(
  not has_function_privilege('authenticated', 'public.workcraft_claim_stripe_webhook(text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.workcraft_claim_stripe_webhook(text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.workcraft_submit_proposal_question(uuid,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.workcraft_submit_proposal_question(uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.workcraft_reserve_estimate_email(uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.workcraft_reserve_estimate_email(uuid,uuid)', 'EXECUTE')
  and to_regprocedure('public.workcraft_can_upload_estimate_media(uuid,text,bigint,text)') is null
  and has_function_privilege('authenticated', 'private.workcraft_can_upload_estimate_media(text,bigint,text)', 'EXECUTE'),
  'privileged RPCs are server-only and the Storage helper lives outside the exposed API schema'
);
select ok(
  has_function_privilege('anon', 'public.workcraft_health_check()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.workcraft_health_check()', 'EXECUTE'),
  'the public health probe is callable without privileged database access'
);
set local role anon;
select is(public.workcraft_health_check(), true, 'the public health probe confirms PostgREST database access');
reset role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a5000000-0000-4000-8000-000000000001', 'hardening-pro@example.test', '{}'),
  ('a5000000-0000-4000-8000-000000000002', 'hardening-free@example.test', '{}');
insert into public.subscriptions (user_id, status) values ('a5000000-0000-4000-8000-000000000001', 'active');
insert into public.estimates (id, user_id, client_name, client_email, status, followup_at, tax_rate)
values
  ('b5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'Question target', 'customer@example.test', 'pending', now() - interval '1 minute', 7.5),
  ('b5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001', 'Approval target', 'approval@example.test', 'pending', null, 7.5),
  ('b5000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000001', 'Email target', 'email@example.test', 'pending', null, 0),
  ('b5000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-000000000002', 'Free target', 'free@example.test', 'pending', null, 0);
insert into public.line_items (estimate_id, description, quantity, unit_price)
values ('b5000000-0000-4000-8000-000000000002', 'One task', 1, 100.25);

set local role service_role;
select is(
  public.workcraft_claim_stripe_webhook('evt_hardening_0001', 'payment_intent.succeeded'), true,
  'first Stripe webhook delivery can claim the event'
);
select is(
  public.workcraft_claim_stripe_webhook('evt_hardening_0001', 'payment_intent.succeeded'), false,
  'concurrent or duplicate webhook delivery is suppressed'
);
select lives_ok(
  $$select public.workcraft_fail_stripe_webhook('evt_hardening_0001', 'temporary failure')$$,
  'failed webhook state can be recorded for Stripe retry'
);
select is(
  public.workcraft_claim_stripe_webhook('evt_hardening_0001', 'payment_intent.succeeded'), true,
  'failed webhook delivery can be retried'
);
select lives_ok(
  $$select public.workcraft_complete_stripe_webhook('evt_hardening_0001')$$,
  'successfully processed webhook can be completed'
);
select is(
  public.workcraft_claim_stripe_webhook('evt_hardening_0001', 'payment_intent.succeeded'), false,
  'completed webhook cannot be applied a second time'
);

select lives_ok(
  $$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer A', 'customer-a@example.test', 'Question one')$$,
  'a valid customer question is stored'
);
select lives_ok(
  $$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer A', 'customer-a@example.test', 'Question two')$$,
  'a customer may ask another question within the allowance'
);
select lives_ok(
  $$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer A', 'customer-a@example.test', 'Question three')$$,
  'the configured per-customer allowance is honored'
);
select throws_ok(
  $$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer A', 'customer-a@example.test', 'Question four')$$,
  'P0001', 'CUSTOMER_QUESTION_LIMIT', 'per-customer question limit is enforced'
);
select lives_ok(
  $$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer B', 'customer-b@example.test', 'Question five')$$,
  'a different customer can still submit a question'
);
select lives_ok($$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer C', 'customer-c@example.test', 'Question six')$$, 'proposal question allowance advances');
select lives_ok($$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer D', 'customer-d@example.test', 'Question seven')$$, 'proposal question allowance advances again');
select lives_ok($$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer E', 'customer-e@example.test', 'Question eight')$$, 'proposal can accept its ninth question within the rolling hour');
select lives_ok($$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer F', 'customer-f@example.test', 'Question nine')$$, 'proposal can accept its tenth question within the rolling hour');
select lives_ok($$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer G', 'customer-g@example.test', 'Question ten')$$, 'the tenth proposal question is allowed');
select lives_ok($$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer H', 'customer-h@example.test', 'Question eleven')$$, 'the proposal limit allows exactly ten rolling-hour questions');
select throws_ok(
  $$select public.workcraft_submit_proposal_question('b5000000-0000-4000-8000-000000000001', 'Customer I', 'customer-i@example.test', 'Question twelve')$$,
  'P0001', 'PROPOSAL_QUESTION_LIMIT', 'per-proposal question limit is enforced atomically'
);

select is(
  (select count(*) from public.workcraft_claim_estimate_followups(10)), 1::bigint,
  'a due estimate follow-up is atomically claimed'
);
select is(
  (select count(*) from public.workcraft_claim_estimate_followups(10)), 0::bigint,
  'overlapping cron runs cannot claim the same follow-up'
);
select lives_ok(
  $$select public.workcraft_finish_estimate_followup('b5000000-0000-4000-8000-000000000001', true)$$,
  'successful follow-up is marked sent and releases its claim'
);
select is(
  (select count(*) from public.workcraft_claim_estimate_followups(10)), 0::bigint,
  'a successfully delivered follow-up is never claimed again'
);

select is(
  public.workcraft_accept_estimate_once('b5000000-0000-4000-8000-000000000002', 'Test Customer', null), 10777::bigint,
  'estimate approval calculates and stores an exact accepted total in cents'
);
select is(
  public.workcraft_accept_estimate_once('b5000000-0000-4000-8000-000000000002', 'Test Customer', null), 10777::bigint,
  'retrying the same approval returns the existing accepted total'
);
select is(
  (select count(*) from public.estimate_acceptances where estimate_id = 'b5000000-0000-4000-8000-000000000002'), 1::bigint,
  'approval terms are persisted exactly once'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';
select is(
  private.workcraft_can_upload_estimate_media('a5000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000001/photo.png', 1024, 'image/png'),
  true, 'a Pro user can upload a supported attachment to their own estimate'
);
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000002';
select is(
  private.workcraft_can_upload_estimate_media('a5000000-0000-4000-8000-000000000002/b5000000-0000-4000-8000-000000000004/photo.png', 1024, 'image/png'),
  false, 'a Free account cannot upload attachments'
);
set local request.jwt.claim.sub = 'a5000000-0000-4000-8000-000000000001';
select is(
  private.workcraft_can_upload_estimate_media('a5000000-0000-4000-8000-000000000001/b5000000-0000-4000-8000-000000000001/photo.png', 15728641, 'image/png'),
  false, 'an attachment over the Storage object limit is rejected'
);
select lives_ok(
  $$select public.workcraft_create_estimate_with_items(
    '{"client_name":"Atomic create","client_email":"atomic@example.test","package_options":[],"tax_rate":0,"markup_percentage":0}'::jsonb,
    '[{"description":"Created atomically","quantity":2,"unit_price":12.34}]'::jsonb
  )$$,
  'an authenticated owner can atomically create an estimate and line items'
);
select is(
  (select count(*) from public.estimates where user_id = auth.uid() and client_name = 'Atomic create'), 1::bigint,
  'the atomic create inserts one estimate'
);
select is(
  (select count(*) from public.line_items li join public.estimates e on e.id = li.estimate_id where e.user_id = auth.uid() and e.client_name = 'Atomic create'), 1::bigint,
  'the atomic create inserts its line item in the same transaction'
);
select throws_ok(
  $$select public.workcraft_create_estimate_with_items(
    '{"client_name":"Atomic invalid","client_email":"atomic@example.test"}'::jsonb,
    '[{"description":"","quantity":1,"unit_price":20}]'::jsonb
  )$$,
  '22023', 'INVALID_LINE_ITEMS', 'invalid line items are rejected by the database'
);
select is(
  (select count(*) from public.estimates where user_id = auth.uid() and client_name = 'Atomic invalid'), 0::bigint,
  'a rejected line item leaves no partial estimate row'
);
select throws_ok(
  $$select public.workcraft_create_estimate_with_items(
    '{"client_name":"Atomic too large","client_email":"atomic@example.test","package_options":[],"tax_rate":0,"markup_percentage":0}'::jsonb,
    '[{"description":"Large item one","quantity":2,"unit_price":100000000},{"description":"Large item two","quantity":2,"unit_price":100000000},{"description":"Large item three","quantity":2,"unit_price":100000000},{"description":"Large item four","quantity":2,"unit_price":100000000},{"description":"Large item five","quantity":2,"unit_price":100000000},{"description":"Large item six","quantity":2,"unit_price":100000000}]'::jsonb
  )$$,
  '22023', 'ESTIMATE_TOTAL_TOO_LARGE', 'the database enforces the maximum estimate subtotal'
);
select is(
  (select count(*) from public.estimates where user_id = auth.uid() and client_name = 'Atomic too large'), 0::bigint,
  'an over-limit estimate leaves no partial estimate row'
);
select lives_ok(
  $$select public.workcraft_replace_estimate_with_items(
    (select id from public.estimates where user_id = auth.uid() and client_name = 'Atomic create'),
    '{"client_name":"Atomic create","client_email":"atomic@example.test","package_options":[],"tax_rate":0,"markup_percentage":0}'::jsonb,
    '[{"description":"Replaced atomically","quantity":1,"unit_price":12.34}]'::jsonb
  )$$,
  'an estimate owner can atomically replace pending estimate line items'
);
select is(
  (select description from public.line_items li join public.estimates e on e.id = li.estimate_id where e.user_id = auth.uid() and e.client_name = 'Atomic create'),
  'Replaced atomically', 'the old line list is replaced only after the new list validates'
);
reset role;
set local role service_role;
select throws_ok(
  $$select public.workcraft_reserve_estimate_email('a5000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000004')$$,
  '42501', 'WORKCRAFT_PRO_REQUIRED', 'free accounts cannot reserve paid estimate email'
);
select lives_ok(
  $$select public.workcraft_reserve_estimate_email('a5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000003')$$,
  'Pro users can reserve estimate email within the daily limit'
);
reset role;
set local role service_role;
select results_eq(
  $$select email_count from public.estimate_email_daily_usage where user_id = 'a5000000-0000-4000-8000-000000000001'$$,
  array[1], 'successful reservation consumes one quota unit'
);
reset role;
set local role service_role;
do $$ begin
  for i in 2..50 loop
    perform public.workcraft_reserve_estimate_email('a5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000003');
  end loop;
end $$;
reset role;
set local role service_role;
select results_eq(
  $$select email_count from public.estimate_email_daily_usage where user_id = 'a5000000-0000-4000-8000-000000000001'$$,
  array[50], 'the daily Pro email limit stops at fifty sends'
);
reset role;
set local role authenticated;
select throws_ok(
  $$select public.workcraft_reserve_estimate_email('a5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'authenticated users cannot call the service-only email reservation RPC'
);
reset role;
set local role service_role;
select is(
  (select allowed from public.workcraft_reserve_estimate_email('a5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000003')),
  false, 'the fifty-first estimate email is rejected'
);

select * from finish();
rollback;
