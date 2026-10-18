begin;

-- Enforce cents for new/changed line-item prices without rewriting historical
-- estimates that may contain more precise legacy unit rates.
create or replace function private.workcraft_require_whole_cent_line_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.unit_price <> round(new.unit_price, 2) then
    raise exception using errcode = '22023', message = 'LINE_ITEM_PRICE_MUST_BE_CENTS';
  end if;
  return new;
end;
$$;
drop trigger if exists line_items_require_whole_cent_price on public.line_items;
create trigger line_items_require_whole_cent_price
before insert or update of unit_price on public.line_items
for each row execute function private.workcraft_require_whole_cent_line_price();

-- A save key makes a client retry resolve to the estimate already committed by
-- an earlier request whose response may have been lost in transit.
alter table public.estimates
  add column if not exists client_request_id uuid,
  add column if not exists client_request_hash text;
create unique index if not exists estimates_user_client_request_id_uidx
  on public.estimates(user_id, client_request_id)
  where client_request_id is not null;

-- Account quotas count successful drafts. The platform counter deliberately
-- continues counting every admitted provider call because failed calls can cost.
alter table public.tradeflow_ai_daily_usage
  add column if not exists billable_attempts integer not null default 0 check (billable_attempts >= 0);
alter table public.tradeflow_ai_monthly_usage
  add column if not exists billable_attempts integer not null default 0 check (billable_attempts >= 0);
update public.tradeflow_ai_daily_usage
set billable_attempts = greatest(attempts_started - failed, 0);
update public.tradeflow_ai_monthly_usage as usage
set billable_attempts = greatest(
  usage.attempts_started - coalesce((
    select count(*)::integer
    from public.tradeflow_ai_generation_events as events
    where events.user_id = usage.user_id
      and pg_catalog.date_trunc('month', events.usage_date::timestamp)::date = usage.usage_month
      and events.outcome = 'failed'
  ), 0),
  0
);

create or replace function private.workcraft_reset_billable_ai_usage_on_admin_reset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.attempts_started = 0 and old.attempts_started > 0 then
    if tg_table_name = 'tradeflow_ai_daily_usage' then
      if new.succeeded = 0 and new.failed = 0 then new.billable_attempts := 0; end if;
    else
      new.billable_attempts := 0;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tradeflow_ai_daily_reset_billable on public.tradeflow_ai_daily_usage;
create trigger tradeflow_ai_daily_reset_billable
before update on public.tradeflow_ai_daily_usage
for each row execute function private.workcraft_reset_billable_ai_usage_on_admin_reset();
drop trigger if exists tradeflow_ai_monthly_reset_billable on public.tradeflow_ai_monthly_usage;
create trigger tradeflow_ai_monthly_reset_billable
before update on public.tradeflow_ai_monthly_usage
for each row execute function private.workcraft_reset_billable_ai_usage_on_admin_reset();

