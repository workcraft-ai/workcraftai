begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id, email, raw_user_meta_data) values
  ('a9300000-0000-4000-8000-000000000001', 'archive-owner@example.test', '{}'),
  ('a9300000-0000-4000-8000-000000000002', 'archive-other@example.test', '{}');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values
  ('d9300000-0000-4000-8000-000000000002','a9300000-0000-4000-8000-000000000002','totp','verified',now(),now());
insert into public.estimates(id,user_id,client_name,client_email,status) values
  ('b9300000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001','Approved','customer@example.test','accepted'),
  ('b9300000-0000-4000-8000-000000000002','a9300000-0000-4000-8000-000000000002','Other','other@example.test','accepted'),
  ('b9300000-0000-4000-8000-000000000003','a9300000-0000-4000-8000-000000000001','Pending','customer@example.test','pending');
insert into public.line_items(estimate_id,description) values ('b9300000-0000-4000-8000-000000000003','Pending item');
set local role authenticated;
set local request.jwt.claim.sub = 'a9300000-0000-4000-8000-000000000001';
select is(public.workcraft_set_estimate_archived('b9300000-0000-4000-8000-000000000001',true),true,'owner can archive an approved estimate');
select ok((select is_archived and status='accepted' from public.estimates where id='b9300000-0000-4000-8000-000000000001'),'archive preserves approval status');
select is(public.workcraft_set_estimate_archived('b9300000-0000-4000-8000-000000000001',false),true,'owner can restore an approved estimate');
select is(public.workcraft_set_estimate_archived('b9300000-0000-4000-8000-000000000002',true),false,'owner cannot archive another account estimate');
select results_eq($$with deleted as (delete from public.estimates where id='b9300000-0000-4000-8000-000000000001' returning id) select count(*) from deleted$$,array[0::bigint],'approved estimate cannot be deleted');
select results_eq($$with deleted as (delete from public.estimates where id='b9300000-0000-4000-8000-000000000003' returning id) select count(*) from deleted$$,array[1::bigint],'pending estimate and its line items can be deleted atomically');
set local request.jwt.claim.sub = 'a9300000-0000-4000-8000-000000000002';
set local request.jwt.claims = '{"aal":"aal1"}';
select is(public.workcraft_set_estimate_archived('b9300000-0000-4000-8000-000000000002',true),false,'MFA-enrolled owner cannot archive with an AAL1 session');
set local request.jwt.claims = '{"aal":"aal2"}';
select is(public.workcraft_set_estimate_archived('b9300000-0000-4000-8000-000000000002',true),true,'MFA-enrolled owner can archive with an AAL2 session');
reset role;
select ok(not has_function_privilege('anon','public.workcraft_set_estimate_archived(uuid,boolean)','EXECUTE'),'anonymous users cannot archive estimates');
select * from finish();
rollback;
