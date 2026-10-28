begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
insert into auth.users(id,email,raw_user_meta_data) values
  ('a9400000-0000-4000-8000-000000000001','new-signup@example.test','{"workcraft_terms_accepted":true}'),
  ('a9400000-0000-4000-8000-000000000002','internal-fixture@example.test','{}');
select is((select count(*) from public.notification_outbox where send_key='signup-alert-a9400000-0000-4000-8000-000000000001' and source='signup_alert'),1::bigint,'app signup queues one internal alert');
select is((select count(*) from public.notification_outbox where user_id='a9400000-0000-4000-8000-000000000002' and source='signup_alert'),0::bigint,'non-signup auth records do not queue an alert');
select is((select payload from public.notification_outbox where send_key='signup-alert-a9400000-0000-4000-8000-000000000001'),'{}'::jsonb,'queued alert stores no verification secrets');
select ok(not has_table_privilege('authenticated','public.notification_outbox','SELECT,INSERT,UPDATE,DELETE'),'signup alert queue remains private');
select * from finish();
rollback;