create or replace function public.reserve_workcraft_ai_generation(
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
  if not public.workcraft_user_has_pro(p_user_id) then return query select false, 'pro_required'::text, null::uuid, 0, 0; return; end if;

  delete from public.tradeflow_ai_generation_events where created_at < pg_catalog.now() - interval '90 days';
  delete from public.tradeflow_ai_daily_usage where usage_date < v_today - 90;
  delete from public.tradeflow_ai_global_daily_usage where usage_date < v_today - 90;
  delete from public.tradeflow_ai_monthly_usage where usage_month < v_month - interval '3 months';

  insert into public.tradeflow_ai_global_daily_usage as global_usage(usage_date, attempts_started)
  values (v_today, 1)
  on conflict (usage_date) do update set attempts_started = global_usage.attempts_started + 1
  where global_usage.attempts_started < v_global_limit;
  if not found then return query select false, 'global_daily_limit'::text, null::uuid, 0, 0; return; end if;

  insert into public.tradeflow_ai_daily_usage as daily_usage(user_id, usage_date, attempts_started, billable_attempts)
  values (p_user_id, v_today, 1, 1)
  on conflict (user_id, usage_date) do update
    set attempts_started = daily_usage.attempts_started + 1,
        billable_attempts = daily_usage.billable_attempts + 1
  where daily_usage.billable_attempts < v_daily_limit
  returning billable_attempts into v_daily_used;
  if not found then
    update public.tradeflow_ai_global_daily_usage set attempts_started = greatest(0, attempts_started - 1) where usage_date = v_today;
    return query select false, 'daily_limit'::text, null::uuid, 0, 0; return;
  end if;

  insert into public.tradeflow_ai_monthly_usage as monthly_usage(user_id, usage_month, attempts_started, billable_attempts)
  values (p_user_id, v_month, 1, 1)
  on conflict (user_id, usage_month) do update
    set attempts_started = monthly_usage.attempts_started + 1,
        billable_attempts = monthly_usage.billable_attempts + 1
  where monthly_usage.billable_attempts < v_monthly_limit
  returning billable_attempts into v_monthly_used;
  if not found then
    update public.tradeflow_ai_daily_usage
      set attempts_started = greatest(0, attempts_started - 1), billable_attempts = greatest(0, billable_attempts - 1)
      where user_id = p_user_id and usage_date = v_today;
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

create or replace function public.complete_workcraft_ai_generation(
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
    update public.tradeflow_ai_daily_usage set succeeded = succeeded + 1
    where user_id = v_user_id and usage_date = v_usage_date;
  else
    update public.tradeflow_ai_daily_usage
      set failed = failed + 1, billable_attempts = greatest(0, billable_attempts - 1)
      where user_id = v_user_id and usage_date = v_usage_date;
    update public.tradeflow_ai_monthly_usage
      set billable_attempts = greatest(0, billable_attempts - 1)
      where user_id = v_user_id and usage_month = pg_catalog.date_trunc('month', v_usage_date::timestamp)::date;
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
create or replace function public.complete_workcraft_ai_generation(
  p_generation_id uuid, p_outcome text, p_provider_status integer, p_generated_items integer
)
returns boolean language sql security definer set search_path = '' as $$
  select public.complete_workcraft_ai_generation(p_generation_id, p_outcome, p_provider_status, p_generated_items, null::bigint, null::bigint)
$$;
revoke all on function public.complete_workcraft_ai_generation(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.complete_workcraft_ai_generation(uuid, text, integer, integer) to service_role;

-- Retain the established account-usage response while swapping displayed AI
-- allowance counts to billable successes rather than raw provider attempts.
alter function public.workcraft_get_account_usage(uuid) rename to workcraft_get_account_usage_legacy_20261018;
revoke all on function public.workcraft_get_account_usage_legacy_20261018(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_get_account_usage_legacy_20261018(uuid) to service_role;
create function public.workcraft_get_account_usage(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot jsonb;
  v_daily integer;
  v_monthly integer;
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')::date;
begin
  v_snapshot := public.workcraft_get_account_usage_legacy_20261018(p_user_id);
  select billable_attempts into v_daily from public.tradeflow_ai_daily_usage where user_id = p_user_id and usage_date = v_today;
  select billable_attempts into v_monthly from public.tradeflow_ai_monthly_usage where user_id = p_user_id and usage_month = v_month;
  v_snapshot := pg_catalog.jsonb_set(v_snapshot, '{ai,daily_used}', pg_catalog.to_jsonb(coalesce(v_daily, 0)), true);
  v_snapshot := pg_catalog.jsonb_set(v_snapshot, '{ai,monthly_used}', pg_catalog.to_jsonb(coalesce(v_monthly, 0)), true);
  return v_snapshot;
end;
$$;
revoke all on function public.workcraft_get_account_usage(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_get_account_usage(uuid) to service_role;

-- The create RPC is safely repeatable for a given user-supplied request UUID.
create or replace function public.workcraft_create_estimate_with_items(p_estimate jsonb, p_line_items jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate_id uuid;
  v_request_id uuid;
  v_request_hash text;
  v_existing_hash text;
  v_item record;
  v_phone text;
  v_subtotal numeric;
  v_display_mode text := coalesce(p_estimate ->> 'proposal_display_mode', 'detailed');
  v_summary text := nullif(pg_catalog.btrim(coalesce(p_estimate ->> 'proposal_summary', '')), '');
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  v_phone := nullif(pg_catalog.btrim(coalesce(p_estimate ->> 'client_phone', '')), '');
  if coalesce(p_estimate ->> 'client_request_id', '') <> '' then
    begin v_request_id := (p_estimate ->> 'client_request_id')::uuid;
    exception when invalid_text_representation then raise exception using errcode = '22023', message = 'INVALID_ESTIMATE'; end;
    v_request_hash := pg_catalog.md5((p_estimate - 'client_request_id')::text || '|' || p_line_items::text);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':' || v_request_id::text, 0));
    select id, client_request_hash into v_estimate_id, v_existing_hash from public.estimates
      where user_id = v_user_id and client_request_id = v_request_id;
    if found then
      if v_existing_hash is distinct from v_request_hash then
        raise exception using errcode = '22023', message = 'ESTIMATE_REQUEST_KEY_REUSED';
      end if;
      return v_estimate_id;
    end if;
  end if;

  if p_line_items is null or pg_catalog.jsonb_typeof(p_line_items) <> 'array'
    or pg_catalog.jsonb_array_length(p_line_items) < 1 or pg_catalog.jsonb_array_length(p_line_items) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  for v_item in select * from pg_catalog.jsonb_to_recordset(p_line_items)
    as x(description text, description_es text, quantity numeric, unit text, unit_price numeric)
  loop
    if v_item.description is null or pg_catalog.length(pg_catalog.btrim(v_item.description)) < 1 or pg_catalog.length(v_item.description) > 240
      or v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity > 100000
      or v_item.unit_price is null or v_item.unit_price < 0 or v_item.unit_price > 100000000
      or v_item.unit_price <> round(v_item.unit_price, 2)
      or (v_item.description_es is not null and pg_catalog.length(v_item.description_es) > 240)
      or (v_item.unit is not null and pg_catalog.length(pg_catalog.btrim(v_item.unit)) > 40) then
      raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
    end if;
  end loop;
  select coalesce(sum(round(x.quantity * x.unit_price, 2)), 0) into v_subtotal
  from pg_catalog.jsonb_to_recordset(p_line_items) as x(quantity numeric, unit_price numeric);
  if v_subtotal > 1000000000 then raise exception using errcode = '22023', message = 'ESTIMATE_TOTAL_TOO_LARGE'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_name', ''))) not between 1 and 200
    or (pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', ''))) > 0
      and (pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', ''))) > 320
        or pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', '')) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    or pg_catalog.length(coalesce(v_phone, '')) > 80
    or (v_phone is not null and (
      v_phone !~ '^[+0-9().[:space:]#xX-]*([Ee][Xx][Tt]\.?[[:space:]]*[0-9]+)?$'
      or pg_catalog.length(pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(v_phone, '([Ee][Xx][Tt]\.?[[:space:]]*|[xX]|#)[[:space:]]*[0-9]+$', '', 'g'),
        '[^0-9]', '', 'g'
      )) not between 7 and 15
    ))
    or pg_catalog.length(coalesce(p_estimate ->> 'job_address', '')) > 500
    or coalesce((p_estimate ->> 'deposit_percentage')::numeric, 0) not between 0 and 100
    or coalesce((p_estimate ->> 'tax_rate')::numeric, 0) not between 0 and 100
    or coalesce((p_estimate ->> 'markup_percentage')::numeric, 0) not between 0 and 500
    or v_display_mode not in ('detailed', 'summary')
    or (v_summary is not null and pg_catalog.length(v_summary) > 1200)
    or (v_display_mode = 'summary' and v_summary is null)
    or not public.workcraft_valid_package_options(p_estimate -> 'package_options') then
    raise exception using errcode = '22023', message = 'INVALID_ESTIMATE';
  end if;

  insert into public.estimates (
    user_id, client_request_id, client_request_hash, client_name, client_email, client_phone, job_address, trade,
    require_deposit, deposit_percentage, package_options, tax_rate, markup_percentage,
    proposal_language, proposal_display_mode, proposal_summary, status
  ) values (
    v_user_id, v_request_id, v_request_hash,
    pg_catalog.btrim(p_estimate ->> 'client_name'),
    coalesce(pg_catalog.btrim(p_estimate ->> 'client_email'), ''),
    v_phone,
    nullif(pg_catalog.btrim(p_estimate ->> 'job_address'), ''),
    left(coalesce(p_estimate ->> 'trade', 'General'), 80),
    coalesce((p_estimate ->> 'require_deposit')::boolean, false),
    coalesce((p_estimate ->> 'deposit_percentage')::numeric, 20),
    case when pg_catalog.jsonb_typeof(p_estimate -> 'package_options') = 'array' then p_estimate -> 'package_options' else '[]'::jsonb end,
    coalesce((p_estimate ->> 'tax_rate')::numeric, 0),
    coalesce((p_estimate ->> 'markup_percentage')::numeric, 0),
    case when p_estimate ->> 'proposal_language' = 'es' then 'es' else 'en' end,
    v_display_mode, v_summary, 'pending'
  ) returning id into v_estimate_id;
  insert into public.line_items(estimate_id, description, description_es, quantity, unit, unit_price)
  select v_estimate_id, pg_catalog.btrim(x.description), nullif(pg_catalog.btrim(x.description_es), ''), x.quantity,
    coalesce(nullif(pg_catalog.btrim(x.unit), ''), 'each'), x.unit_price
  from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit text, unit_price numeric);
  return v_estimate_id;
end;
$$;
revoke all on function public.workcraft_create_estimate_with_items(jsonb, jsonb) from public, anon;
grant execute on function public.workcraft_create_estimate_with_items(jsonb, jsonb) to authenticated;

-- Initial share-link creation is idempotent and cannot invalidate a link when
-- an estimate-save request is retried after a network timeout.
create function public.workcraft_ensure_proposal_share(
  p_estimate_id uuid, p_user_id uuid, p_hash text, p_encrypted text, p_expires timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_estimate public.estimates%rowtype;
begin
  select * into v_estimate from public.estimates where id = p_estimate_id and user_id = p_user_id for update;
  if not found then return false; end if;
  if v_estimate.share_token_hash is not null and v_estimate.share_revoked_at is null
    and (v_estimate.share_expires_at is null or v_estimate.share_expires_at > pg_catalog.now()) then return true; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_encrypted is null or pg_catalog.length(p_encrypted) > 512
    or p_expires is null or p_expires <= pg_catalog.now() then
    raise exception using errcode = '22023', message = 'INVALID_SHARE_TOKEN';
  end if;
  update public.estimates set share_token_hash = p_hash, share_expires_at = p_expires, share_revoked_at = null where id = p_estimate_id;
  insert into private.proposal_share_secrets(estimate_id, encrypted_token)
  values (p_estimate_id, p_encrypted)
  on conflict (estimate_id) do update set encrypted_token = excluded.encrypted_token, updated_at = pg_catalog.now();
  return true;
end;
$$;
revoke all on function public.workcraft_ensure_proposal_share(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.workcraft_ensure_proposal_share(uuid, uuid, text, text, timestamptz) to service_role;

commit;
