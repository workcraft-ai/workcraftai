begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

-- The browser's anonymous role must have no direct data or function access.
select ok(
  not exists (
    select 1
    from unnest(array[
      'subscriptions', 'estimate_email_events', 'price_book_items',
      'estimate_templates', 'jobs', 'proposal_questions',
      'estimate_attachments', 'estimates', 'line_items',
      'tradeflow_app_settings', 'tradeflow_daily_estimate_usage',
      'tradeflow_ai_daily_usage', 'tradeflow_ai_generation_events',
      'tradeflow_ai_global_daily_usage', 'stripe_webhook_events',
      'estimate_email_daily_usage', 'estimate_acceptances'
    ]) as tables(table_name)
    cross join unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]) as privileges(privilege)
    where has_table_privilege('anon', format('public.%I', table_name), privilege)
  ),
  'anon has no direct privileges on user data tables'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'subscriptions', 'estimate_email_events', 'price_book_items',
        'estimate_templates', 'jobs', 'proposal_questions',
        'estimate_attachments', 'estimates', 'line_items',
        'tradeflow_app_settings', 'tradeflow_daily_estimate_usage',
        'tradeflow_ai_daily_usage', 'tradeflow_ai_generation_events',
        'tradeflow_ai_global_daily_usage', 'stripe_webhook_events',
        'estimate_email_daily_usage', 'estimate_acceptances'
      ])
      and roles && array['anon'::name, 'public'::name]
  ),
  'user data policies only target authenticated users'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'subscriptions', 'estimate_email_events', 'price_book_items',
      'estimate_templates', 'jobs', 'proposal_questions',
      'estimate_attachments', 'estimates', 'line_items',
      'tradeflow_app_settings', 'tradeflow_daily_estimate_usage',
      'tradeflow_ai_daily_usage', 'tradeflow_ai_generation_events',
      'tradeflow_ai_global_daily_usage', 'stripe_webhook_events',
      'estimate_email_daily_usage', 'estimate_acceptances'
    ]) as tables(table_name)
    where not (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name
    )
  ),
  'row-level security is enabled on every user data table'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.convert_accepted_estimate_to_job(text,timestamp with time zone,text,text)',
    'EXECUTE'
  ),
  'anon cannot execute the estimate conversion RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.convert_accepted_estimate_to_job(text,timestamp with time zone,text,text)',
    'EXECUTE'
  ),
  'authenticated users can execute the estimate conversion RPC'
);

-- Least-privilege table grants used by the application.
select ok(
  has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.subscriptions', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'authenticated users can only read subscriptions'
);
select ok(
  has_table_privilege('authenticated', 'public.estimate_email_events', 'SELECT,INSERT')
  and not has_table_privilege('authenticated', 'public.estimate_email_events', 'UPDATE,DELETE,TRUNCATE'),
  'authenticated users can read and record estimate email events'
);
select ok(
  has_table_privilege('authenticated', 'public.price_book_items', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.price_book_items', 'TRUNCATE'),
  'authenticated users can manage their price book without table-wide truncate'
);
select ok(
  has_table_privilege('authenticated', 'public.estimate_templates', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.estimate_templates', 'TRUNCATE'),
  'authenticated users can manage estimate templates without table-wide truncate'
);
select ok(
  has_table_privilege('authenticated', 'public.jobs', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.jobs', 'TRUNCATE'),
  'authenticated users can manage jobs without table-wide truncate'
);
select ok(
  has_table_privilege('authenticated', 'public.proposal_questions', 'SELECT,UPDATE')
  and not has_table_privilege('authenticated', 'public.proposal_questions', 'INSERT,DELETE,TRUNCATE'),
  'authenticated users can read and mark proposal questions without creating or deleting them'
);
select ok(
  has_table_privilege('authenticated', 'public.estimate_attachments', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.estimate_attachments', 'TRUNCATE'),
  'authenticated users can manage attachment metadata without table-wide truncate'
);
select ok(
  has_table_privilege('authenticated', 'public.estimates', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.estimates', 'TRUNCATE'),
  'authenticated users can manage estimates without table-wide truncate'
);
select ok(
  has_table_privilege('authenticated', 'public.line_items', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.line_items', 'TRUNCATE'),
  'authenticated users can manage line items without table-wide truncate'
);

-- Use disposable fixture users and estimates; pgTAP rolls this transaction back.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-000000000001', 'rls-owner-a@example.test', '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'rls-owner-b@example.test', '{}');

insert into public.estimates (id, user_id, client_name, client_email)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Owner A', 'a@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Owner B', 'b@example.test');

insert into public.line_items (id, estimate_id, description)
values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Owner A line'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Owner B line');

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';

select results_eq(
  'select count(*) from public.estimates',
  array[1::bigint],
  'Owner A sees only their estimate'
);
select results_eq(
  'select count(*) from public.line_items',
  array[1::bigint],
  'Owner A sees only line items for their estimate'
);
select lives_ok(
  $$insert into public.price_book_items (user_id, name) values (auth.uid(), 'RLS test item')$$,
  'Owner A can create a record for themselves'
);

select throws_ok(
  $$insert into public.estimates (user_id, client_name, client_email)
    values ('a0000000-0000-4000-8000-000000000002', 'Spoofed', 'spoof@example.test')$$,
  '42501',
  'new row violates row-level security policy for table "estimates"',
  'Owner A cannot create an estimate for Owner B'
);
select throws_ok(
  $$insert into public.line_items (estimate_id, description)
    values ('b0000000-0000-4000-8000-000000000002', 'Cross-owner line')$$,
  '23503',
  'ESTIMATE_NOT_FOUND',
  'Owner A cannot add a line item to Owner B estimate'
);

set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000002';
select results_eq(
  'select count(*) from public.estimates',
  array[1::bigint],
  'Owner B sees only their estimate'
);
select results_eq(
  'select count(*) from public.line_items',
  array[1::bigint],
  'Owner B sees only line items for their estimate'
);
select lives_ok(
  $$update public.estimates set client_name = 'Tampered' where id = 'b0000000-0000-4000-8000-000000000001'$$,
  'Updating another owner estimate is safely filtered'
);

set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-000000000001';
select is(
  (select client_name from public.estimates where id = 'b0000000-0000-4000-8000-000000000001'),
  'Owner A',
  'Owner B could not change Owner A data'
);

select * from finish();
rollback;
