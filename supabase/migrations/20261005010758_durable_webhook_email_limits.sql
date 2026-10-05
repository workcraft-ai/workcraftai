-- One-time webhook processing leases let Stripe safely retry failed events while
-- suppressing duplicate deliveries handled concurrently.
create table if not exists public.stripe_webhook_events (
  event_id text primary key check (length(event_id) between 8 and 255),
  event_type text not null check (length(event_type) between 3 and 160),
  status text not null check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  processing_started_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from public, anon, authenticated;
grant all on public.stripe_webhook_events to service_role;

create or replace function public.workcraft_claim_stripe_webhook(p_event_id text, p_event_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  insert into public.stripe_webhook_events(event_id, event_type, status)
  values (p_event_id, p_event_type, 'processing')
  on conflict (event_id) do update set
    event_type = excluded.event_type,
    status = 'processing', attempts = public.stripe_webhook_events.attempts + 1,
    processing_started_at = pg_catalog.now(), last_error = null
  where public.stripe_webhook_events.status <> 'processed'
    and (public.stripe_webhook_events.status <> 'processing'
      or public.stripe_webhook_events.processing_started_at < pg_catalog.now() - interval '5 minutes');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.workcraft_claim_stripe_webhook(text, text) from public, anon, authenticated;
grant execute on function public.workcraft_claim_stripe_webhook(text, text) to service_role;

create or replace function public.workcraft_complete_stripe_webhook(p_event_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stripe_webhook_events
  set status = 'processed', processed_at = pg_catalog.now(), last_error = null
  where event_id = p_event_id and status = 'processing'
$$;
revoke all on function public.workcraft_complete_stripe_webhook(text) from public, anon, authenticated;
grant execute on function public.workcraft_complete_stripe_webhook(text) to service_role;

create or replace function public.workcraft_fail_stripe_webhook(p_event_id text, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stripe_webhook_events
  set status = 'failed', last_error = pg_catalog.left(coalesce(p_error, 'processing failed'), 500)
  where event_id = p_event_id and status = 'processing'
$$;
revoke all on function public.workcraft_fail_stripe_webhook(text, text) from public, anon, authenticated;
grant execute on function public.workcraft_fail_stripe_webhook(text, text) to service_role;

alter table public.estimates add column if not exists followup_claimed_at timestamptz;

create table if not exists public.estimate_email_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  email_count integer not null default 0 check (email_count between 0 and 50),
  primary key (user_id, usage_date)
);
alter table public.estimate_email_daily_usage enable row level security;
revoke all on public.estimate_email_daily_usage from public, anon, authenticated;
grant all on public.estimate_email_daily_usage to service_role;

alter table public.tradeflow_app_settings
  add column if not exists ai_global_daily_generation_limit integer not null default 250
  check (ai_global_daily_generation_limit between 1 and 5000);
create table if not exists public.tradeflow_ai_global_daily_usage (
  usage_date date primary key,
  attempts_started integer not null default 0 check (attempts_started >= 0)
);
alter table public.tradeflow_ai_global_daily_usage enable row level security;
revoke all on public.tradeflow_ai_global_daily_usage from public, anon, authenticated;
grant all on public.tradeflow_ai_global_daily_usage to service_role;

-- Add an atomic platform-wide daily ceiling on top of the existing per-Pro-user
-- allowance. If a user's own allowance is exhausted, release the global slot.
create or replace function public.reserve_workcraft_ai_generation(
  p_user_id uuid,
  p_prompt_characters integer,
  p_model text
)
returns table (allowed boolean, reason text, generation_id uuid, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  ai_enabled boolean;
  daily_limit integer;
  global_daily_limit integer;
  today_utc date := (pg_catalog.now() at time zone 'UTC')::date;
  used_count integer;
  global_used integer;
  plan_status text;
  new_generation_id uuid;
begin
  if p_user_id is null or p_prompt_characters is null or p_prompt_characters < 1 or p_prompt_characters > 6000
    or p_model is null or pg_catalog.length(p_model) < 1 or pg_catalog.length(p_model) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_AI_GENERATION_RESERVATION';
  end if;

  select settings.ai_drafting_enabled, settings.ai_daily_generation_limit, settings.ai_global_daily_generation_limit
  into ai_enabled, daily_limit, global_daily_limit
  from public.tradeflow_app_settings settings where settings.singleton = true;
  if daily_limit is null or global_daily_limit is null then
    raise exception using errcode = '55000', message = 'AI_GENERATION_SETTINGS_NOT_CONFIGURED';
  end if;
  if not ai_enabled then return query select false, 'paused'::text, null::uuid, 0; return; end if;

  select s.status into plan_status from public.subscriptions s where s.user_id = p_user_id;
  if plan_status is null or plan_status not in ('active', 'trialing') then
    return query select false, 'pro_required'::text, null::uuid, 0; return;
  end if;

  delete from public.tradeflow_ai_generation_events where created_at < pg_catalog.now() - interval '90 days';
  delete from public.tradeflow_ai_daily_usage where usage_date < today_utc - 90;
  delete from public.tradeflow_ai_global_daily_usage where usage_date < today_utc - 90;

  insert into public.tradeflow_ai_global_daily_usage as global_usage(usage_date, attempts_started)
  values (today_utc, 1)
  on conflict (usage_date) do update set attempts_started = global_usage.attempts_started + 1
  where global_usage.attempts_started < global_daily_limit
  returning attempts_started into global_used;
  if not found then return query select false, 'global_daily_limit'::text, null::uuid, 0; return; end if;

  insert into public.tradeflow_ai_daily_usage as usage (user_id, usage_date, attempts_started)
  values (p_user_id, today_utc, 1)
  on conflict (user_id, usage_date) do update set attempts_started = usage.attempts_started + 1
  where usage.attempts_started < daily_limit
  returning attempts_started into used_count;
  if not found then
    update public.tradeflow_ai_global_daily_usage
    set attempts_started = greatest(0, attempts_started - 1) where usage_date = today_utc;
    return query select false, 'daily_limit'::text, null::uuid, 0; return;
  end if;

  insert into public.tradeflow_ai_generation_events(user_id, usage_date, prompt_characters, model)
  values (p_user_id, today_utc, p_prompt_characters, p_model) returning id into new_generation_id;
  return query select true, 'allowed'::text, new_generation_id, greatest(daily_limit - used_count, 0);
end;
$$;
revoke all on function public.reserve_workcraft_ai_generation(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_workcraft_ai_generation(uuid, integer, text) to service_role;

drop function if exists public.update_workcraft_ai_generation_settings(boolean, integer, uuid, text, text);
create or replace function public.update_workcraft_ai_generation_settings(
  p_enabled boolean,
  p_daily_limit integer,
  p_global_daily_limit integer,
  p_actor_user_id uuid,
  p_actor_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_enabled boolean;
  previous_limit integer;
  previous_global_limit integer;
begin
  if p_enabled is null or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 1000
    or p_global_daily_limit is null or p_global_daily_limit < 1 or p_global_daily_limit > 5000 then
    raise exception using errcode = '22023', message = 'AI_LIMIT_OUT_OF_RANGE';
  end if;
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) < 8 or pg_catalog.length(pg_catalog.btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_AUDIT_REASON';
  end if;
  if not exists (select 1 from public.tradeflow_admins a where a.user_id = p_actor_user_id and a.role = 'super_admin') then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_REQUIRED';
  end if;

  select ai_drafting_enabled, ai_daily_generation_limit, ai_global_daily_generation_limit
  into previous_enabled, previous_limit, previous_global_limit
  from public.tradeflow_app_settings where singleton = true for update;

  update public.tradeflow_app_settings set
    ai_drafting_enabled = p_enabled,
    ai_daily_generation_limit = p_daily_limit,
    ai_global_daily_generation_limit = p_global_daily_limit,
    updated_at = pg_catalog.now(), updated_by = p_actor_user_id
  where singleton = true;

  insert into public.tradeflow_admin_audit_log(actor_user_id, actor_email, action, reason, details, outcome)
  values (p_actor_user_id, p_actor_email, 'ai_generation_settings_updated', pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object(
      'previous_enabled', previous_enabled, 'enabled', p_enabled,
      'previous_daily_limit', previous_limit, 'daily_limit', p_daily_limit,
      'previous_global_daily_limit', previous_global_limit, 'global_daily_limit', p_global_daily_limit
    ), 'succeeded');

  return pg_catalog.jsonb_build_object('enabled', p_enabled, 'daily_limit', p_daily_limit, 'global_daily_limit', p_global_daily_limit);
end;
$$;
revoke all on function public.update_workcraft_ai_generation_settings(boolean, integer, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_workcraft_ai_generation_settings(boolean, integer, integer, uuid, text, text) to service_role;

create or replace function public.workcraft_reserve_estimate_email(p_user_id uuid, p_estimate_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if p_user_id is null or p_estimate_id is null then raise exception using errcode = '22023', message = 'Invalid estimate email reservation.'; end if;
  if not exists (
    select 1 from public.estimates e
    join public.subscriptions s on s.user_id = e.user_id
    where e.id = p_estimate_id and e.user_id = p_user_id and s.status in ('active', 'trialing')
  ) then raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED'; end if;

  insert into public.estimate_email_daily_usage(user_id, usage_date, email_count)
  values (p_user_id, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_date) do update set email_count = estimate_email_daily_usage.email_count + 1
  where estimate_email_daily_usage.email_count < 50;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DAILY_LIMIT'; end if;
  return true;
end;
$$;
revoke all on function public.workcraft_reserve_estimate_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_estimate_email(uuid, uuid) to service_role;

create or replace function public.workcraft_release_estimate_email(p_user_id uuid, p_usage_date date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.estimate_email_daily_usage set email_count = greatest(0, email_count - 1)
  where user_id = p_user_id and usage_date = p_usage_date
$$;
revoke all on function public.workcraft_release_estimate_email(uuid, date) from public, anon, authenticated;
grant execute on function public.workcraft_release_estimate_email(uuid, date) to service_role;

-- Concurrent customer submissions serialize before rate checks and insert.
create or replace function public.workcraft_submit_proposal_question(
  p_estimate_id uuid, p_customer_name text, p_customer_email text, p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_question_id uuid;
  v_hour_ago timestamptz := pg_catalog.now() - interval '1 hour';
  v_day_ago timestamptz := pg_catalog.now() - interval '24 hours';
begin
  if pg_catalog.length(pg_catalog.btrim(p_customer_name)) not between 2 and 160
    or pg_catalog.length(pg_catalog.btrim(p_customer_email)) not between 3 and 320
    or p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or pg_catalog.length(pg_catalog.btrim(p_message)) not between 5 and 2000 then
    raise exception using errcode = '22023', message = 'INVALID_PROPOSAL_QUESTION';
  end if;
  select e.user_id into v_user_id from public.estimates e where e.id = p_estimate_id;
  if not found then raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_estimate_id::text, 0));
  if (select count(*) from public.proposal_questions q where q.estimate_id = p_estimate_id::text and q.created_at >= v_hour_ago) >= 10 then
    raise exception using errcode = 'P0001', message = 'PROPOSAL_QUESTION_LIMIT';
  end if;
  if (select count(*) from public.proposal_questions q where q.estimate_id = p_estimate_id::text and lower(q.customer_email) = lower(p_customer_email) and q.created_at >= v_hour_ago) >= 3 then
    raise exception using errcode = 'P0001', message = 'CUSTOMER_QUESTION_LIMIT';
  end if;
  if (select count(*) from public.proposal_questions q where q.user_id = v_user_id and q.created_at >= v_day_ago) >= 100 then
    raise exception using errcode = 'P0001', message = 'CONTRACTOR_QUESTION_LIMIT';
  end if;

  insert into public.proposal_questions(estimate_id, user_id, customer_name, customer_email, message)
  values (p_estimate_id::text, v_user_id, pg_catalog.btrim(p_customer_name), pg_catalog.lower(pg_catalog.btrim(p_customer_email)), pg_catalog.btrim(p_message))
  returning id into v_question_id;
  return v_question_id;
end;
$$;
revoke all on function public.workcraft_submit_proposal_question(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.workcraft_submit_proposal_question(uuid, text, text, text) to service_role;

-- Claim scheduled follow-up emails in one transaction so overlapping cron runs
-- cannot send the same message twice.
create or replace function public.workcraft_claim_estimate_followups(p_limit integer default 100)
returns table(id uuid, user_id uuid, client_name text, client_email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with due as (
    select e.id from public.estimates e
    where lower(coalesce(e.status, '')) = 'pending'
      and e.followup_at <= pg_catalog.now()
      and e.followup_sent_at is null
      and (e.followup_claimed_at is null or e.followup_claimed_at < pg_catalog.now() - interval '30 minutes')
      and exists (select 1 from public.subscriptions s where s.user_id = e.user_id and s.status in ('active', 'trialing'))
    order by e.followup_at
    for update of e skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.estimates e set followup_claimed_at = pg_catalog.now()
  from due d where e.id = d.id
  returning e.id, e.user_id, e.client_name, e.client_email;
end;
$$;
revoke all on function public.workcraft_claim_estimate_followups(integer) from public, anon, authenticated;
grant execute on function public.workcraft_claim_estimate_followups(integer) to service_role;

create or replace function public.workcraft_finish_estimate_followup(p_estimate_id uuid, p_sent boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.estimates set
    followup_sent_at = case when p_sent then pg_catalog.now() else followup_sent_at end,
    followup_claimed_at = null
  where id = p_estimate_id and followup_claimed_at is not null
$$;
revoke all on function public.workcraft_finish_estimate_followup(uuid, boolean) from public, anon, authenticated;
grant execute on function public.workcraft_finish_estimate_followup(uuid, boolean) to service_role;

-- Cap private Pro media storage per account, and validate object path, ownership,
-- file type, and byte totals in the Storage INSERT policy.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.workcraft_can_upload_estimate_media(
  p_path text, p_size bigint, p_mime_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate_id uuid;
  v_existing_count bigint;
  v_existing_bytes bigint;
begin
  if v_user_id is null or p_size is null or p_size < 1 or p_size > 15728640
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav')
    or p_path !~ ('^' || v_user_id::text || '/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,220}$') then
    return false;
  end if;
  begin
    v_estimate_id := pg_catalog.split_part(p_path, '/', 2)::uuid;
  exception when others then
    return false;
  end;
  if not exists (
    select 1 from public.estimates e
    where e.id = v_estimate_id and e.user_id = v_user_id
  ) or not public.workcraft_user_has_pro(v_user_id) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':estimate-media', 0));
  select count(*), coalesce(sum(case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end), 0)
  into v_existing_count, v_existing_bytes
  from storage.objects o
  where o.bucket_id = 'estimate-media' and o.name like v_user_id::text || '/%';

  return v_existing_count < 100 and v_existing_bytes + p_size <= 536870912;
end;
$$;
revoke all on function private.workcraft_can_upload_estimate_media(text, bigint, text) from public, anon;
grant execute on function private.workcraft_can_upload_estimate_media(text, bigint, text) to authenticated;

drop policy if exists "Pro users upload their own estimate media" on storage.objects;
create policy "Pro users upload their own estimate media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'estimate-media'
  and private.workcraft_can_upload_estimate_media(
    name,
    case when (metadata ->> 'size') ~ '^[0-9]+$' then (metadata ->> 'size')::bigint else 0 end,
    lower(coalesce(metadata ->> 'mimetype', ''))
  )
);

-- Keep schedule handoff totals identical to the accepted proposal and cent-based
-- estimate math, including quantity rounding and separate markup/tax rounding.
create or replace function public.convert_accepted_estimate_to_job(
  p_estimate_id text,
  p_scheduled_at timestamptz default null,
  p_title text default null,
  p_notes text default ''
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
  v_subtotal_cents numeric;
  v_markup_cents numeric;
  v_tax_cents numeric;
  v_total_cents numeric;
  v_job_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  select e.* into v_estimate from public.estimates e
  where e.id::text = p_estimate_id and e.user_id = v_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'APPROVED_ESTIMATE_NOT_FOUND'; end if;
  if pg_catalog.lower(coalesce(v_estimate.status, '')) <> 'accepted' then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_APPROVED';
  end if;
  if v_estimate.converted_job_id is not null then return v_estimate.converted_job_id::uuid; end if;
  if pg_catalog.length(coalesce(p_title, '')) > 200 or pg_catalog.length(coalesce(p_notes, '')) > 5000 then
    raise exception using errcode = '22023', message = 'JOB_DETAILS_TOO_LONG';
  end if;

  if v_estimate.selected_package is not null then
    select pg_catalog.round(nullif(option.value ->> 'total', '')::numeric * 100) into v_subtotal_cents
    from pg_catalog.jsonb_array_elements(coalesce(v_estimate.package_options, '[]'::jsonb)) as option(value)
    where option.value ->> 'name' = v_estimate.selected_package limit 1;
    if v_subtotal_cents is null then raise exception using errcode = '22023', message = 'ACCEPTED_PACKAGE_NOT_FOUND'; end if;
    v_markup_cents := 0;
  else
    select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)), 0) into v_subtotal_cents
    from public.line_items li where li.estimate_id = v_estimate.id;
    v_markup_cents := pg_catalog.round(v_subtotal_cents * coalesce(v_estimate.markup_percentage, 0) / 100);
  end if;
  v_tax_cents := pg_catalog.round((v_subtotal_cents + v_markup_cents) * coalesce(v_estimate.tax_rate, 0) / 100);
  v_total_cents := v_subtotal_cents + v_markup_cents + v_tax_cents;

  insert into public.jobs(
    user_id, estimate_id, title, client_name, client_email, job_address,
    scheduled_at, notes, quoted_total, status
  ) values (
    v_user_id, v_estimate.id::text,
    coalesce(nullif(pg_catalog.btrim(p_title), ''), coalesce(nullif(v_estimate.client_name, ''), 'Customer') || ' job'),
    v_estimate.client_name, v_estimate.client_email, coalesce(v_estimate.job_address, ''),
    p_scheduled_at, coalesce(p_notes, ''), v_total_cents / 100, 'scheduled'
  ) returning id into v_job_id;

  update public.estimates set converted_job_id = v_job_id::text where id = v_estimate.id and user_id = v_user_id;
  return v_job_id;
end;
$$;
revoke all on function public.convert_accepted_estimate_to_job(text, timestamptz, text, text) from public, anon;
grant execute on function public.convert_accepted_estimate_to_job(text, timestamptz, text, text) to authenticated;

-- Safe liveness probe: proves PostgREST can execute a database RPC without
-- exposing application records or requiring a privileged key.
create or replace function public.workcraft_health_check()
returns boolean
language sql
immutable
set search_path = ''
as $$
  select true
$$;
revoke all on function public.workcraft_health_check() from public;
grant execute on function public.workcraft_health_check() to anon, authenticated, service_role;
