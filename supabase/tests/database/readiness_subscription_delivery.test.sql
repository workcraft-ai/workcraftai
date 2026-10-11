begin;
create extension if not exists pgtap with schema extensions;
select plan(18);
insert into auth.users(id,email,raw_user_meta_data)
values ('a8000000-0000-4000-8000-000000000001','readiness-owner@example.test','{}');
insert into public.pro_checkout_attempts(id,user_id,status,stripe_checkout_session_id,created_at)
values ('c8000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','completed','cs_old','2026-10-01'),
       ('c8000000-0000-4000-8000-000000000002','a8000000-0000-4000-8000-000000000001','completed','cs_new','2026-10-02');
select ok((select relrowsecurity from pg_class where oid='private.subscription_sync_leases'::regclass),'lease storage has RLS');
select ok(not has_table_privilege('authenticated','private.subscription_sync_leases','SELECT,INSERT,UPDATE,DELETE'),'lease storage is private');
select ok(not has_function_privilege('authenticated','public.workcraft_apply_subscription_sync(uuid,uuid,text,text,bigint,text,timestamptz,uuid,text,bigint)','EXECUTE'),'browser cannot mutate subscription identity');
select is(public.workcraft_claim_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001'),true,'first worker acquires lease');
select is(public.workcraft_claim_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000002'),false,'second worker cannot overlap');
select is(public.workcraft_apply_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','sub_old','cus_fixture',100,'active',null,'c8000000-0000-4000-8000-000000000001','cs_old'),true,'verified checkout adopts first subscription');
select is(public.workcraft_apply_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','sub_new','cus_fixture',200,'active',null,'c8000000-0000-4000-8000-000000000002','cs_new'),true,'newer checkout adopts replacement');
select is(public.workcraft_apply_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','sub_old','cus_fixture',100,'canceled',null),false,'delayed old canceled event is ignored');
select is(public.workcraft_apply_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','sub_old','cus_fixture',100,'active',null,'c8000000-0000-4000-8000-000000000001','cs_old'),false,'delayed old checkout is ignored');
select is((select stripe_subscription_id||':'||status from public.subscriptions where user_id='a8000000-0000-4000-8000-000000000001'),'sub_new:active','new active subscription remains intact');
update private.subscription_sync_leases set expires_at=clock_timestamp()-interval '1 second' where user_id='a8000000-0000-4000-8000-000000000001';
select is(public.workcraft_claim_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000002'),true,'new worker acquires expired lease');
select throws_ok($$select public.workcraft_apply_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001','sub_new','cus_fixture',200,'canceled',null)$$,'P0001','SUBSCRIPTION_LEASE_EXPIRED','expired worker is fenced');
select is(public.workcraft_apply_subscription_sync('a8000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000002','sub_new','cus_fixture',200,'past_due',null),true,'current authoritative past_due state still applies');
select is((select status from public.subscriptions where user_id='a8000000-0000-4000-8000-000000000001'),'past_due','past_due policy remains immediate downgrade');
select is(public.workcraft_record_email_delivery('readiness-failed','readiness-mail','failed'),true,'failed delivery retained before send');
select is(public.workcraft_record_email_delivery('readiness-suppressed','readiness-mail','suppressed'),true,'suppressed delivery retained before send');
select is(public.workcraft_record_email_delivery('readiness-failed','readiness-mail','failed'),true,'duplicate provider event accepted');
select is((select count(*) from public.email_delivery_inbox where provider_email_id='readiness-mail'),2::bigint,'delivery inbox records events once');
select * from finish();
rollback;
