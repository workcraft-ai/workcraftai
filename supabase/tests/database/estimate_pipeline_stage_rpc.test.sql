begin;
select plan(14);

select ok(
  has_function_privilege('authenticated', 'public.workcraft_update_estimate_pipeline_stage(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.workcraft_update_estimate_pipeline_stage(uuid,text)', 'EXECUTE'),
  'only authenticated users can update an estimate pipeline stage'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = to_regprocedure('public.workcraft_update_estimate_status(uuid,text)')
  ),
  'the dashboard status editing RPC has been removed'
);
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_catalog.pg_proc p
   where p.oid = 'public.workcraft_update_estimate_pipeline_stage(uuid,text)'::regprocedure),
  'the pipeline RPC is privileged with an empty search path'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a2000000-0000-4000-8000-000000000001', 'status-owner-a@example.test', '{}'),
  ('a2000000-0000-4000-8000-000000000002', 'status-owner-b@example.test', '{}');

insert into public.estimates (id, user_id, client_name, client_email, status)
values
  ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Owner A pending', 'a@example.test', 'pending'),
  ('b2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Owner A accepted', 'a@example.test', 'accepted'),
  ('b2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'Owner B', 'b@example.test', 'pending');

insert into public.estimate_acceptances (estimate_id, user_id, signature_name, accepted_total_cents, proposal_snapshot)
values ('b2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Customer Signature', 1000, '{}'::jsonb);

set local role authenticated;
set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';

select is(
  public.workcraft_update_estimate_pipeline_stage('b2000000-0000-4000-8000-000000000001', 'follow_up'),
  'follow_up',
  'an estimate owner can update their internal pipeline stage'
);
select is(
  (select pipeline_stage from public.estimates where id = 'b2000000-0000-4000-8000-000000000001'),
  'follow_up',
  'the pipeline stage update is persisted'
);
select throws_ok(
  $$select public.workcraft_update_estimate_pipeline_stage('b2000000-0000-4000-8000-000000000001', 'closed_won')$$,
  '22023', 'CUSTOMER_APPROVAL_REQUIRED', 'a pending estimate cannot be marked won'
);
select throws_ok(
  $$select public.workcraft_update_estimate_pipeline_stage('b2000000-0000-4000-8000-000000000003', 'closed_lost')$$,
  'P0002', 'ESTIMATE_NOT_FOUND', 'another account cannot edit the estimate pipeline'
);
select throws_ok(
  $$select public.workcraft_update_estimate_pipeline_stage('b2000000-0000-4000-8000-000000000001', 'forged')$$,
  '22023', 'INVALID_PIPELINE_STAGE', 'the RPC rejects stages outside the allowlist'
);
select is(
  public.workcraft_update_estimate_pipeline_stage('b2000000-0000-4000-8000-000000000001', 'closed_lost'),
  'closed_lost', 'an owner can close a pending estimate as lost for internal tracking'
);
select throws_ok(
  $$select public.workcraft_update_estimate_pipeline_stage('b2000000-0000-4000-8000-000000000002', 'active')$$,
  '42501', 'ACCEPTED_ESTIMATE_STAGE_LOCKED', 'a customer-approved estimate remains won'
);
select is(
  public.workcraft_update_estimate_pipeline_stage('b2000000-0000-4000-8000-000000000002', 'closed_won'),
  'closed_won', 'an accepted estimate retains its won pipeline stage'
);
select is(
  (select status from public.estimates where id = 'b2000000-0000-4000-8000-000000000002'),
  'accepted', 'pipeline changes never modify verified customer status'
);
select is(
  (select pipeline_stage from public.estimates where id = 'b2000000-0000-4000-8000-000000000002'),
  'closed_won', 'customer acceptance is reflected as a won pipeline stage'
);
select is(
  has_function_privilege('authenticated', 'public.workcraft_get_accepted_total_cents(uuid)', 'EXECUTE'),
  true, 'owners can check their own accepted total through the guarded helper'
);

select * from finish();
rollback;
