begin;

alter table public.subscriptions
  add column stripe_subscription_created_at bigint,
  add column stripe_checkout_created_at timestamptz;

create table private.subscription_sync_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid not null,
  expires_at timestamptz not null
);
alter table private.subscription_sync_leases enable row level security;
revoke all on private.subscription_sync_leases from public, anon, authenticated;
grant all on private.subscription_sync_leases to service_role;

create function public.workcraft_claim_subscription_sync(p_user_id uuid, p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_token is null then return false; end if;
  insert into private.subscription_sync_leases as lease(user_id, token, expires_at)
  values (p_user_id, p_token, pg_catalog.clock_timestamp() + interval '90 seconds')
  on conflict(user_id) do update set token=excluded.token, expires_at=excluded.expires_at
    where lease.expires_at <= pg_catalog.clock_timestamp();
  return found;
end; $$;

create function public.workcraft_release_subscription_sync(p_user_id uuid, p_token uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.subscription_sync_leases where user_id=p_user_id and token=p_token;
$$;

create function public.workcraft_apply_subscription_sync(
  p_user_id uuid, p_token uuid, p_subscription_id text, p_customer_id text,
  p_created bigint, p_status text, p_period_end timestamptz,
  p_attempt_id uuid default null, p_session_id text default null,
  p_previous_created bigint default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_current public.subscriptions%rowtype;
  v_attempt public.pro_checkout_attempts%rowtype;
  v_created bigint;
begin
  perform 1 from private.subscription_sync_leases
    where user_id=p_user_id and token=p_token and expires_at>pg_catalog.clock_timestamp()
    for update;
  if not found then raise exception 'SUBSCRIPTION_LEASE_EXPIRED'; end if;
  if p_subscription_id is null or p_customer_id is null or p_status is null or p_created is null or p_created<0 or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_status not in ('active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused') then
    raise exception 'INVALID_SUBSCRIPTION_STATE';
  end if;
  select * into v_current from public.subscriptions where user_id=p_user_id for update;
  if p_attempt_id is not null then
    select * into v_attempt from public.pro_checkout_attempts
      where id=p_attempt_id and user_id=p_user_id and stripe_checkout_session_id=p_session_id for update;
    if not found then raise exception 'CHECKOUT_ATTEMPT_MISMATCH'; end if;
    update public.pro_checkout_attempts set status='completed', checkout_url=null,
      updated_at=pg_catalog.now() where id=v_attempt.id;
  end if;

  if v_current.stripe_subscription_id is distinct from p_subscription_id then
    -- Provider events alone cannot adopt a different subscription. Only an
    -- authenticated checkout reservation plus a verified completed session can.
    if p_attempt_id is null then return false; end if;
    if v_current.stripe_subscription_id is not null then
      v_created := coalesce(v_current.stripe_subscription_created_at, p_previous_created);
      if v_created is null then raise exception 'SUBSCRIPTION_BASELINE_REQUIRED'; end if;
      if p_created<v_created or (p_created=v_created and
        (v_current.stripe_checkout_created_at is null or v_attempt.created_at<=v_current.stripe_checkout_created_at)) then
        return false;
      end if;
    end if;
  end if;
  insert into public.subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status,
    current_period_end,updated_at,stripe_subscription_created_at,stripe_checkout_created_at)
  values(p_user_id,p_customer_id,p_subscription_id,p_status,p_period_end,pg_catalog.now(),p_created,v_attempt.created_at)
  on conflict(user_id) do update set stripe_customer_id=excluded.stripe_customer_id,
    stripe_subscription_id=excluded.stripe_subscription_id,status=excluded.status,
    current_period_end=excluded.current_period_end,updated_at=excluded.updated_at,
    stripe_subscription_created_at=excluded.stripe_subscription_created_at,
    stripe_checkout_created_at=coalesce(excluded.stripe_checkout_created_at,subscriptions.stripe_checkout_created_at);
  return true;
end; $$;

revoke all on function public.workcraft_claim_subscription_sync(uuid,uuid) from public,anon,authenticated;
revoke all on function public.workcraft_release_subscription_sync(uuid,uuid) from public,anon,authenticated;
revoke all on function public.workcraft_apply_subscription_sync(uuid,uuid,text,text,bigint,text,timestamptz,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.workcraft_claim_subscription_sync(uuid,uuid) to service_role;
grant execute on function public.workcraft_release_subscription_sync(uuid,uuid) to service_role;
grant execute on function public.workcraft_apply_subscription_sync(uuid,uuid,text,text,bigint,text,timestamptz,uuid,text,bigint) to service_role;

alter table public.transactional_email_events drop constraint transactional_email_events_event_check;
alter table public.transactional_email_events add constraint transactional_email_events_event_check
  check(event in ('sent','delivered','delivery_delayed','bounced','complained','failed','suppressed'));
alter table public.email_delivery_inbox drop constraint email_delivery_inbox_event_check;
alter table public.email_delivery_inbox add constraint email_delivery_inbox_event_check
  check(event in ('delivered','delivery_delayed','bounced','complained','failed','suppressed'));

create or replace function public.workcraft_record_email_delivery(p_event_id text,p_email_id text,p_event text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_sent public.transactional_email_events%rowtype; v_estimate record;
begin
 if p_event not in ('delivered','delivery_delayed','bounced','complained','failed','suppressed') or length(p_event_id)>200 or length(p_email_id)>200 then raise exception 'INVALID_DELIVERY_EVENT'; end if;
 insert into public.email_delivery_inbox(provider_event_id,provider_email_id,event)
 values(p_event_id,p_email_id,p_event) on conflict do nothing;
 select * into v_sent from public.transactional_email_events where provider_email_id=p_email_id and event='sent' limit 1;
 if found then
  insert into public.transactional_email_events(user_id,estimate_id,job_id,source,recipient,provider_email_id,provider_event_id,event)
  values(v_sent.user_id,v_sent.estimate_id,v_sent.job_id,v_sent.source,v_sent.recipient,p_email_id,p_event_id,p_event) on conflict(provider_event_id) do nothing;
 end if;
 select user_id,estimate_id,recipient into v_estimate from public.estimate_email_events
 where provider_email_id=p_email_id and event in ('sent','follow_up_sent') order by created_at desc limit 1;
 if found then
  insert into public.estimate_email_events(user_id,estimate_id,recipient,provider_email_id,provider_event_id,event)
  values(v_estimate.user_id,v_estimate.estimate_id,v_estimate.recipient,p_email_id,p_event_id,p_event) on conflict(provider_event_id) where provider_event_id is not null do nothing;
 end if;
 return true;
end; $$;
revoke all on function public.workcraft_record_email_delivery(text,text,text) from public,anon,authenticated;
grant execute on function public.workcraft_record_email_delivery(text,text,text) to service_role;


commit;
