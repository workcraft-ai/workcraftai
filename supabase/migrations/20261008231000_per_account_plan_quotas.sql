begin;

-- Product allowances are per account and use UTC calendar periods. Existing
-- records are backfilled into counters; no estimate, message, or media is
-- deleted or rewritten by this migration.
alter table public.tradeflow_app_settings
  add column if not exists free_monthly_estimate_limit integer not null default 50
    check (free_monthly_estimate_limit between 0 and 5000),
  add column if not exists pro_daily_estimate_limit integer not null default 50
    check (pro_daily_estimate_limit between 1 and 5000),
  add column if not exists pro_monthly_estimate_limit integer not null default 500
    check (pro_monthly_estimate_limit between 1 and 50000),
  add column if not exists ai_monthly_generation_limit integer not null default 50
    check (ai_monthly_generation_limit between 1 and 5000);

-- The approved starting allowance for Pro cloud drafts is five per UTC day.
-- Gemini remains on the configured provider tier and its existing data policy.
update public.tradeflow_app_settings
set ai_daily_generation_limit = 5
where singleton = true;

-- Keep administrator-editable ceilings inside the customer-facing plan.
update public.tradeflow_app_settings
set free_daily_estimate_limit = least(free_daily_estimate_limit, 10),
    ai_daily_generation_limit = least(ai_daily_generation_limit, 5)
where singleton = true;
alter table public.tradeflow_app_settings
  drop constraint if exists tradeflow_app_settings_free_daily_estimate_limit_check,
  drop constraint if exists tradeflow_app_settings_ai_daily_generation_limit_check;
alter table public.tradeflow_app_settings
  add constraint tradeflow_app_settings_free_daily_estimate_limit_check check (free_daily_estimate_limit between 0 and 10),
  add constraint tradeflow_app_settings_ai_daily_generation_limit_check check (ai_daily_generation_limit between 1 and 5);

