-- Execute ONLY in Staging. All fixtures and state changes are rolled back.
begin;
do $$
declare
 u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); payment uuid:=gen_random_uuid(); q uuid:=gen_random_uuid(); notification uuid;
 account text:='acct_readiness_'||replace(gen_random_uuid()::text,'-',''); provider text:='readiness-mail-'||gen_random_uuid()::text;
begin
 if has_function_privilege('authenticated','public.workcraft_apply_customer_payment_state(uuid,text,text,text,bigint)','execute') or has_function_privilege('anon','public.workcraft_claim_notifications(integer,uuid[])','execute') then raise exception 'Server-only RPC exposed'; end if;
 insert into auth.users(id,email,raw_user_meta_data) values(u,'readiness-'||u::text||'@example.test','{}'),(other_user,'readiness-'||other_user::text||'@example.test','{}');
 insert into public.subscriptions(user_id,status) values(u,'active');
 insert into public.estimates(id,user_id,client_name,client_email,status) values(e,u,'Disposable readiness fixture','customer@example.test','accepted');
 insert into public.line_items(estimate_id,description,quantity,unit_price) values(e,'Fixture',1,100);
 insert into public.stripe_connected_accounts(user_id,stripe_account_id,charges_enabled,requirements_due) values(u,account,true,false);
 insert into public.customer_payments(id,user_id,estimate_id,stripe_account_id,payment_kind,amount_cents) values(payment,u,e,account,'balance',10000);
 if not public.workcraft_apply_customer_payment_state(payment,account,'succeeded','pi_'||payment::text,0) then raise exception 'Payment application failed'; end if;
 perform public.workcraft_apply_customer_payment_state(null,account,'refunded','pi_'||payment::text,10000);
 perform public.workcraft_apply_customer_payment_state(null,account,'refunded','pi_'||payment::text,3000);
 perform public.workcraft_apply_customer_payment_state(payment,account,'succeeded','pi_'||payment::text,0);
 if (select amount_refunded_cents from public.customer_payments where id=payment)<>10000 or (select status from public.estimates where id=e)<>'accepted' then raise exception 'Payment state regressed'; end if;
 insert into public.proposal_questions(id,user_id,estimate_id,customer_name,customer_email,message) values(q,u,e,'Fixture','customer@example.test','Test only; rolled back');
 select id into notification from public.notification_outbox where send_key='proposal-question-'||q::text;
 if notification is null then raise exception 'Atomic question notification missing'; end if;
 perform public.workcraft_record_email_delivery('event-'||provider,provider,'delivered');
 perform public.workcraft_finish_notification(notification,provider,'customer@example.test');
 perform public.workcraft_finish_notification(notification,provider,'customer@example.test');
 if (select count(*) from public.transactional_email_events where provider_email_id=provider)<>2 then raise exception 'Email correlation or idempotency failed'; end if;
 if public.workcraft_set_proposal_share(e,other_user,repeat('a',64),'encrypted-fixture',null,false) then raise exception 'Share owner check failed'; end if;
 if not public.workcraft_set_proposal_share(e,u,repeat('a',64),'encrypted-fixture',null,false) or not public.workcraft_set_proposal_share(e,u,null,null,null,true) then raise exception 'Share replacement/revocation failed'; end if;
 if (select share_revoked_at is null from public.estimates where id=e) then raise exception 'Revocation not recorded'; end if;
end; $$;
select 'PASS: payment ordering, queued question, early delivery correlation, idempotency, server-only RPCs and share ownership/revocation' as result;
rollback;
