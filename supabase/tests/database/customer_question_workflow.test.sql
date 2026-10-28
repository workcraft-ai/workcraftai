begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users(id, email, raw_user_meta_data) values
  ('a9200000-0000-4000-8000-000000000001', 'question-owner@example.test', '{}'),
  ('a9200000-0000-4000-8000-000000000002', 'question-other@example.test', '{}');
insert into public.estimates(id, user_id, client_name, client_email) values
  ('b9200000-0000-4000-8000-000000000001', 'a9200000-0000-4000-8000-000000000001', 'Owner', 'customer@example.test'),
  ('b9200000-0000-4000-8000-000000000002', 'a9200000-0000-4000-8000-000000000002', 'Other', 'other@example.test');
insert into public.proposal_questions(id, user_id, estimate_id, customer_name, customer_email, message) values
  ('c9200000-0000-4000-8000-000000000001', 'a9200000-0000-4000-8000-000000000001', 'b9200000-0000-4000-8000-000000000001', 'Customer', 'customer@example.test', 'Question A'),
  ('c9200000-0000-4000-8000-000000000002', 'a9200000-0000-4000-8000-000000000002', 'b9200000-0000-4000-8000-000000000002', 'Other customer', 'other@example.test', 'Question B');

set local role authenticated;
set local request.jwt.claim.sub = 'a9200000-0000-4000-8000-000000000001';
select is((select count(*) from public.proposal_questions), 1::bigint, 'owner sees only their own question');
select is((select count(*) from public.contractor_notifications where question_id = 'c9200000-0000-4000-8000-000000000001'), 1::bigint, 'notification points to the question');
select lives_ok($$update public.proposal_questions set read_at = now() where id = 'c9200000-0000-4000-8000-000000000001'$$, 'owner can mark question read');
select ok((select read_at is not null and responded_at is null and archived_at is null from public.proposal_questions where id = 'c9200000-0000-4000-8000-000000000001'), 'reading does not respond or archive');
select lives_ok($$update public.proposal_questions set responded_at = now(), archived_at = now() where id = 'c9200000-0000-4000-8000-000000000001'$$, 'owner can respond and archive');
select lives_ok($$update public.proposal_questions set archived_at = null where id = 'c9200000-0000-4000-8000-000000000001'$$, 'owner can restore');
select ok((select responded_at is not null and archived_at is null from public.proposal_questions where id = 'c9200000-0000-4000-8000-000000000001'), 'restore keeps response status');
select throws_ok($$update public.proposal_questions set message = 'modified' where id = 'c9200000-0000-4000-8000-000000000001'$$, '42501', 'permission denied for table proposal_questions', 'owner cannot change question content');
select results_eq($$with deleted as (delete from public.proposal_questions where id = 'c9200000-0000-4000-8000-000000000002' returning id) select count(*) from deleted$$, array[0::bigint], 'owner cannot delete another account question');
select results_eq($$with deleted as (delete from public.proposal_questions where id = 'c9200000-0000-4000-8000-000000000001' returning id) select count(*) from deleted$$, array[1::bigint], 'owner can delete their own question');

reset role;
select is((select count(*) from public.contractor_notifications where source_key = 'question:c9200000-0000-4000-8000-000000000001'), 0::bigint, 'deleting a question removes its bell notification');
select * from finish();
rollback;
