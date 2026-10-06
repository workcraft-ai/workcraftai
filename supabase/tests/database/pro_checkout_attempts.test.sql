begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.pro_checkout_attempts'::regclass),
  'Pro checkout attempt storage has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.pro_checkout_attempts', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.pro_checkout_attempts', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'public.pro_checkout_attempts', 'SELECT,INSERT,UPDATE,DELETE'),
  'Pro checkout attempts are private to the server service role'
);
select ok(
  not has_function_privilege('authenticated', 'public.workcraft_reserve_pro_checkout(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.workcraft_reserve_pro_checkout(uuid)', 'EXECUTE'),
  'only the service role can reserve Pro checkout attempts'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pro_checkout_attempts_one_live_per_user_idx'),
  'the database enforces one live Pro checkout reservation per account'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a4000000-0000-4000-8000-000000000001', 'checkout-free@example.test', '{}'),
  ('a4000000-0000-4000-8000-000000000002', 'checkout-pro@example.test', '{}');
insert into public.subscriptions (user_id, status)
values ('a4000000-0000-4000-8000-000000000002', 'active');

set local role service_role;
select lives_ok(
  $$select * from public.workcraft_reserve_pro_checkout('a4000000-0000-4000-8000-000000000001')$$,
  'the server can reserve a durable checkout attempt for a free account'
);
select is(
  (select reused from public.workcraft_reserve_pro_checkout('a4000000-0000-4000-8000-000000000001')),
  true,
  'concurrent or retried checkout requests reuse the active reservation'
);
select is(
  (select count(*) from public.pro_checkout_attempts where user_id = 'a4000000-0000-4000-8000-000000000001' and status in ('creating', 'open')),
  1::bigint,
  'only one live Pro checkout attempt exists per account'
);
select throws_ok(
  $$select * from public.workcraft_reserve_pro_checkout('a4000000-0000-4000-8000-000000000002')$$,
  '55000', 'WORKCRAFT_PRO_ALREADY_ACTIVE', 'Pro accounts cannot start another subscription checkout'
);
reset role;

set local role authenticated;
select is((select count(*) from public.pro_checkout_attempts), 0::bigint, 'browser users cannot inspect Pro checkout attempts');
reset role;

select * from finish();
rollback;
