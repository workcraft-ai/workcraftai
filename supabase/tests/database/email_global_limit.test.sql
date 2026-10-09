begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tradeflow_app_email_daily_usage'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.tradeflow_app_email_reservations'::regclass),
  'app email quota tables have RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.tradeflow_app_email_daily_usage', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.tradeflow_app_email_daily_usage', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.tradeflow_app_email_reservations', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.tradeflow_app_email_reservations', 'SELECT,INSERT,UPDATE,DELETE'),
  'app email quota data is private from browser roles'
);
select ok(
  not has_function_privilege('anon', 'public.workcraft_reserve_app_email(text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.workcraft_reserve_app_email(text,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.workcraft_reserve_app_email(text,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.workcraft_release_app_email(uuid)', 'EXECUTE'),
  'only trusted server code can reserve or release quota'
);
select is(
  (select app_email_daily_limit from public.tradeflow_app_settings where singleton = true),
  75,
  'the default platform email cap is 75 per UTC day'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'tradeflow_app_email_reservations'
      and indexname = 'tradeflow_app_email_reservations_user_id_idx'
  ),
  'email reservation user foreign key has a supporting index'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a5000000-0000-4000-8000-000000000001', 'email-quota-pro@example.test', '{}'),
  ('a5000000-0000-4000-8000-000000000002', 'email-quota-free@example.test', '{}'),
  ('a5000000-0000-4000-8000-000000000003', 'email-quota-admin@example.test', '{}');
insert into public.subscriptions (user_id, status)
values ('a5000000-0000-4000-8000-000000000001', 'active');
insert into public.tradeflow_admins (user_id, email, role)
values ('a5000000-0000-4000-8000-000000000003', 'email-quota-admin@example.test', 'super_admin');
insert into public.estimates (id, user_id, client_name, client_email)
values ('b5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'Quota Test', 'customer@example.test');

set local role service_role;
select is(
  (select reason from public.workcraft_reserve_app_email('support')),
  'allowed',
  'a valid app email can reserve one global slot'
);
select is(
  (select emails_started from public.tradeflow_app_email_daily_usage where usage_date = (pg_catalog.now() at time zone 'UTC')::date),
  1,
  'global counter increments when a reservation is accepted'
);
select is(
  public.workcraft_release_app_email((select id from public.tradeflow_app_email_reservations where source = 'support' order by created_at desc limit 1)),
  true,
  'a failed send releases its reservation once'
);
select is(
  public.workcraft_release_app_email((select id from public.tradeflow_app_email_reservations where source = 'support' order by created_at desc limit 1)),
  false,
  'releasing the same reservation twice has no effect'
);
select is(
  (select emails_started from public.tradeflow_app_email_daily_usage where usage_date = (pg_catalog.now() at time zone 'UTC')::date),
  0,
  'released reservations decrement the global counter exactly once'
);
select ok(
  exists (
    select 1
    from public.workcraft_reserve_estimate_email('a5000000-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001') as reservation
    where reservation.reason = 'allowed'
      and reservation.usage_date = (pg_catalog.now() at time zone 'UTC')::date
      and reservation.account_daily_limit = 5
      and reservation.account_monthly_limit = 100
  ),
  'Pro estimate email reserves quota and returns the per-account limits'
);
select is(
  (select email_count from public.estimate_email_daily_usage where user_id = 'a5000000-0000-4000-8000-000000000001' and usage_date = (pg_catalog.now() at time zone 'UTC')::date),
  1,
  'estimate email retains its separate per-account counter'
);
select is(
  public.workcraft_release_app_email((select id from public.tradeflow_app_email_reservations where source = 'estimate' order by created_at desc limit 1)),
  true,
  'failed estimate email releases both counters'
);
select is(
  (select email_count from public.estimate_email_daily_usage where user_id = 'a5000000-0000-4000-8000-000000000001' and usage_date = (pg_catalog.now() at time zone 'UTC')::date),
  0,
  'estimate account quota is restored after a definite provider rejection'
);
select is(
  public.update_workcraft_email_daily_limit(1, 'a5000000-0000-4000-8000-000000000003', 'email-quota-admin@example.test', 'Test global limit'),
  1,
  'authorized super admin can update the platform email cap'
);
select is(
  (select reason from public.workcraft_reserve_app_email(
    'follow_up',
    'a5000000-0000-4000-8000-000000000001',
    'b5000000-0000-4000-8000-000000000001'
  )),
  'allowed',
  'the final available global slot is reserved'
);
select is(
  (select reason from public.workcraft_reserve_app_email('account_retention')),
  'platform_daily_limit',
  'concurrent app email paths stop at the configured global limit'
);
select throws_ok(
  $$select * from public.workcraft_reserve_app_email('arbitrary')$$,
  '22023', 'INVALID_APP_EMAIL_SOURCE', 'only known email sources can reserve quota'
);
select throws_ok(
  $$select public.update_workcraft_email_daily_limit(1, 'a5000000-0000-4000-8000-000000000002', 'email-quota-free@example.test', 'Unauthorized update')$$,
  '42501', 'SUPER_ADMIN_REQUIRED', 'non-admin users cannot change the cap'
);
select throws_ok(
  $$select public.update_workcraft_email_daily_limit(91, 'a5000000-0000-4000-8000-000000000003', 'email-quota-admin@example.test', 'Invalid high limit')$$,
  '22023', 'APP_EMAIL_LIMIT_MUST_BE_BETWEEN_1_AND_90', 'the cap cannot exceed the provider safety ceiling'
);
select is(
  (select count(*) from public.tradeflow_admin_audit_log where actor_user_id = 'a5000000-0000-4000-8000-000000000003' and action = 'app_email_daily_limit_updated' and outcome = 'succeeded'),
  1::bigint,
  'admin cap changes are recorded in the audit log'
);
reset role;

select * from finish();
rollback;