create or replace function public.update_free_daily_estimate_limit(
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
declare previous_limit integer;
begin
  if p_limit is null or p_limit < 0 or p_limit > 10 then
    raise exception using errcode = '22023', message = 'Limit must be an integer from 0 to 10.';
  end if;
  if p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) < 8 or pg_catalog.length(pg_catalog.btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = 'Provide a reason between 8 and 500 characters.';
  end if;
  if not exists (select 1 from public.tradeflow_admins a where a.user_id = p_actor_user_id and a.role = 'super_admin') then
    raise exception using errcode = '42501', message = 'Super administrator access is required.';
  end if;
  select free_daily_estimate_limit into previous_limit
  from public.tradeflow_app_settings where singleton = true for update;
  update public.tradeflow_app_settings set free_daily_estimate_limit = p_limit, updated_at = pg_catalog.now(), updated_by = p_actor_user_id where singleton = true;
  insert into public.tradeflow_admin_audit_log(actor_user_id, actor_email, action, reason, details, outcome)
  values (p_actor_user_id, p_actor_email, 'free_estimate_limit_updated', pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object('previous_limit', previous_limit, 'new_limit', p_limit), 'succeeded');
  return p_limit;
end;
$$;
revoke all on function public.update_free_daily_estimate_limit(integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_free_daily_estimate_limit(integer, uuid, text, text) to service_role;

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
declare previous_enabled boolean; previous_limit integer; previous_global_limit integer;
begin
  if p_enabled is null or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 5
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
  update public.tradeflow_app_settings set ai_drafting_enabled = p_enabled, ai_daily_generation_limit = p_daily_limit,
    ai_global_daily_generation_limit = p_global_daily_limit, updated_at = pg_catalog.now(), updated_by = p_actor_user_id
  where singleton = true;
  insert into public.tradeflow_admin_audit_log(actor_user_id, actor_email, action, reason, details, outcome)
  values (p_actor_user_id, p_actor_email, 'ai_generation_settings_updated', pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object('previous_enabled', previous_enabled, 'enabled', p_enabled,
      'previous_daily_limit', previous_limit, 'daily_limit', p_daily_limit,
      'previous_global_daily_limit', previous_global_limit, 'global_daily_limit', p_global_daily_limit), 'succeeded');
  return pg_catalog.jsonb_build_object('enabled', p_enabled, 'daily_limit', p_daily_limit, 'global_daily_limit', p_global_daily_limit);
end;
$$;
revoke all on function public.update_workcraft_ai_generation_settings(boolean, integer, integer, uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_workcraft_ai_generation_settings(boolean, integer, integer, uuid, text, text) to service_role;

create table if not exists public.tradeflow_monthly_estimate_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  estimates_created integer not null default 0 check (estimates_created >= 0),
  primary key (user_id, usage_month)
);
alter table public.tradeflow_daily_estimate_usage
  drop constraint if exists tradeflow_daily_estimate_usage_estimates_created_check;
alter table public.tradeflow_daily_estimate_usage
  add constraint tradeflow_daily_estimate_usage_estimates_created_check check (estimates_created >= 0);
alter table public.tradeflow_monthly_estimate_usage enable row level security;
revoke all on public.tradeflow_monthly_estimate_usage from public, anon, authenticated;
grant all on public.tradeflow_monthly_estimate_usage to service_role;

-- Backfill counts from actual estimate creation dates. The table lock closes the
-- gap between the backfill and the new trigger taking over quota enforcement.
lock table public.estimates in share row exclusive mode;
insert into public.tradeflow_daily_estimate_usage(user_id, usage_date, estimates_created)
select e.user_id, (pg_catalog.now() at time zone 'UTC')::date, pg_catalog.count(*)::integer
from public.estimates e
where e.user_id is not null
  and e.created_at >= ((pg_catalog.now() at time zone 'UTC')::date::timestamp at time zone 'UTC')
group by e.user_id
on conflict (user_id, usage_date) do update
set estimates_created = greatest(public.tradeflow_daily_estimate_usage.estimates_created, excluded.estimates_created);

insert into public.tradeflow_monthly_estimate_usage(user_id, usage_month, estimates_created)
select e.user_id, pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date, pg_catalog.count(*)::integer
from public.estimates e
where e.user_id is not null
  and e.created_at >= (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') at time zone 'UTC')
group by e.user_id
on conflict (user_id, usage_month) do update
set estimates_created = greatest(public.tradeflow_monthly_estimate_usage.estimates_created, excluded.estimates_created);

create or replace function public.enforce_free_daily_estimate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_pro boolean;
  v_daily_limit integer;
  v_monthly_limit integer;
  v_daily_used integer;
  v_monthly_used integer;
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
begin
  if new.user_id is null then return new; end if;

  delete from public.tradeflow_daily_estimate_usage where usage_date < v_today - 90;
  delete from public.tradeflow_monthly_estimate_usage where usage_month < v_month - interval '3 months';

  v_is_pro := public.workcraft_user_has_pro(new.user_id);
  select
    case when v_is_pro then settings.pro_daily_estimate_limit else settings.free_daily_estimate_limit end,
    case when v_is_pro then settings.pro_monthly_estimate_limit else settings.free_monthly_estimate_limit end
  into v_daily_limit, v_monthly_limit
  from public.tradeflow_app_settings settings
  where settings.singleton = true
  for share;
  if v_daily_limit is null or v_monthly_limit is null then
    raise exception using errcode = '55000', message = 'ESTIMATE_QUOTA_SETTINGS_NOT_CONFIGURED';
  end if;

  insert into public.tradeflow_daily_estimate_usage as usage(user_id, usage_date, estimates_created)
  values (new.user_id, v_today, 1)
  on conflict (user_id, usage_date) do update
    set estimates_created = usage.estimates_created + 1
    where usage.estimates_created < v_daily_limit
  returning estimates_created into v_daily_used;
  if not found then
    raise exception using errcode = 'P0001', message = case when v_is_pro then 'PRO_DAILY_ESTIMATE_LIMIT' else 'FREE_DAILY_ESTIMATE_LIMIT' end;
  end if;

  insert into public.tradeflow_monthly_estimate_usage as usage(user_id, usage_month, estimates_created)
  values (new.user_id, v_month, 1)
  on conflict (user_id, usage_month) do update
    set estimates_created = usage.estimates_created + 1
    where usage.estimates_created < v_monthly_limit
  returning estimates_created into v_monthly_used;
  if not found then
    raise exception using errcode = 'P0001', message = case when v_is_pro then 'PRO_MONTHLY_ESTIMATE_LIMIT' else 'FREE_MONTHLY_ESTIMATE_LIMIT' end;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_free_daily_estimate_limit() from public, anon, authenticated;

comment on column public.tradeflow_app_settings.free_monthly_estimate_limit is 'Maximum estimates newly saved by a Free account per UTC calendar month; initially 50.';
comment on column public.tradeflow_app_settings.pro_daily_estimate_limit is 'Maximum estimates newly saved by a Pro account per UTC calendar day; initially 50.';
comment on column public.tradeflow_app_settings.pro_monthly_estimate_limit is 'Maximum estimates newly saved by a Pro account per UTC calendar month; initially 500.';

-- AI attempts are counted when admitted, including provider failures. Token
-- totals are optional provider-reported metadata; prompts and generated text
-- remain excluded from the usage ledger.
alter table public.tradeflow_ai_generation_events
  add column if not exists input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  add column if not exists output_tokens bigint check (output_tokens is null or output_tokens >= 0);
create table if not exists public.tradeflow_ai_monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  attempts_started integer not null default 0 check (attempts_started >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  primary key (user_id, usage_month)
);
alter table public.tradeflow_ai_monthly_usage enable row level security;
revoke all on public.tradeflow_ai_monthly_usage from public, anon, authenticated;
grant all on public.tradeflow_ai_monthly_usage to service_role;
insert into public.tradeflow_ai_monthly_usage(user_id, usage_month, attempts_started)
select e.user_id, pg_catalog.date_trunc('month', e.usage_date::timestamp)::date, pg_catalog.count(*)::integer
from public.tradeflow_ai_generation_events e
where e.usage_date >= (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date - 3 * interval '1 month')::date
group by e.user_id, pg_catalog.date_trunc('month', e.usage_date::timestamp)::date
on conflict (user_id, usage_month) do update
set attempts_started = greatest(public.tradeflow_ai_monthly_usage.attempts_started, excluded.attempts_started);

drop function if exists public.reserve_workcraft_ai_generation(uuid, integer, text);
create function public.reserve_workcraft_ai_generation(
  p_user_id uuid,
  p_prompt_characters integer,
  p_model text
)
returns table (allowed boolean, reason text, generation_id uuid, remaining integer, remaining_monthly integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_daily_limit integer;
  v_monthly_limit integer;
  v_global_limit integer;
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_daily_used integer;
  v_monthly_used integer;
  v_generation_id uuid;
begin
  if p_user_id is null or p_prompt_characters is null or p_prompt_characters < 1 or p_prompt_characters > 6000
    or p_model is null or pg_catalog.length(p_model) < 1 or pg_catalog.length(p_model) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_AI_GENERATION_RESERVATION';
  end if;
  select s.ai_drafting_enabled, s.ai_daily_generation_limit, s.ai_monthly_generation_limit, s.ai_global_daily_generation_limit
  into v_enabled, v_daily_limit, v_monthly_limit, v_global_limit
  from public.tradeflow_app_settings s where s.singleton = true;
  if v_daily_limit is null or v_monthly_limit is null or v_global_limit is null then
    raise exception using errcode = '55000', message = 'AI_GENERATION_SETTINGS_NOT_CONFIGURED';
  end if;
  if not v_enabled then return query select false, 'paused'::text, null::uuid, 0, 0; return; end if;
  if not public.workcraft_user_has_pro(p_user_id) then
    return query select false, 'pro_required'::text, null::uuid, 0, 0; return;
  end if;

  delete from public.tradeflow_ai_generation_events where created_at < pg_catalog.now() - interval '90 days';
  delete from public.tradeflow_ai_daily_usage where usage_date < v_today - 90;
  delete from public.tradeflow_ai_global_daily_usage where usage_date < v_today - 90;
  delete from public.tradeflow_ai_monthly_usage where usage_month < v_month - interval '3 months';

  insert into public.tradeflow_ai_global_daily_usage as global_usage(usage_date, attempts_started)
  values (v_today, 1)
  on conflict (usage_date) do update set attempts_started = global_usage.attempts_started + 1
  where global_usage.attempts_started < v_global_limit;
  if not found then return query select false, 'global_daily_limit'::text, null::uuid, 0, 0; return; end if;

  insert into public.tradeflow_ai_daily_usage as daily_usage(user_id, usage_date, attempts_started)
  values (p_user_id, v_today, 1)
  on conflict (user_id, usage_date) do update set attempts_started = daily_usage.attempts_started + 1
  where daily_usage.attempts_started < v_daily_limit
  returning attempts_started into v_daily_used;
  if not found then
    update public.tradeflow_ai_global_daily_usage set attempts_started = greatest(0, attempts_started - 1) where usage_date = v_today;
    return query select false, 'daily_limit'::text, null::uuid, 0, 0; return;
  end if;

  insert into public.tradeflow_ai_monthly_usage as monthly_usage(user_id, usage_month, attempts_started)
  values (p_user_id, v_month, 1)
  on conflict (user_id, usage_month) do update set attempts_started = monthly_usage.attempts_started + 1
  where monthly_usage.attempts_started < v_monthly_limit
  returning attempts_started into v_monthly_used;
  if not found then
    update public.tradeflow_ai_daily_usage set attempts_started = greatest(0, attempts_started - 1) where user_id = p_user_id and usage_date = v_today;
    update public.tradeflow_ai_global_daily_usage set attempts_started = greatest(0, attempts_started - 1) where usage_date = v_today;
    return query select false, 'monthly_limit'::text, null::uuid, 0, 0; return;
  end if;

  insert into public.tradeflow_ai_generation_events(user_id, usage_date, prompt_characters, model)
  values (p_user_id, v_today, p_prompt_characters, p_model) returning id into v_generation_id;
  return query select true, 'allowed'::text, v_generation_id,
    greatest(v_daily_limit - v_daily_used, 0), greatest(v_monthly_limit - v_monthly_used, 0);
end;
$$;
revoke all on function public.reserve_workcraft_ai_generation(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_workcraft_ai_generation(uuid, integer, text) to service_role;

drop function if exists public.complete_workcraft_ai_generation(uuid, text, integer, integer);
create function public.complete_workcraft_ai_generation(
  p_generation_id uuid,
  p_outcome text,
  p_provider_status integer,
  p_generated_items integer,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_usage_date date;
begin
  if p_outcome not in ('succeeded', 'failed')
    or (p_provider_status is not null and p_provider_status not between 100 and 599)
    or (p_generated_items is not null and p_generated_items not between 0 and 40)
    or (p_input_tokens is not null and p_input_tokens < 0)
    or (p_output_tokens is not null and p_output_tokens < 0) then
    raise exception using errcode = '22023', message = 'INVALID_AI_GENERATION_COMPLETION';
  end if;
  update public.tradeflow_ai_generation_events
  set outcome = p_outcome, completed_at = pg_catalog.now(), provider_status = p_provider_status,
      generated_items = p_generated_items, input_tokens = p_input_tokens, output_tokens = p_output_tokens
  where id = p_generation_id and outcome = 'started'
  returning user_id, usage_date into v_user_id, v_usage_date;
  if not found then return false; end if;

  if p_outcome = 'succeeded' then
    update public.tradeflow_ai_daily_usage set succeeded = succeeded + 1 where user_id = v_user_id and usage_date = v_usage_date;
  else
    update public.tradeflow_ai_daily_usage set failed = failed + 1 where user_id = v_user_id and usage_date = v_usage_date;
  end if;
  update public.tradeflow_ai_monthly_usage
  set input_tokens = input_tokens + coalesce(p_input_tokens, 0),
      output_tokens = output_tokens + coalesce(p_output_tokens, 0)
  where user_id = v_user_id and usage_month = pg_catalog.date_trunc('month', v_usage_date::timestamp)::date;
  return true;
end;
$$;
revoke all on function public.complete_workcraft_ai_generation(uuid, text, integer, integer, bigint, bigint) from public, anon, authenticated;
grant execute on function public.complete_workcraft_ai_generation(uuid, text, integer, integer, bigint, bigint) to service_role;

-- Keep already-running application instances compatible during a rolling
-- deployment; older servers complete attempts without token metadata.
create function public.complete_workcraft_ai_generation(
  p_generation_id uuid,
  p_outcome text,
  p_provider_status integer,
  p_generated_items integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.complete_workcraft_ai_generation(
    p_generation_id, p_outcome, p_provider_status, p_generated_items, null::bigint, null::bigint
  )
$$;
revoke all on function public.complete_workcraft_ai_generation(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.complete_workcraft_ai_generation(uuid, text, integer, integer) to service_role;

comment on column public.tradeflow_app_settings.ai_monthly_generation_limit is 'Maximum cloud estimate drafting attempts per Pro account per UTC calendar month; initially 50.';
comment on table public.tradeflow_ai_monthly_usage is 'Private per-account monthly AI attempt and provider-reported token counters.';

-- Per-account estimate email allowances sit alongside the existing global
-- Resend ceiling. Operational support and retention email count only globally.
create table if not exists public.estimate_email_monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  email_count integer not null default 0 check (email_count >= 0),
  primary key (user_id, usage_month)
);
alter table public.estimate_email_monthly_usage enable row level security;
revoke all on public.estimate_email_monthly_usage from public, anon, authenticated;
grant all on public.estimate_email_monthly_usage to service_role;

-- Preserve today's sent estimate/follow-up mail and customer-question
-- notifications admitted by the existing durable reservation ledger.
with event_counts as (
  select e.user_id, (e.created_at at time zone 'UTC')::date as usage_date, pg_catalog.count(*)::integer as n
  from public.estimate_email_events e
  where e.user_id is not null
    and e.event in ('sent', 'follow_up_sent')
    and e.created_at >= ((pg_catalog.now() at time zone 'UTC')::date::timestamp at time zone 'UTC')
  group by e.user_id, (e.created_at at time zone 'UTC')::date
), reservation_counts as (
  select r.user_id, r.usage_date, pg_catalog.count(*)::integer as n
  from public.tradeflow_app_email_reservations r
  where r.user_id is not null and r.released_at is null
    and r.source in ('estimate', 'follow_up', 'proposal_question')
    and r.usage_date = (pg_catalog.now() at time zone 'UTC')::date
  group by r.user_id, r.usage_date
)
insert into public.estimate_email_daily_usage(user_id, usage_date, email_count)
select coalesce(e.user_id, r.user_id), coalesce(e.usage_date, r.usage_date), greatest(coalesce(e.n, 0), coalesce(r.n, 0))
from event_counts e full join reservation_counts r using (user_id, usage_date)
on conflict (user_id, usage_date) do update
set email_count = greatest(public.estimate_email_daily_usage.email_count, excluded.email_count);

with event_counts as (
  select e.user_id, pg_catalog.date_trunc('month', e.created_at at time zone 'UTC')::date as usage_month, pg_catalog.count(*)::integer as n
  from public.estimate_email_events e
  where e.user_id is not null and e.event in ('sent', 'follow_up_sent')
    and e.created_at >= (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') at time zone 'UTC')
  group by e.user_id, pg_catalog.date_trunc('month', e.created_at at time zone 'UTC')::date
), reservation_counts as (
  select r.user_id, pg_catalog.date_trunc('month', r.usage_date::timestamp)::date as usage_month, pg_catalog.count(*)::integer as n
  from public.tradeflow_app_email_reservations r
  where r.user_id is not null and r.released_at is null
    and r.source in ('estimate', 'follow_up', 'proposal_question')
    and r.usage_date >= pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date
  group by r.user_id, pg_catalog.date_trunc('month', r.usage_date::timestamp)::date
)
insert into public.estimate_email_monthly_usage(user_id, usage_month, email_count)
select coalesce(e.user_id, r.user_id), coalesce(e.usage_month, r.usage_month), greatest(coalesce(e.n, 0), coalesce(r.n, 0))
from event_counts e full join reservation_counts r using (user_id, usage_month)
on conflict (user_id, usage_month) do update
set email_count = greatest(public.estimate_email_monthly_usage.email_count, excluded.email_count);

drop function if exists public.workcraft_reserve_estimate_email(uuid, uuid);
drop function if exists public.workcraft_reserve_app_email(text, uuid, uuid);
create function public.workcraft_reserve_app_email(
  p_source text,
  p_user_id uuid default null,
  p_estimate_id uuid default null
)
returns table (
  allowed boolean, reason text, reservation_id uuid, usage_date date,
  daily_limit integer, emails_used integer,
  account_daily_limit integer, account_monthly_limit integer,
  account_daily_used integer, account_monthly_used integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_platform_limit integer;
  v_platform_used integer;
  v_user_daily_used integer;
  v_user_monthly_used integer;
  v_reservation uuid;
  v_source text := pg_catalog.btrim(coalesce(p_source, ''));
  v_user_limited boolean;
begin
  if v_source not in ('estimate', 'follow_up', 'support', 'proposal_question', 'account_retention') then
    raise exception using errcode = '22023', message = 'INVALID_APP_EMAIL_SOURCE';
  end if;
  v_user_limited := v_source in ('estimate', 'follow_up', 'proposal_question');
  if (v_user_limited and (p_user_id is null or p_estimate_id is null))
    or (not v_user_limited and (p_user_id is not null or p_estimate_id is not null)) then
    raise exception using errcode = '22023', message = 'INVALID_APP_EMAIL_RESERVATION';
  end if;
  if v_user_limited and (
    not exists (select 1 from public.estimates e where e.id = p_estimate_id and e.user_id = p_user_id)
    or not public.workcraft_user_has_pro(p_user_id)
  ) then raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED'; end if;

  select s.app_email_daily_limit into v_platform_limit
  from public.tradeflow_app_settings s where s.singleton = true for share;
  if v_platform_limit is null then raise exception using errcode = '55000', message = 'APP_EMAIL_LIMIT_NOT_CONFIGURED'; end if;

  delete from public.tradeflow_app_email_reservations where created_at < pg_catalog.now() - interval '90 days';
  delete from public.tradeflow_app_email_daily_usage where usage_date < v_today - 90;
  delete from public.estimate_email_daily_usage where usage_date < v_today - 90;
  delete from public.estimate_email_monthly_usage where usage_month < v_month - interval '3 months';

  insert into public.tradeflow_app_email_daily_usage as global_usage(usage_date, emails_started)
  values (v_today, 1)
  on conflict (usage_date) do update set emails_started = global_usage.emails_started + 1
  where global_usage.emails_started < v_platform_limit
  returning emails_started into v_platform_used;
  if not found then
    return query select false, 'platform_daily_limit'::text, null::uuid, v_today, v_platform_limit,
      coalesce((select emails_started from public.tradeflow_app_email_daily_usage where usage_date = v_today), 0),
      case when v_user_limited then 5 else null end, case when v_user_limited then 100 else null end,
      null::integer, null::integer;
    return;
  end if;

  if v_user_limited then
    insert into public.estimate_email_daily_usage as daily_usage(user_id, usage_date, email_count)
    values (p_user_id, v_today, 1)
    on conflict (user_id, usage_date) do update set email_count = daily_usage.email_count + 1
    where daily_usage.email_count < 5
    returning email_count into v_user_daily_used;
    if not found then
      update public.tradeflow_app_email_daily_usage set emails_started = greatest(0, emails_started - 1) where usage_date = v_today;
      return query select false, 'account_daily_limit'::text, null::uuid, v_today, v_platform_limit,
        coalesce((select emails_started from public.tradeflow_app_email_daily_usage where usage_date = v_today), 0),
        5, 100, coalesce((select email_count from public.estimate_email_daily_usage where user_id = p_user_id and usage_date = v_today), 0),
        coalesce((select email_count from public.estimate_email_monthly_usage where user_id = p_user_id and usage_month = v_month), 0);
      return;
    end if;

    insert into public.estimate_email_monthly_usage as monthly_usage(user_id, usage_month, email_count)
    values (p_user_id, v_month, 1)
    on conflict (user_id, usage_month) do update set email_count = monthly_usage.email_count + 1
    where monthly_usage.email_count < 100
    returning email_count into v_user_monthly_used;
    if not found then
      update public.estimate_email_daily_usage set email_count = greatest(0, email_count - 1) where user_id = p_user_id and usage_date = v_today;
      update public.tradeflow_app_email_daily_usage set emails_started = greatest(0, emails_started - 1) where usage_date = v_today;
      return query select false, 'account_monthly_limit'::text, null::uuid, v_today, v_platform_limit,
        coalesce((select emails_started from public.tradeflow_app_email_daily_usage where usage_date = v_today), 0),
        5, 100, coalesce((select email_count from public.estimate_email_daily_usage where user_id = p_user_id and usage_date = v_today), 0),
        coalesce((select email_count from public.estimate_email_monthly_usage where user_id = p_user_id and usage_month = v_month), 0);
      return;
    end if;
  end if;

  insert into public.tradeflow_app_email_reservations(usage_date, source, user_id)
  values (v_today, v_source, p_user_id) returning id into v_reservation;
  return query select true, 'allowed'::text, v_reservation, v_today, v_platform_limit, v_platform_used,
    case when v_user_limited then 5 else null end, case when v_user_limited then 100 else null end,
    v_user_daily_used, v_user_monthly_used;
end;
$$;
revoke all on function public.workcraft_reserve_app_email(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_app_email(text, uuid, uuid) to service_role;

create function public.workcraft_reserve_estimate_email(p_user_id uuid, p_estimate_id uuid)
returns table (
  allowed boolean, reason text, reservation_id uuid, usage_date date,
  daily_limit integer, emails_used integer,
  account_daily_limit integer, account_monthly_limit integer,
  account_daily_used integer, account_monthly_used integer
)
language sql
security definer
set search_path = ''
as $$ select * from public.workcraft_reserve_app_email('estimate', p_user_id, p_estimate_id) $$;
revoke all on function public.workcraft_reserve_estimate_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_estimate_email(uuid, uuid) to service_role;

create or replace function public.workcraft_release_app_email(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_date date; v_source text; v_user_id uuid;
begin
  update public.tradeflow_app_email_reservations
  set released_at = pg_catalog.now()
  where id = p_reservation_id and released_at is null
  returning usage_date, source, user_id into v_date, v_source, v_user_id;
  if not found then return false; end if;
  update public.tradeflow_app_email_daily_usage set emails_started = greatest(0, emails_started - 1) where usage_date = v_date;
  if v_source in ('estimate', 'follow_up', 'proposal_question') and v_user_id is not null then
    update public.estimate_email_daily_usage set email_count = greatest(0, email_count - 1) where user_id = v_user_id and usage_date = v_date;
    update public.estimate_email_monthly_usage set email_count = greatest(0, email_count - 1)
    where user_id = v_user_id and usage_month = pg_catalog.date_trunc('month', v_date::timestamp)::date;
  end if;
  return true;
end;
$$;
revoke all on function public.workcraft_release_app_email(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_release_app_email(uuid) to service_role;

comment on table public.estimate_email_monthly_usage is 'Private UTC-month per-account counters for estimate, follow-up, and proposal-question notifications.';

-- Paid private media has both a cumulative monthly-upload allowance and a
-- retained-storage cap. Upload reservations serialize concurrent browser
-- uploads across Vercel and Storage API instances.
create table if not exists public.tradeflow_media_monthly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  bytes_uploaded bigint not null default 0 check (bytes_uploaded >= 0),
  primary key (user_id, usage_month)
);
create table if not exists public.tradeflow_media_upload_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  storage_path text not null unique,
  bytes bigint not null check (bytes between 1 and 15728640),
  mime_type text not null,
  usage_month date not null,
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists tradeflow_media_upload_reservations_user_month_idx
  on public.tradeflow_media_upload_reservations(user_id, usage_month, status);
alter table public.tradeflow_media_monthly_usage enable row level security;
alter table public.tradeflow_media_upload_reservations enable row level security;
revoke all on public.tradeflow_media_monthly_usage, public.tradeflow_media_upload_reservations from public, anon, authenticated;
grant all on public.tradeflow_media_monthly_usage, public.tradeflow_media_upload_reservations to service_role;

insert into public.tradeflow_media_monthly_usage(user_id, usage_month, bytes_uploaded)
select split_part(o.name, '/', 1)::uuid,
       pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date,
       pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end)
from storage.objects o
where o.bucket_id = 'estimate-media'
  and o.created_at >= (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC') at time zone 'UTC')
  and split_part(o.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
group by split_part(o.name, '/', 1)::uuid
on conflict (user_id, usage_month) do update
set bytes_uploaded = greatest(public.tradeflow_media_monthly_usage.bytes_uploaded, excluded.bytes_uploaded);

create or replace function public.workcraft_reserve_estimate_media_upload(
  p_estimate_id uuid,
  p_storage_path text,
  p_size bigint,
  p_mime_type text
)
returns table (allowed boolean, reason text, reservation_id uuid, monthly_used bigint, retained_used bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_existing_count bigint;
  v_retained bigint;
  v_monthly bigint;
  v_pending bigint;
  v_id uuid;
  v_expired record;
begin
  if v_user is null or p_estimate_id is null or p_size is null or p_size < 1 or p_size > 15728640
    or p_mime_type not in ('image/jpeg','image/png','image/webp','image/heic','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav')
    or p_storage_path !~ ('^' || v_user::text || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9._-]{1,220}$')
    or split_part(p_storage_path, '/', 2) is distinct from p_estimate_id::text then
    return query select false, 'invalid_upload'::text, null::uuid, 0::bigint, 0::bigint; return;
  end if;
  if not exists (select 1 from public.estimates e where e.id = p_estimate_id and e.user_id = v_user)
    or not public.workcraft_user_has_pro(v_user) then
    return query select false, 'pro_required'::text, null::uuid, 0::bigint, 0::bigint; return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':estimate-media', 0));
  delete from public.tradeflow_media_monthly_usage where usage_month < v_month - interval '3 months';
  delete from public.tradeflow_media_upload_reservations where created_at < pg_catalog.now() - interval '90 days';
  -- Resolve abandoned reservations. A successfully uploaded object is charged
  -- even if the browser closed before it could finalize the reservation.
  for v_expired in
    select r.id, r.storage_path, r.bytes, r.usage_month
    from public.tradeflow_media_upload_reservations r
    where r.user_id = v_user and r.status = 'reserved' and r.created_at < pg_catalog.now() - interval '1 hour'
    for update
  loop
    if exists (select 1 from storage.objects o where o.bucket_id = 'estimate-media' and o.name = v_expired.storage_path) then
      insert into public.tradeflow_media_monthly_usage(user_id, usage_month, bytes_uploaded)
      values (v_user, v_expired.usage_month, v_expired.bytes)
      on conflict (user_id, usage_month) do update set bytes_uploaded = public.tradeflow_media_monthly_usage.bytes_uploaded + excluded.bytes_uploaded;
      update public.tradeflow_media_upload_reservations set status = 'consumed', finished_at = pg_catalog.now() where id = v_expired.id;
    else
      update public.tradeflow_media_upload_reservations set status = 'released', finished_at = pg_catalog.now() where id = v_expired.id;
    end if;
  end loop;

  select pg_catalog.count(*), coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end), 0)
  into v_existing_count, v_retained
  from storage.objects o where o.bucket_id = 'estimate-media' and o.name like v_user::text || '/%';
  select coalesce(pg_catalog.sum(r.bytes), 0) into v_pending
  from public.tradeflow_media_upload_reservations r
  where r.user_id = v_user and r.status = 'reserved' and r.usage_month = v_month;
  v_retained := v_retained + coalesce((select pg_catalog.sum(r.bytes) from public.tradeflow_media_upload_reservations r
    where r.user_id = v_user and r.status = 'reserved' and r.usage_month = v_month
      and not exists (select 1 from storage.objects o where o.bucket_id='estimate-media' and o.name=r.storage_path)), 0);
  v_existing_count := v_existing_count + (select pg_catalog.count(*) from public.tradeflow_media_upload_reservations r
    where r.user_id = v_user and r.status = 'reserved' and r.usage_month = v_month
      and not exists (select 1 from storage.objects o where o.bucket_id='estimate-media' and o.name=r.storage_path));
  select coalesce(u.bytes_uploaded, 0) into v_monthly
  from public.tradeflow_media_monthly_usage u where u.user_id = v_user and u.usage_month = v_month;
  v_monthly := coalesce(v_monthly, 0) + coalesce(v_pending, 0);

  if v_monthly + p_size > 104857600 then
    return query select false, 'monthly_limit'::text, null::uuid, v_monthly, v_retained; return;
  end if;
  if v_existing_count >= 100 or v_retained + p_size > 262144000 then
    return query select false, 'storage_limit'::text, null::uuid, v_monthly, v_retained; return;
  end if;

  insert into public.tradeflow_media_upload_reservations(user_id, estimate_id, storage_path, bytes, mime_type, usage_month)
  values (v_user, p_estimate_id, p_storage_path, p_size, p_mime_type, v_month)
  returning id into v_id;
  return query select true, 'allowed'::text, v_id, v_monthly + p_size, v_retained + p_size;
end;
$$;
revoke all on function public.workcraft_reserve_estimate_media_upload(uuid, text, bigint, text) from public, anon;
grant execute on function public.workcraft_reserve_estimate_media_upload(uuid, text, bigint, text) to authenticated;

create or replace function public.workcraft_finish_estimate_media_upload(p_reservation_id uuid, p_uploaded boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.tradeflow_media_upload_reservations%rowtype;
begin
  if v_user is null then return false; end if;
  select * into v_row from public.tradeflow_media_upload_reservations r
  where r.id = p_reservation_id and r.user_id = v_user for update;
  if not found or v_row.status <> 'reserved' then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':estimate-media', 0));
  if p_uploaded and exists (
    select 1 from storage.objects o where o.bucket_id = 'estimate-media' and o.name = v_row.storage_path
      and (case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end) = v_row.bytes
  ) then
    insert into public.tradeflow_media_monthly_usage(user_id, usage_month, bytes_uploaded)
    values (v_user, v_row.usage_month, v_row.bytes)
    on conflict (user_id, usage_month) do update set bytes_uploaded = public.tradeflow_media_monthly_usage.bytes_uploaded + excluded.bytes_uploaded;
    update public.tradeflow_media_upload_reservations set status = 'consumed', finished_at = pg_catalog.now() where id = v_row.id;
    return true;
  end if;
  update public.tradeflow_media_upload_reservations set status = 'released', finished_at = pg_catalog.now() where id = v_row.id;
  return not p_uploaded;
end;
$$;
revoke all on function public.workcraft_finish_estimate_media_upload(uuid, boolean) from public, anon;
grant execute on function public.workcraft_finish_estimate_media_upload(uuid, boolean) to authenticated;

create or replace function private.workcraft_can_upload_estimate_media(p_path text, p_size bigint, p_mime_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_estimate uuid;
  v_count bigint;
  v_bytes bigint;
begin
  if v_user is null or p_size is null or p_size < 1 or p_size > 15728640
    or p_mime_type not in ('image/jpeg','image/png','image/webp','image/heic','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav')
    or p_path !~ ('^' || v_user::text || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9._-]{1,220}$') then return false; end if;
  begin v_estimate := split_part(p_path, '/', 2)::uuid; exception when others then return false; end;
  if not exists (select 1 from public.estimates e where e.id = v_estimate and e.user_id = v_user)
    or not public.workcraft_user_has_pro(v_user)
    or not exists (select 1 from public.tradeflow_media_upload_reservations r
      where r.user_id = v_user and r.estimate_id = v_estimate and r.storage_path = p_path
        and r.bytes = p_size and r.mime_type = p_mime_type and r.status = 'reserved') then return false; end if;
  select pg_catalog.count(*), coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end), 0)
  into v_count, v_bytes from storage.objects o where o.bucket_id = 'estimate-media' and o.name like v_user::text || '/%';
  return v_count < 100 and v_bytes + p_size <= 262144000;
end;
$$;
revoke all on function private.workcraft_can_upload_estimate_media(text, bigint, text) from public, anon;
grant execute on function private.workcraft_can_upload_estimate_media(text, bigint, text) to authenticated;

-- A single service-role-only snapshot powers quota notices in Profile. It
-- exposes only the authenticated account's counters, never provider content.
create or replace function public.workcraft_get_account_usage(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro boolean;
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_settings public.tradeflow_app_settings%rowtype;
  v_est_daily integer;
  v_est_monthly integer;
  v_ai_daily integer;
  v_ai_monthly integer;
  v_email_daily integer;
  v_email_monthly integer;
  v_storage_month bigint;
  v_storage_retained bigint;
  v_media_count bigint;
  v_pending bigint;
begin
  if p_user_id is null then raise exception using errcode = '22023', message = 'INVALID_USAGE_ACCOUNT'; end if;
  v_pro := public.workcraft_user_has_pro(p_user_id);
  select * into v_settings from public.tradeflow_app_settings s where s.singleton=true;
  select coalesce(u.estimates_created, 0) into v_est_daily from public.tradeflow_daily_estimate_usage u where u.user_id=p_user_id and u.usage_date=v_today;
  select coalesce(u.estimates_created, 0) into v_est_monthly from public.tradeflow_monthly_estimate_usage u where u.user_id=p_user_id and u.usage_month=v_month;
  select coalesce(u.attempts_started, 0) into v_ai_daily from public.tradeflow_ai_daily_usage u where u.user_id=p_user_id and u.usage_date=v_today;
  select coalesce(u.attempts_started, 0) into v_ai_monthly from public.tradeflow_ai_monthly_usage u where u.user_id=p_user_id and u.usage_month=v_month;
  select coalesce(u.email_count, 0) into v_email_daily from public.estimate_email_daily_usage u where u.user_id=p_user_id and u.usage_date=v_today;
  select coalesce(u.email_count, 0) into v_email_monthly from public.estimate_email_monthly_usage u where u.user_id=p_user_id and u.usage_month=v_month;
  select pg_catalog.count(*), coalesce(pg_catalog.sum(case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint else 0 end), 0)
  into v_media_count, v_storage_retained
  from storage.objects o where o.bucket_id='estimate-media' and o.name like p_user_id::text || '/%';
  select coalesce(pg_catalog.sum(r.bytes), 0) into v_pending from public.tradeflow_media_upload_reservations r
  where r.user_id=p_user_id and r.status='reserved' and r.usage_month=v_month
    and not exists(select 1 from storage.objects o where o.bucket_id='estimate-media' and o.name=r.storage_path);
  select coalesce(u.bytes_uploaded, 0) into v_storage_month from public.tradeflow_media_monthly_usage u where u.user_id=p_user_id and u.usage_month=v_month;
  v_storage_month := coalesce(v_storage_month, 0) + coalesce(v_pending, 0);
  v_storage_retained := coalesce(v_storage_retained, 0) + coalesce(v_pending, 0);
  v_media_count := coalesce(v_media_count, 0) + (select pg_catalog.count(*) from public.tradeflow_media_upload_reservations r
    where r.user_id=p_user_id and r.status='reserved' and r.usage_month=v_month
      and not exists(select 1 from storage.objects o where o.bucket_id='estimate-media' and o.name=r.storage_path));

  return pg_catalog.jsonb_build_object(
    'plan', case when v_pro then 'pro' else 'free' end,
    'estimates', pg_catalog.jsonb_build_object(
      'daily_used', coalesce(v_est_daily,0), 'daily_limit', case when v_pro then v_settings.pro_daily_estimate_limit else v_settings.free_daily_estimate_limit end,
      'monthly_used', coalesce(v_est_monthly,0), 'monthly_limit', case when v_pro then v_settings.pro_monthly_estimate_limit else v_settings.free_monthly_estimate_limit end),
    'ai', pg_catalog.jsonb_build_object('included', v_pro, 'enabled', v_settings.ai_drafting_enabled,
      'daily_used', coalesce(v_ai_daily,0), 'daily_limit', v_settings.ai_daily_generation_limit,
      'monthly_used', coalesce(v_ai_monthly,0), 'monthly_limit', v_settings.ai_monthly_generation_limit),
    'email', pg_catalog.jsonb_build_object('included', v_pro, 'daily_used', coalesce(v_email_daily,0), 'daily_limit', 5,
      'monthly_used', coalesce(v_email_monthly,0), 'monthly_limit', 100),
    'media', pg_catalog.jsonb_build_object('included', v_pro, 'monthly_used_bytes', v_storage_month,
      'monthly_limit_bytes', case when v_pro then 104857600 else 0 end, 'retained_bytes', v_storage_retained,
      'retained_limit_bytes', 262144000, 'file_count', v_media_count, 'file_limit', 100)
  );
end;
$$;
revoke all on function public.workcraft_get_account_usage(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_get_account_usage(uuid) to service_role;

comment on function public.workcraft_get_account_usage(uuid) is 'Returns the authenticated user's plan-specific UTC quota snapshot; callable only by service_role after app authentication.';

commit;
