begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

-- App-owned tables in public must be protected even when a future migration adds one.
select ok(
  not exists (
    select 1
    from pg_class as app_table
    join pg_namespace as app_schema on app_schema.oid = app_table.relnamespace
    cross join unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
    ]) as privileges(privilege)
    where app_schema.nspname = 'public'
      and app_table.relkind in ('r', 'p')
      and has_table_privilege('anon', app_table.oid, privilege)
  ),
  'anon has no direct privileges on any public application table'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and roles && array['anon'::name, 'public'::name]
  ),
  'no public-schema RLS policy grants access to anon or PUBLIC'
);

select ok(
  not exists (
    select 1
    from pg_class as app_table
    join pg_namespace as app_schema on app_schema.oid = app_table.relnamespace
    where app_schema.nspname = 'public'
      and app_table.relkind in ('r', 'p')
      and not app_table.relrowsecurity
  ),
  'row-level security is enabled on every public application table'
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
select ok(
  not has_function_privilege('anon', 'public.workcraft_reserve_app_email(text,uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.workcraft_reserve_app_email(text,uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.workcraft_reserve_app_email(text,uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.workcraft_release_app_email(uuid)', 'EXECUTE'),
  'only the trusted server can reserve or release app email capacity'
);

-- Least-privilege table grants used by the application.
select ok(
  has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.subscriptions', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'authenticated users can only read subscriptions'
);
select ok(
  has_table_privilege('authenticated', 'public.estimate_email_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.estimate_email_events', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'authenticated users can read but cannot forge estimate email events'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'estimate_email_events' and column_name = 'provider_event_id'
  )
  and to_regclass('public.estimate_email_events_provider_event_id_uidx') is not null,
  'Resend events have a unique provider ID for idempotent ingestion'
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
  (select pg_get_expr(d.adbin, d.adrelid) = 'auth.uid()'
   from pg_attrdef d
   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.estimates'::regclass and a.attname = 'user_id'),
  'estimates default user_id to the authenticated user'
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
