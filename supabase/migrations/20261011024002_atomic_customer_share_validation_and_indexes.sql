begin;

-- Keep the current share authorization and the customer mutation in the same
-- row-lock transaction. Match the payment RPC's advisory-then-row lock order.
create function private.workcraft_lock_customer_share(p_estimate_id uuid,p_share_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare v_estimate public.estimates%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_estimate_id::text,0));
 select * into v_estimate from public.estimates where id=p_estimate_id for update;
 if not found or v_estimate.share_revoked_at is not null
   or (v_estimate.share_expires_at is not null and v_estimate.share_expires_at<=pg_catalog.clock_timestamp())
   or (v_estimate.share_token_hash is not null and p_share_hash is distinct from v_estimate.share_token_hash) then
   raise exception using errcode='P0002',message='ESTIMATE_NOT_FOUND';
 end if;
end; $$;
revoke all on function private.workcraft_lock_customer_share(uuid,text) from public,anon,authenticated,service_role;

create function public.workcraft_accept_shared_estimate(p_estimate_id uuid,p_signature_name text,p_selected_package text,p_share_hash text)
returns bigint language plpgsql security definer set search_path='' as $$
begin
 perform private.workcraft_lock_customer_share(p_estimate_id,p_share_hash);
 return public.workcraft_accept_estimate_once(p_estimate_id,p_signature_name,p_selected_package);
end; $$;
create function public.workcraft_decline_shared_estimate(p_estimate_id uuid,p_reason text,p_share_hash text)
returns timestamptz language plpgsql security definer set search_path='' as $$
begin
 perform private.workcraft_lock_customer_share(p_estimate_id,p_share_hash);
 return public.workcraft_customer_decline_estimate(p_estimate_id,p_reason);
end; $$;
create function public.workcraft_submit_shared_proposal_question(p_estimate_id uuid,p_customer_name text,p_customer_email text,p_message text,p_share_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform private.workcraft_lock_customer_share(p_estimate_id,p_share_hash);
 return public.workcraft_submit_proposal_question(p_estimate_id,p_customer_name,p_customer_email,p_message);
end; $$;
create function public.workcraft_prepare_shared_customer_payment(p_user_id uuid,p_estimate_id uuid,p_payment_kind text,p_stripe_account_id text,p_share_hash text)
returns table(payment_id uuid,payment_kind text,amount_cents bigint,reused boolean)
language plpgsql security definer set search_path='' as $$
begin
 perform private.workcraft_lock_customer_share(p_estimate_id,p_share_hash);
 return query select * from public.workcraft_prepare_customer_payment(p_user_id,p_estimate_id,p_payment_kind,p_stripe_account_id);
end; $$;
revoke all on function public.workcraft_accept_shared_estimate(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.workcraft_decline_shared_estimate(uuid,text,text) from public,anon,authenticated;
revoke all on function public.workcraft_submit_shared_proposal_question(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.workcraft_prepare_shared_customer_payment(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.workcraft_accept_shared_estimate(uuid,text,text,text) to service_role;
grant execute on function public.workcraft_decline_shared_estimate(uuid,text,text) to service_role;
grant execute on function public.workcraft_submit_shared_proposal_question(uuid,text,text,text,text) to service_role;
grant execute on function public.workcraft_prepare_shared_customer_payment(uuid,uuid,text,text,text) to service_role;

-- These small tables were inspected before using transactional index creation.
create index contractor_notifications_estimate_id_idx on public.contractor_notifications(estimate_id);
create index estimate_acceptances_user_id_idx on public.estimate_acceptances(user_id);
create index notification_outbox_user_id_idx on public.notification_outbox(user_id);
create index notification_outbox_estimate_id_idx on public.notification_outbox(estimate_id);
create index notification_outbox_job_id_idx on public.notification_outbox(job_id);
create index tradeflow_app_settings_updated_by_idx on public.tradeflow_app_settings(updated_by);
create index tradeflow_media_upload_reservations_estimate_id_idx on public.tradeflow_media_upload_reservations(estimate_id);
create index tradeflow_pro_access_grants_granted_by_idx on public.tradeflow_pro_access_grants(granted_by);
create index tradeflow_pro_access_grants_revoked_by_idx on public.tradeflow_pro_access_grants(revoked_by);
create index transactional_email_events_user_id_idx on public.transactional_email_events(user_id);
create index transactional_email_events_estimate_id_idx on public.transactional_email_events(estimate_id);
create index transactional_email_events_job_id_idx on public.transactional_email_events(job_id);

commit;
