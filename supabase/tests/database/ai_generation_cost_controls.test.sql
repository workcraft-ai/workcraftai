begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.tradeflow_ai_daily_usage'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.tradeflow_ai_generation_events'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.tradeflow_ai_global_daily_usage'::regclass),
  'all AI usage tables have RLS enabled'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'tradeflow_ai_generation_events_user_id_idx'),
  'AI event user references are indexed'
);
select ok(
  not has_table_privilege('anon', 'public.tradeflow_ai_daily_usage', 'SELECT')
  and not has_table_privilege('authenticated', 'public.tradeflow_ai_daily_usage', 'SELECT')
  and not has_table_privilege('anon', 'public.tradeflow_ai_generation_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.tradeflow_ai_generation_events', 'SELECT')
  and not has_table_privilege('anon', 'public.tradeflow_ai_global_daily_usage', 'SELECT')
  and not has_table_privilege('authenticated', 'public.tradeflow_ai_global_daily_usage', 'SELECT'),
  'browser roles cannot inspect AI usage'
);
select ok(
  not has_function_privilege('authenticated', 'public.reserve_workcraft_ai_generation(uuid,integer,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.reserve_workcraft_ai_generation(uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_workcraft_ai_generation(uuid,text,integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.complete_workcraft_ai_generation(uuid,text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.update_workcraft_ai_generation_settings(boolean,integer,integer,uuid,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.update_workcraft_ai_generation_settings(boolean,integer,integer,uuid,text,text)', 'EXECUTE'),
  'quota and settings RPCs are unavailable to browser roles'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a6000000-0000-4000-8000-000000000001', 'ai-quota-pro@example.test', '{}'),
  ('a6000000-0000-4000-8000-000000000002', 'ai-quota-free@example.test', '{}'),
  ('a6000000-0000-4000-8000-000000000003', 'ai-quota-admin@example.test', '{}'),
  ('a6000000-0000-4000-8000-000000000004', 'ai-quota-billing@example.test', '{}'),
  ('a6000000-0000-4000-8000-000000000005', 'ai-quota-pro-two@example.test', '{}');
insert into public.tradeflow_admins(user_id, email, role) values
  ('a6000000-0000-4000-8000-000000000003', 'ai-quota-admin@example.test', 'super_admin'),
  ('a6000000-0000-4000-8000-000000000004', 'ai-quota-billing@example.test', 'billing');
insert into public.subscriptions(user_id, status) values
  ('a6000000-0000-4000-8000-000000000001', 'active'),
  ('a6000000-0000-4000-8000-000000000005', 'active');

select is((select ai_daily_generation_limit from public.tradeflow_app_settings where singleton), 5, 'the initial AI allowance is 5 attempts per Pro user per day');
select is((select ai_global_daily_generation_limit from public.tradeflow_app_settings where singleton), 250, 'the initial platform allowance is 250 attempts per UTC day');
select ok((select ai_drafting_enabled from public.tradeflow_app_settings where singleton), 'cloud drafting starts enabled');
update public.tradeflow_app_settings set ai_daily_generation_limit = 2, ai_drafting_enabled = true where singleton;
insert into public.tradeflow_ai_daily_usage(user_id, usage_date, attempts_started, succeeded)
values ('a6000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date - 91, 1, 1);
insert into public.tradeflow_ai_generation_events(user_id, usage_date, created_at, completed_at, outcome, prompt_characters, model)
values ('a6000000-0000-4000-8000-000000000001', (now() at time zone 'UTC')::date - 91, now() - interval '91 days', now() - interval '91 days', 'succeeded', 10, 'gemini-test');

set local role service_role;
select ok((select allowed from public.reserve_workcraft_ai_generation('a6000000-0000-4000-8000-000000000001', 100, 'gemini-test')), 'the first Pro generation reserves a slot');
select is((select count(*) from public.tradeflow_ai_daily_usage where user_id = 'a6000000-0000-4000-8000-000000000001' and usage_date < (now() at time zone 'UTC')::date - 90), 0::bigint, 'daily usage counters older than 90 days are pruned');
select is((select count(*) from public.tradeflow_ai_generation_events where user_id = 'a6000000-0000-4000-8000-000000000001' and created_at < now() - interval '90 days'), 0::bigint, 'AI usage metadata older than 90 days is pruned');
select ok((select allowed from public.reserve_workcraft_ai_generation('a6000000-0000-4000-8000-000000000001', 110, 'gemini-test')), 'the second Pro generation reserves a slot');
select is((select reason from public.reserve_workcraft_ai_generation('a6000000-0000-4000-8000-000000000001', 120, 'gemini-test')), 'daily_limit', 'a Pro user cannot exceed the daily generation cap');
select is((select attempts_started from public.tradeflow_ai_global_daily_usage where usage_date = (now() at time zone 'UTC')::date), 2, 'a rejected per-user attempt releases its platform-wide reservation');
update public.tradeflow_app_settings set ai_global_daily_generation_limit = 3 where singleton;
select ok((select allowed from public.reserve_workcraft_ai_generation('a6000000-0000-4000-8000-000000000005', 100, 'gemini-test')), 'another Pro user can reserve the final platform slot');
select is((select attempts_started from public.tradeflow_ai_global_daily_usage where usage_date = (now() at time zone 'UTC')::date), 3, 'the platform counter stops at its configured allowance');
select is((select reason from public.reserve_workcraft_ai_generation('a6000000-0000-4000-8000-000000000005', 100, 'gemini-test')), 'global_daily_limit', 'the platform-wide AI cap blocks additional users');
select ok((select public.complete_workcraft_ai_generation((select id from public.tradeflow_ai_generation_events where user_id = 'a6000000-0000-4000-8000-000000000001' and prompt_characters = 100), 'succeeded', 200, 3)), 'a successful provider call is recorded');
select ok(not (select public.complete_workcraft_ai_generation((select id from public.tradeflow_ai_generation_events where user_id = 'a6000000-0000-4000-8000-000000000001' and prompt_characters = 100), 'failed', 500, null)), 'a completed generation cannot be counted twice');
select ok((select public.complete_workcraft_ai_generation((select id from public.tradeflow_ai_generation_events where user_id = 'a6000000-0000-4000-8000-000000000001' and prompt_characters = 110), 'failed', 429, null)), 'a failed provider call is recorded');
select is((select attempts_started from public.tradeflow_ai_daily_usage where user_id = 'a6000000-0000-4000-8000-000000000001'), 2, 'both successes and failures consume attempts');
select is((select succeeded from public.tradeflow_ai_daily_usage where user_id = 'a6000000-0000-4000-8000-000000000001'), 1, 'successful call count is tracked');
select is((select failed from public.tradeflow_ai_daily_usage where user_id = 'a6000000-0000-4000-8000-000000000001'), 1, 'failed call count is tracked');
select is((select count(*) from public.tradeflow_ai_generation_events where user_id = 'a6000000-0000-4000-8000-000000000001' and outcome = 'started'), 0::bigint, 'completed events no longer remain pending');
select is((select reason from public.reserve_workcraft_ai_generation('a6000000-0000-4000-8000-000000000002', 100, 'gemini-test')), 'pro_required', 'free accounts cannot reserve cloud AI usage');
reset role;

update public.tradeflow_app_settings set ai_drafting_enabled = false where singleton;
set local role service_role;
select is((select reason from public.reserve_workcraft_ai_generation('a6000000-0000-4000-8000-000000000001', 100, 'gemini-test')), 'paused', 'the global pause prevents new generations');
reset role;
select throws_ok(
  $$select public.update_workcraft_ai_generation_settings(true, 5, 3, 'a6000000-0000-4000-8000-000000000004', 'ai-quota-billing@example.test', 'Should not be allowed')$$,
  '42501', 'SUPER_ADMIN_REQUIRED', 'billing admins cannot change global AI controls'
);
select lives_ok(
  $$select public.update_workcraft_ai_generation_settings(false, 5, 6, 'a6000000-0000-4000-8000-000000000003', 'ai-quota-admin@example.test', 'Pause during test')$$,
  'super admins can change AI settings through the audited RPC'
);
select is((select ai_daily_generation_limit from public.tradeflow_app_settings where singleton), 5, 'the admin-configured AI allowance is persisted');
select is((select ai_global_daily_generation_limit from public.tradeflow_app_settings where singleton), 6, 'the admin-configured platform cap is persisted');
select ok((select details->>'previous_daily_limit' = '2' and details->>'daily_limit' = '5' and details->>'previous_global_daily_limit' = '3' and details->>'global_daily_limit' = '6' from public.tradeflow_admin_audit_log where actor_user_id = 'a6000000-0000-4000-8000-000000000003' and action = 'ai_generation_settings_updated' order by created_at desc limit 1), 'the audit entry records old and new per-user and platform caps');
select is((select action from public.tradeflow_admin_audit_log where actor_user_id = 'a6000000-0000-4000-8000-000000000003' and action = 'ai_generation_settings_updated' order by created_at desc limit 1), 'ai_generation_settings_updated', 'AI settings changes are recorded in the admin audit log');
select * from finish();
rollback;
