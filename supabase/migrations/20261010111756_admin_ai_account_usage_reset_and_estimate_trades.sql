begin;

alter table public.tradeflow_app_settings
  add column estimate_trade_options jsonb not null default '[
    {"value":"Plumbing","label_es":"Plomería"},
    {"value":"Electrical","label_es":"Electricidad"},
    {"value":"Roofing","label_es":"Techado"},
    {"value":"HVAC","label_es":"Climatización"},
    {"value":"Painting","label_es":"Pintura"},
    {"value":"Carpentry","label_es":"Carpintería"},
    {"value":"General contracting","label_es":"Contratación general"},
    {"value":"Other","label_es":"Otro"}
  ]'::jsonb,
  add constraint tradeflow_app_settings_estimate_trade_options_check
    check (
      case
        when pg_catalog.jsonb_typeof(estimate_trade_options) = 'array'
          then pg_catalog.jsonb_array_length(estimate_trade_options) between 1 and 40
        else false
      end
    );

comment on column public.tradeflow_app_settings.estimate_trade_options is
  'Administrator-managed trade choices for estimate creation, stored with English and Spanish labels.';

create or replace function public.update_workcraft_estimate_trade_options(
  p_trade_options jsonb,
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
  v_option jsonb;
  v_value text;
  v_label_es text;
  v_values text[] := array[]::text[];
  v_previous jsonb;
begin
  if p_actor_user_id is null or p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 8 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_TRADE_UPDATE';
  end if;
  if p_trade_options is null or pg_catalog.jsonb_typeof(p_trade_options) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_ESTIMATE_TRADE_OPTIONS';
  end if;
  if pg_catalog.jsonb_array_length(p_trade_options) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'INVALID_ESTIMATE_TRADE_OPTIONS';
  end if;
  if not exists (
    select 1 from public.tradeflow_admins as admins
    where admins.user_id = p_actor_user_id and admins.role = 'super_admin'
  ) then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_REQUIRED';
  end if;

  for v_option in select element from pg_catalog.jsonb_array_elements(p_trade_options) as items(element) loop
    if pg_catalog.jsonb_typeof(v_option) <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_ESTIMATE_TRADE_OPTIONS';
    end if;
    v_value := pg_catalog.btrim(v_option ->> 'value');
    v_label_es := pg_catalog.btrim(v_option ->> 'label_es');
    if v_value is null or pg_catalog.length(v_value) not between 1 and 60
      or v_label_es is null or pg_catalog.length(v_label_es) not between 1 and 60
      or v_value ~ '[[:cntrl:]]' or v_label_es ~ '[[:cntrl:]]'
      or pg_catalog.lower(v_value) = any(v_values) then
      raise exception using errcode = '22023', message = 'INVALID_ESTIMATE_TRADE_OPTIONS';
    end if;
    v_values := pg_catalog.array_append(v_values, pg_catalog.lower(v_value));
  end loop;

  select settings.estimate_trade_options into v_previous
  from public.tradeflow_app_settings as settings
  where settings.singleton = true
  for update;
  if not found then raise exception using errcode = '55000', message = 'APP_SETTINGS_NOT_CONFIGURED'; end if;

  update public.tradeflow_app_settings
  set estimate_trade_options = p_trade_options,
      updated_at = pg_catalog.now(),
      updated_by = p_actor_user_id
  where singleton = true;

  insert into public.tradeflow_admin_audit_log(actor_user_id, actor_email, action, reason, details, outcome)
  values (
    p_actor_user_id,
    p_actor_email,
    'estimate_trade_options_updated',
    pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object('previous_trades', v_previous, 'trades', p_trade_options, 'trade_count', pg_catalog.jsonb_array_length(p_trade_options)),
    'succeeded'
  );
  return pg_catalog.jsonb_build_object('trades', p_trade_options);
end;
$$;
revoke all on function public.update_workcraft_estimate_trade_options(jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_workcraft_estimate_trade_options(jsonb, uuid, text, text) to service_role;

create or replace function public.reset_workcraft_ai_account_usage(
  p_target_user_id uuid,
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
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
  v_daily_before integer := 0;
  v_monthly_before integer := 0;
begin
  if p_target_user_id is null or p_actor_user_id is null
    or p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 8 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_AI_USAGE_RESET';
  end if;
  if not exists (
    select 1 from public.tradeflow_admins as admins
    where admins.user_id = p_actor_user_id and admins.role = 'super_admin'
  ) then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_REQUIRED';
  end if;
  if not exists (select 1 from auth.users as users where users.id = p_target_user_id) then
    raise exception using errcode = 'P0002', message = 'AI_USAGE_ACCOUNT_NOT_FOUND';
  end if;

  -- Lock in the same order as the reservation function so a reset cannot race
  -- an in-flight reservation or leave its completion inconsistent with checks.
  insert into public.tradeflow_ai_daily_usage(user_id, usage_date, attempts_started, succeeded, failed)
  values (p_target_user_id, v_today, 0, 0, 0)
  on conflict (user_id, usage_date) do nothing;
  perform 1 from public.tradeflow_ai_daily_usage as usage
  where usage.user_id = p_target_user_id and usage.usage_date = v_today
  for update;

  insert into public.tradeflow_ai_monthly_usage(user_id, usage_month, attempts_started)
  values (p_target_user_id, v_month, 0)
  on conflict (user_id, usage_month) do nothing;
  perform 1 from public.tradeflow_ai_monthly_usage as usage
  where usage.user_id = p_target_user_id and usage.usage_month = v_month
  for update;

  -- The generator has a 60-second maximum runtime. Ignore orphaned started
  -- records older than that plus a 30-second completion buffer; leave their
  -- event history intact while permitting the administrator to restore quota.
  if exists (
    select 1 from public.tradeflow_ai_generation_events as events
    where events.user_id = p_target_user_id
      and events.usage_date = v_today
      and events.outcome = 'started'
      and events.created_at >= pg_catalog.now() - interval '90 seconds'
  ) or exists (
    select 1 from public.tradeflow_ai_generation_events as events
    where events.user_id = p_target_user_id
      and events.usage_date >= v_month
      and events.outcome = 'started'
      and events.created_at >= pg_catalog.now() - interval '90 seconds'
  ) then
    raise exception using errcode = '55000', message = 'AI_GENERATION_IN_PROGRESS';
  end if;

  select usage.attempts_started into v_daily_before
  from public.tradeflow_ai_daily_usage as usage
  where usage.user_id = p_target_user_id and usage.usage_date = v_today;
  select usage.attempts_started into v_monthly_before
  from public.tradeflow_ai_monthly_usage as usage
  where usage.user_id = p_target_user_id and usage.usage_month = v_month;

  update public.tradeflow_ai_daily_usage
  set attempts_started = 0, succeeded = 0, failed = 0
  where user_id = p_target_user_id and usage_date = v_today;
  update public.tradeflow_ai_monthly_usage
  set attempts_started = 0
  where user_id = p_target_user_id and usage_month = v_month;

  insert into public.tradeflow_admin_audit_log(actor_user_id, actor_email, target_user_id, action, reason, details, outcome)
  values (
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    'ai_usage_reset',
    pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object(
      'daily_usage_date', v_today,
      'daily_attempts_before', coalesce(v_daily_before, 0),
      'monthly_usage_month', v_month,
      'monthly_attempts_before', coalesce(v_monthly_before, 0),
      'scope', 'current account quota counters only; event history, token totals, and platform limit retained'
    ),
    'succeeded'
  );
  return pg_catalog.jsonb_build_object(
    'daily_usage_date', v_today,
    'daily_attempts_reset', coalesce(v_daily_before, 0),
    'monthly_usage_month', v_month,
    'monthly_attempts_reset', coalesce(v_monthly_before, 0)
  );
end;
$$;
revoke all on function public.reset_workcraft_ai_account_usage(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reset_workcraft_ai_account_usage(uuid, uuid, text, text) to service_role;

commit;
