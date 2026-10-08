begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select ok(
  has_function_privilege('authenticated', 'public.workcraft_update_estimate_status(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.workcraft_update_estimate_status(uuid,text)', 'EXECUTE'),
  'only authenticated users can execute the estimate status RPC'
);
select ok(
  (select p.prosecdef
     and p.proconfig @> array['search_path=""']
   from pg_catalog.pg_proc p
   where p.oid = 'public.workcraft_update_estimate_status(uuid,text)'::regprocedure),
  'the privileged status RPC pins an empty search_path'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a2000000-0000-4000-8000-000000000001', 'status-owner-a@example.test', '{}'),
  ('a2000000-0000-4000-8000-000000000002', 'status-owner-b@example.test', '{}');

insert into public.estimates (id, user_id, client_name, client_email, status)
values
  ('b2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'Owner A pending', 'a@example.test', 'pending'),
  ('b2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'Owner A signed', 'a@example.test', 'accepted'),
  ('b2000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'Owner B', 'b@example.test', 'pending');

update public.estimates
set accepted_at = pg_catalog.now(), signature_name = 'Customer Signature'
where id = 'b2000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';

select is(
  public.workcraft_update_estimate_status('b2000000-0000-4000-8000-000000000001', 'accepted'),
  'accepted',
  'an estimate owner can update their estimate status'
);
select is(
  (select status from public.estimates where id = 'b2000000-0000-4000-8000-000000000001'),
  'accepted',
  'the owner status change is persisted'
);
select is(
  (select client_name from public.estimates where id = 'b2000000-0000-4000-8000-000000000001'),
  'Owner A pending',
  'the status RPC cannot modify estimate customer details'
);

set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.workcraft_update_estimate_status('b2000000-0000-4000-8000-000000000001', 'declined')$$,
  'P0002',
  'ESTIMATE_NOT_FOUND',
  'another account cannot change an estimate status'
);
set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
select is(
  (select status from public.estimates where id = 'b2000000-0000-4000-8000-000000000001'),
  'accepted',
  'a rejected cross-account status change leaves the estimate unchanged'
);

set local request.jwt.claim.sub = 'a2000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.workcraft_update_estimate_status('b2000000-0000-4000-8000-000000000001', 'forged')$$,
  '22023',
  'INVALID_ESTIMATE_STATUS',
  'the RPC rejects statuses outside its allowlist'
);
select throws_ok(
  $$select public.workcraft_update_estimate_status('b2000000-0000-4000-8000-000000000002', 'declined')$$,
  '42501',
  'SIGNED_APPROVAL_STATUS_LOCKED',
  'a recorded customer signature cannot be relabeled declined'
);
select is(
  public.workcraft_update_estimate_status('b2000000-0000-4000-8000-000000000002', 'paid'),
  'paid',
  'a signed estimate can still be marked paid by its owner'
);
select is(
  (select signature_name from public.estimates where id = 'b2000000-0000-4000-8000-000000000002'),
  'Customer Signature',
  'marking a signed estimate paid preserves the customer signature'
);

select * from finish();
rollback;
