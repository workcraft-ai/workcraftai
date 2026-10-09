begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tradeflow_app_settings'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.tradeflow_daily_estimate_usage'::regclass),
  'global settings and usage ledger have RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.tradeflow_app_settings', 'SELECT')
  and not has_table_privilege('authenticated', 'public.tradeflow_app_settings', 'SELECT')
  and not has_table_privilege('anon', 'public.tradeflow_daily_estimate_usage', 'SELECT')
  and not has_table_privilege('authenticated', 'public.tradeflow_daily_estimate_usage', 'SELECT'),
  'browser roles cannot inspect private quota tables'
);
select ok(
  not has_function_privilege('authenticated', 'public.update_free_daily_estimate_limit(integer,uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.update_free_daily_estimate_limit(integer,uuid,text,text)', 'EXECUTE'),
  'only the service role can execute the protected settings RPC'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1000000-0000-4000-8000-000000000001', 'quota-free@example.test', '{}'),
  ('a1000000-0000-4000-8000-000000000002', 'quota-pro@example.test', '{}'),
  ('a1000000-0000-4000-8000-000000000003', 'quota-admin@example.test', '{}'),
  ('a1000000-0000-4000-8000-000000000004', 'quota-billing@example.test', '{}'),
  ('a1000000-0000-4000-8000-000000000005', 'quota-failed@example.test', '{}');

insert into public.tradeflow_admins (user_id, email, role)
values
  ('a1000000-0000-4000-8000-000000000003', 'quota-admin@example.test', 'super_admin'),
  ('a1000000-0000-4000-8000-000000000004', 'quota-billing@example.test', 'billing');
insert into public.subscriptions (user_id, status)
values ('a1000000-0000-4000-8000-000000000002', 'active');
select is(
  (select free_daily_estimate_limit from public.tradeflow_app_settings where singleton = true),
  10,
  'the initial free-tier limit is 10 estimates per UTC day'
);
update public.tradeflow_app_settings set free_daily_estimate_limit = 2 where singleton = true;

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
insert into public.estimates (user_id, client_name, client_email)
select auth.uid(), 'Free test ' || n, 'free' || n || '@example.test'
from generate_series(1, 2) n;
select throws_ok(
  $$insert into public.estimates (user_id, client_name, client_email) values (auth.uid(), 'Over cap', 'over@example.test')$$,
  'P0001', 'FREE_DAILY_ESTIMATE_LIMIT', 'free users are blocked at the configured daily cap'
);
reset role;
select is(
  (select estimates_created from public.tradeflow_daily_estimate_usage where user_id = 'a1000000-0000-4000-8000-000000000001' and usage_date = (now() at time zone 'UTC')::date),
  2,
  'the ledger records exactly the successful free estimate inserts'
);
set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';
update public.estimates set client_name = 'Edited estimate' where user_id = auth.uid();
reset role;
select is(
  (select estimates_created from public.tradeflow_daily_estimate_usage where user_id = 'a1000000-0000-4000-8000-000000000001' and usage_date = (now() at time zone 'UTC')::date),
  2,
  'editing an existing estimate does not consume more allowance'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000005';
insert into public.estimates (id, user_id, client_name, client_email)
values ('b1000000-0000-4000-8000-000000000005', auth.uid(), 'Failed insert fixture', 'failed@example.test');
select throws_ok(
  $$insert into public.estimates (id, user_id, client_name, client_email) values ('b1000000-0000-4000-8000-000000000005', auth.uid(), 'Duplicate', 'duplicate@example.test')$$,
  '23505', 'duplicate key value violates unique constraint "estimates_pkey"', 'failed estimate inserts are rejected'
);
reset role;
select is(
  (select estimates_created from public.tradeflow_daily_estimate_usage where user_id = 'a1000000-0000-4000-8000-000000000005' and usage_date = (now() at time zone 'UTC')::date),
  1,
  'a failed estimate insert rolls back its counter increment'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';
insert into public.estimates (user_id, client_name, client_email)
select auth.uid(), 'Pro test ' || n, 'pro' || n || '@example.test'
from generate_series(1, 4) n;
reset role;
select is(
  (select count(*) from public.tradeflow_daily_estimate_usage where user_id = 'a1000000-0000-4000-8000-000000000002'),
  0::bigint,
  'active Pro estimates do not use the free-tier quota'
);

reset role;
select throws_ok(
  $$select public.update_free_daily_estimate_limit(4, 'a1000000-0000-4000-8000-000000000004', 'quota-billing@example.test', 'Change allowance for testing')$$,
  '42501', 'Super administrator access is required.', 'billing admins cannot change global free-tier limits'
);
set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';
select throws_ok(
  $$select public.update_free_daily_estimate_limit(4, 'a1000000-0000-4000-8000-000000000003', 'quota-admin@example.test', 'Change allowance for testing')$$,
  '42501', 'permission denied for function update_free_daily_estimate_limit', 'authenticated users cannot call the service-role-only settings RPC'
);
reset role;
select lives_ok(
  $$select public.update_free_daily_estimate_limit(4, 'a1000000-0000-4000-8000-000000000003', 'quota-admin@example.test', 'Increase test allowance')$$,
  'super admins can change the setting through the audited RPC'
);
select is(
  (select free_daily_estimate_limit from public.tradeflow_app_settings where singleton = true),
  4,
  'the new setting is persisted'
);
select is(
  (select outcome from public.tradeflow_admin_audit_log where action = 'free_estimate_limit_updated' and actor_user_id = 'a1000000-0000-4000-8000-000000000003' order by created_at desc limit 1),
  'succeeded',
  'successful changes are written to the existing audit log'
);
select is(
  (select (details->>'previous_limit') || ':' || (details->>'new_limit') from public.tradeflow_admin_audit_log where action = 'free_estimate_limit_updated' and actor_user_id = 'a1000000-0000-4000-8000-000000000003' order by created_at desc limit 1),
  '2:4',
  'the audit entry records old and new values'
);
select throws_ok(
  $$select public.update_free_daily_estimate_limit(1001, 'a1000000-0000-4000-8000-000000000003', 'quota-admin@example.test', 'Invalid test limit')$$,
  '22023', 'Limit must be an integer from 0 to 10.', 'the database rejects out-of-range limits'
);
select throws_ok(
  $$select public.update_free_daily_estimate_limit(4, 'a1000000-0000-4000-8000-000000000003', 'quota-admin@example.test', 'short')$$,
  '22023', 'Provide a reason between 8 and 500 characters.', 'the database requires a meaningful audit reason'
);

select * from finish();
rollback;
