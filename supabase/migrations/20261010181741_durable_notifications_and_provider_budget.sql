begin;

-- A saved question and its notification are committed together. Browser roles
-- cannot enqueue or send mail; owners can read only their delivery ledger.
create table public.notification_outbox (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete cascade,
 estimate_id uuid references public.estimates(id) on delete cascade,
 job_id uuid references public.jobs(id) on delete cascade,
 source text not null check(source in ('estimate','proposal_question','invoice','follow_up','billing','auth')),
 send_key text not null unique check(length(send_key) between 1 and 200),
 payload jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease_until timestamptz,
 first_attempt_at timestamptz,
 reservation_id uuid,
 provider_email_id text,
 last_error text,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);
create index notification_outbox_pending_idx on public.notification_outbox(next_attempt_at) where status in ('pending','sending');
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public,anon,authenticated;
grant all on public.notification_outbox to service_role;

create table public.transactional_email_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete cascade,
 estimate_id uuid references public.estimates(id) on delete cascade,
 job_id uuid references public.jobs(id) on delete cascade,
 source text not null,
 recipient text not null,
 provider_email_id text not null,
 provider_event_id text unique,
 event text not null check(event in ('sent','delivered','delivery_delayed','bounced','complained')),
 created_at timestamptz not null default now()
);
create index transactional_email_provider_idx on public.transactional_email_events(provider_email_id);
create unique index transactional_email_sent_idx on public.transactional_email_events(provider_email_id) where event='sent';
alter table public.transactional_email_events enable row level security;
revoke all on public.transactional_email_events from public,anon,authenticated;
grant select on public.transactional_email_events to authenticated;
grant all on public.transactional_email_events to service_role;
create policy "Owners read their email delivery" on public.transactional_email_events for select to authenticated using(user_id=(select auth.uid()));

-- Signed events may arrive before a successful send is recorded. Keep their
-- correlation keys, not the entire provider payload or recipient details.
create table public.email_delivery_inbox (
 provider_event_id text primary key,
 provider_email_id text not null,
 event text not null check(event in ('delivered','delivery_delayed','bounced','complained')),
 received_at timestamptz not null default now()
);
alter table public.email_delivery_inbox enable row level security;
revoke all on public.email_delivery_inbox from public,anon,authenticated;
grant all on public.email_delivery_inbox to service_role;

create function private.workcraft_enqueue_question_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if public.workcraft_user_has_pro(new.user_id) then
  insert into public.notification_outbox(user_id,estimate_id,source,send_key)
    values(new.user_id,new.estimate_id::uuid,'proposal_question','proposal-question-'||new.id::text)
    on conflict(send_key) do nothing;
 end if;
 return new;
end; $$;
revoke all on function private.workcraft_enqueue_question_notification() from public,anon,authenticated;
create trigger workcraft_question_notification after insert on public.proposal_questions for each row execute function private.workcraft_enqueue_question_notification();

create function public.workcraft_claim_notifications(p_limit integer default 10,p_ids uuid[] default null)
returns setof public.notification_outbox language sql security definer set search_path='' as $$
 with due as (
  select o.id from public.notification_outbox o
  where (p_ids is null or o.id=any(p_ids)) and o.next_attempt_at<=now()
    and (o.status='pending' or (o.status='sending' and o.lease_until<now()))
  order by case when o.source='auth' then 0 when o.source='billing' then 1 else 2 end,o.next_attempt_at
  for update skip locked limit greatest(1,least(p_limit,20))
 ) update public.notification_outbox o set status='sending',lease_until=now()+interval '2 minutes',attempts=attempts+1
 from due where o.id=due.id returning o.*;
$$;
revoke all on function public.workcraft_claim_notifications(integer,uuid[]) from public,anon,authenticated;
grant execute on function public.workcraft_claim_notifications(integer,uuid[]) to service_role;

