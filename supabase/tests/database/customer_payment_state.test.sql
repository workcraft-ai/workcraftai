begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into auth.users (id, email, raw_user_meta_data)
values
  ('a3000000-0000-4000-8000-000000000001', 'payments-free@example.test', '{}'),
  ('a3000000-0000-4000-8000-000000000002', 'payments-pro@example.test', '{}'),
  ('a3000000-0000-4000-8000-000000000003', 'payments-other@example.test', '{}');
insert into public.subscriptions (user_id, status) values ('a3000000-0000-4000-8000-000000000002', 'active');
insert into public.estimates (id, user_id, client_name, client_email, status, require_deposit, deposit_percentage)
values
  ('b3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'Free', 'free@example.test', 'accepted', false, 0),
  ('b3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'Pro', 'pro@example.test', 'accepted', true, 30);
insert into public.line_items (estimate_id, description, quantity, unit_price)
values ('b3000000-0000-4000-8000-000000000002', 'Accepted job', 1, 100);

insert into public.stripe_connected_accounts (user_id,stripe_account_id,charges_enabled,requirements_due) values ('a3000000-0000-4000-8000-000000000002','acct_pro_test',true,false);

insert into public.customer_payments(id,user_id,estimate_id,stripe_account_id,payment_kind,amount_cents)
 values('c3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002','acct_pro_test','balance',10000);
select ok(not has_function_privilege('authenticated','public.workcraft_apply_customer_payment_state(uuid,text,text,text,bigint)','EXECUTE'),'payment transitions are server-only');
set local role service_role;
select is(public.workcraft_apply_customer_payment_state('c3000000-0000-4000-8000-000000000001','acct_pro_test','succeeded','pi_fixture',0),true,'success is applied');
select is((select status from public.estimates where id='b3000000-0000-4000-8000-000000000002'),'paid','fully paid estimate is paid');
select is(public.workcraft_apply_customer_payment_state(null,'acct_pro_test','refunded','pi_fixture',2000),true,'partial refund is applied');
select is((select amount_refunded_cents from public.customer_payments where id='c3000000-0000-4000-8000-000000000001'),2000::bigint,'partial refund is recorded');
select is(public.workcraft_apply_customer_payment_state(null,'acct_pro_test','refunded','pi_fixture',10000),true,'full refund is applied');
select is(public.workcraft_apply_customer_payment_state(null,'acct_pro_test','refunded','pi_fixture',3000),true,'older partial refund is harmless');
select is((select amount_refunded_cents from public.customer_payments where id='c3000000-0000-4000-8000-000000000001'),10000::bigint,'refund accounting never decreases');
select is(public.workcraft_apply_customer_payment_state('c3000000-0000-4000-8000-000000000001','acct_pro_test','succeeded','pi_fixture',0),true,'late success is harmless');
select is((select status from public.customer_payments where id='c3000000-0000-4000-8000-000000000001'),'refunded','late success preserves the full refund');
select is((select status from public.estimates where id='b3000000-0000-4000-8000-000000000002'),'accepted','refunded estimate is accepted, not paid');
select throws_ok($$select public.workcraft_apply_customer_payment_state('c3000000-0000-4000-8000-000000000001','acct_other','succeeded','pi_fixture',0)$$,'42501','STRIPE_ACCOUNT_MISMATCH','wrong connected account is rejected');
select * from finish();rollback;