create function public.workcraft_record_email_delivery(p_event_id text,p_email_id text,p_event text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_sent public.transactional_email_events%rowtype; v_estimate record;
begin
 if p_event not in ('delivered','delivery_delayed','bounced','complained') or length(p_event_id)>200 or length(p_email_id)>200 then raise exception 'INVALID_DELIVERY_EVENT'; end if;
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

create function public.workcraft_finish_notification(p_id uuid,p_email_id text,p_recipient text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_row public.notification_outbox%rowtype; v_event record;
begin
 select * into v_row from public.notification_outbox where id=p_id for update;
 if not found then return false; end if;
 if v_row.status='sent' then return true; end if;
 if p_email_id is null or length(p_email_id) not between 1 and 200 then raise exception 'INVALID_EMAIL_ID'; end if;
 insert into public.transactional_email_events(user_id,estimate_id,job_id,source,recipient,provider_email_id,event)
 values(v_row.user_id,v_row.estimate_id,v_row.job_id,v_row.source,p_recipient,p_email_id,'sent') on conflict do nothing;
 if v_row.source='estimate' then
  insert into public.estimate_email_events(user_id,estimate_id,recipient,provider_email_id,event)
  values(v_row.user_id,v_row.estimate_id,p_recipient,p_email_id,'sent');
  update public.estimates set followup_at=now()+interval '7 days',followup_sent_at=null,followup_claimed_at=null
  where id=v_row.estimate_id and user_id=v_row.user_id;
 elsif v_row.source='invoice' then
  update public.jobs set invoice_status=case when invoice_status='paid' then 'paid' else 'sent' end,client_email=p_recipient where id=v_row.job_id and user_id=v_row.user_id;
 elsif v_row.source='follow_up' then
  perform public.workcraft_finish_estimate_followup(v_row.estimate_id,true);
  insert into public.estimate_email_events(user_id,estimate_id,recipient,provider_email_id,event)
  values(v_row.user_id,v_row.estimate_id,p_recipient,p_email_id,'follow_up_sent');
 end if;
 update public.notification_outbox set status='sent',provider_email_id=p_email_id,sent_at=now(),lease_until=null,payload='{}'::jsonb,last_error=null where id=p_id;
 for v_event in select * from public.email_delivery_inbox where provider_email_id=p_email_id loop
  perform public.workcraft_record_email_delivery(v_event.provider_event_id,p_email_id,v_event.event);
 end loop;
 return true;
end; $$;
revoke all on function public.workcraft_finish_notification(uuid,text,text) from public,anon,authenticated;
grant execute on function public.workcraft_finish_notification(uuid,text,text) to service_role;

-- Keep customer budgets unchanged per account (5/day,100/month), but bound
-- total provider admission with separate 75 app,20 Auth,5 billing pools.
create table public.provider_email_daily_usage (
 usage_date date not null, source text not null check(source in ('app','auth','billing')),
 emails_started integer not null check(emails_started>=0), primary key(usage_date,source)
);
alter table public.provider_email_daily_usage enable row level security;
revoke all on public.provider_email_daily_usage from public,anon,authenticated;
grant all on public.provider_email_daily_usage to service_role;
alter table public.tradeflow_app_email_reservations drop constraint tradeflow_app_email_reservations_source_check;
alter table public.tradeflow_app_email_reservations add constraint tradeflow_app_email_reservations_source_check check(source in ('estimate','follow_up','support','proposal_question','account_retention','invoice','billing','auth'));

alter function public.workcraft_reserve_app_email(text,uuid,uuid,uuid) rename to workcraft_reserve_customer_email_internal;
revoke all on function public.workcraft_reserve_customer_email_internal(text,uuid,uuid,uuid) from public,anon,authenticated;
create function public.workcraft_reserve_app_email(p_source text,p_user_id uuid default null,p_estimate_id uuid default null,p_job_id uuid default null)
returns table(allowed boolean,reason text,reservation_id uuid,usage_date date,daily_limit integer,emails_used integer,account_daily_limit integer,account_monthly_limit integer,account_daily_used integer,account_monthly_used integer)
language plpgsql security definer set search_path='' as $$
declare v_today date:=(now() at time zone 'UTC')::date; v_pool text; v_limit integer; v_used integer; v_id uuid; v_row record;
begin
 if p_source in ('auth','billing') then
  if p_estimate_id is not null or p_job_id is not null then raise exception 'INVALID_APP_EMAIL_RESERVATION'; end if;
  v_pool:=p_source;v_limit:=case when p_source='auth' then 20 else 5 end;
 elsif p_source in ('estimate','follow_up','support','proposal_question','account_retention','invoice') then
  v_pool:='app';v_limit:=75;
 else raise exception using errcode='22023',message='INVALID_APP_EMAIL_SOURCE'; end if;
 -- Match historical app counter so switching implementations never resets today's usage.
 if v_pool='app' then
  insert into public.provider_email_daily_usage(usage_date,source,emails_started)
  select v_today,'app',u.emails_started from public.tradeflow_app_email_daily_usage u where u.usage_date=v_today
  on conflict do nothing;
 end if;
 insert into public.provider_email_daily_usage as u(usage_date,source,emails_started) values(v_today,v_pool,1)
 on conflict on constraint provider_email_daily_usage_pkey do update set emails_started=u.emails_started+1 where u.emails_started<v_limit
 returning emails_started into v_used;
 if not found then return query select false,'platform_daily_limit'::text,null::uuid,v_today,v_limit,v_limit,null::integer,null::integer,null::integer,null::integer;return; end if;
 if v_pool='app' then
  select * into v_row from public.workcraft_reserve_customer_email_internal(p_source,p_user_id,p_estimate_id,p_job_id);
  if not v_row.allowed then update public.provider_email_daily_usage u set emails_started=greatest(u.emails_started-1,0) where u.usage_date=v_today and u.source=v_pool; end if;
  return query select v_row.allowed,v_row.reason,v_row.reservation_id,v_row.usage_date,least(v_row.daily_limit,v_limit),v_used,v_row.account_daily_limit,v_row.account_monthly_limit,v_row.account_daily_used,v_row.account_monthly_used;
 else
  insert into public.tradeflow_app_email_reservations(usage_date,source,user_id) values(v_today,p_source,p_user_id) returning id into v_id;
  return query select true,'allowed'::text,v_id,v_today,v_limit,v_used,null::integer,null::integer,null::integer,null::integer;
 end if;
end; $$;
revoke all on function public.workcraft_reserve_app_email(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.workcraft_reserve_app_email(text,uuid,uuid,uuid) to service_role;
create or replace function public.workcraft_reserve_estimate_email(p_user_id uuid,p_estimate_id uuid)
returns table(allowed boolean,reason text,reservation_id uuid,usage_date date,daily_limit integer,emails_used integer,account_daily_limit integer,account_monthly_limit integer,account_daily_used integer,account_monthly_used integer)
language sql security definer set search_path='' as $$ select * from public.workcraft_reserve_app_email('estimate',p_user_id,p_estimate_id,null) $$;

alter function public.workcraft_release_app_email(uuid) rename to workcraft_release_customer_email_internal;
create function public.workcraft_release_app_email(p_reservation_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare v_row public.tradeflow_app_email_reservations%rowtype; v_pool text;
begin
 select * into v_row from public.tradeflow_app_email_reservations where id=p_reservation_id for update;
 if not found or v_row.released_at is not null then return false; end if;
 v_pool:=case when v_row.source in ('auth','billing') then v_row.source else 'app' end;
 if v_pool='app' then perform public.workcraft_release_customer_email_internal(p_reservation_id);
 else update public.tradeflow_app_email_reservations set released_at=now() where id=p_reservation_id; end if;
 update public.provider_email_daily_usage set emails_started=greatest(0,emails_started-1) where usage_date=v_row.usage_date and source=v_pool;
 return true;
end; $$;
revoke all on function public.workcraft_release_app_email(uuid) from public,anon,authenticated;
grant execute on function public.workcraft_release_app_email(uuid) to service_role;

-- Cron only claims a bounded amount of work and carries proposal language.
drop function public.workcraft_claim_estimate_followups(integer);
create function public.workcraft_claim_estimate_followups(p_limit integer default 10)
returns table(id uuid,user_id uuid,client_name text,client_email text,proposal_language text,reference_number text)
language sql security definer set search_path='' as $$
 with due as (select e.id from public.estimates e where lower(coalesce(e.status,''))='pending'
 and e.followup_at<=now() and e.followup_sent_at is null
 and (e.followup_claimed_at is null or e.followup_claimed_at<now()-interval '30 minutes')
 and public.workcraft_user_has_pro(e.user_id) order by e.followup_at for update skip locked limit greatest(1,least(p_limit,10)))
 update public.estimates e set followup_claimed_at=now() from due where e.id=due.id
 returning e.id,e.user_id,e.client_name,e.client_email,e.proposal_language,e.reference_number;
$$;
revoke all on function public.workcraft_claim_estimate_followups(integer) from public,anon,authenticated;
grant execute on function public.workcraft_claim_estimate_followups(integer) to service_role;
update public.tradeflow_app_settings set app_email_daily_limit=least(app_email_daily_limit,75) where singleton=true;
create or replace function public.update_workcraft_email_daily_limit(
  p_limit integer,
  p_actor_user_id uuid,
  p_actor_email text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_limit integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 75 then
    raise exception using errcode = '22023', message = 'APP_EMAIL_LIMIT_MUST_BE_BETWEEN_1_AND_75';
  end if;
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 8 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_APP_EMAIL_LIMIT_REASON';
  end if;
  if not exists (select 1 from public.tradeflow_admins a where a.user_id = p_actor_user_id and a.role = 'super_admin') then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_REQUIRED';
  end if;

  select app_email_daily_limit into v_previous_limit
  from public.tradeflow_app_settings where singleton = true for update;
  update public.tradeflow_app_settings
  set app_email_daily_limit = p_limit, updated_at = pg_catalog.now(), updated_by = p_actor_user_id
  where singleton = true;
  insert into public.tradeflow_admin_audit_log(actor_user_id, actor_email, action, reason, details, outcome)
  values (p_actor_user_id, p_actor_email, 'app_email_daily_limit_updated', pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object('previous_limit', v_previous_limit, 'new_limit', p_limit), 'succeeded');
  return p_limit;
end;
$$;
revoke all on function public.update_workcraft_email_daily_limit(integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_workcraft_email_daily_limit(integer, uuid, text, text) to service_role;

commit;
