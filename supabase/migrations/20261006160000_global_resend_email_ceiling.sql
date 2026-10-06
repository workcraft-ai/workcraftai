begin;

-- Resend currently allows 100 messages per UTC day. Keep app sends below that
-- limit while preserving headroom for provider and operational messages.
alter table public.tradeflow_app_settings
  add column if not exists app_email_daily_limit integer not null default 75
  check (app_email_daily_limit between 1 and 90);

create table if not exists public.tradeflow_app_email_daily_usage (
  usage_date date primary key,
  emails_started integer not null default 0 check (emails_started >= 0)
);
alter table public.tradeflow_app_email_daily_usage enable row level security;
revoke all on public.tradeflow_app_email_daily_usage from public, anon, authenticated;
grant all on public.tradeflow_app_email_daily_usage to service_role;

-- Reservation IDs make failure releases idempotent. A successful provider
-- acceptance keeps the reservation counted even if later bookkeeping fails.
create table if not exists public.tradeflow_app_email_reservations (
  id uuid primary key default gen_random_uuid(),
  usage_date date not null,
  source text not null check (source in ('estimate', 'follow_up', 'support', 'proposal_question', 'account_retention')),
  user_id uuid references auth.users(id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tradeflow_app_email_reservations_created_idx
  on public.tradeflow_app_email_reservations(created_at);
alter table public.tradeflow_app_email_reservations enable row level security;
revoke all on public.tradeflow_app_email_reservations from public, anon, authenticated;
grant all on public.tradeflow_app_email_reservations to service_role;

comment on column public.tradeflow_app_settings.app_email_daily_limit is
  'Maximum app-originated Resend messages per UTC day; defaults to 75 and is capped at 90 to stay below the provider 100/day free allowance.';
comment on table public.tradeflow_app_email_daily_usage is
  'Private atomic global counter for app-originated Resend messages per UTC day.';
comment on table public.tradeflow_app_email_reservations is
  'Private per-request email quota reservations; failed provider requests release exactly once.';

-- All mail paths reserve through this transaction-safe function. The global
-- counter row serializes concurrent Vercel instances; estimate email also
-- retains the existing per-account 50/day ceiling.
create or replace function public.workcraft_reserve_app_email(
  p_source text,
  p_user_id uuid default null,
  p_estimate_id uuid default null
)
returns table (allowed boolean, reason text, reservation_id uuid, usage_date date, daily_limit integer, emails_used integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_limit integer;
  v_global_used integer;
  v_user_used integer;
  v_reservation_id uuid;
  v_source text := pg_catalog.btrim(coalesce(p_source, ''));
begin
  if v_source not in ('estimate', 'follow_up', 'support', 'proposal_question', 'account_retention') then
    raise exception using errcode = '22023', message = 'INVALID_APP_EMAIL_SOURCE';
  end if;
  if (v_source = 'estimate' and (p_user_id is null or p_estimate_id is null))
    or (v_source <> 'estimate' and (p_user_id is not null or p_estimate_id is not null)) then
    raise exception using errcode = '22023', message = 'INVALID_APP_EMAIL_RESERVATION';
  end if;
  if v_source = 'estimate' and (
    not exists (select 1 from public.estimates e where e.id = p_estimate_id and e.user_id = p_user_id)
    or not public.workcraft_user_has_pro(p_user_id)
  ) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
  end if;

  select settings.app_email_daily_limit into v_limit
  from public.tradeflow_app_settings settings
  where settings.singleton = true
  for share;
  if v_limit is null then
    raise exception using errcode = '55000', message = 'APP_EMAIL_LIMIT_NOT_CONFIGURED';
  end if;

  delete from public.tradeflow_app_email_reservations
  where created_at < pg_catalog.now() - interval '90 days';
  delete from public.tradeflow_app_email_daily_usage where usage_date < v_today - 90;
  delete from public.estimate_email_daily_usage where usage_date < v_today - 90;

  insert into public.tradeflow_app_email_daily_usage as daily_usage(usage_date, emails_started)
  values (v_today, 1)
  on conflict (usage_date) do update
    set emails_started = daily_usage.emails_started + 1
    where daily_usage.emails_started < v_limit
  returning emails_started into v_global_used;
  if not found then
    return query select false, 'platform_daily_limit'::text, null::uuid, v_today, v_limit,
      coalesce((select emails_started from public.tradeflow_app_email_daily_usage where usage_date = v_today), 0);
    return;
  end if;

  if v_source = 'estimate' then
    insert into public.estimate_email_daily_usage as estimate_usage(user_id, usage_date, email_count)
    values (p_user_id, v_today, 1)
    on conflict (user_id, usage_date) do update
      set email_count = estimate_usage.email_count + 1
      where estimate_usage.email_count < 50
    returning email_count into v_user_used;
    if not found then
      update public.tradeflow_app_email_daily_usage
      set emails_started = greatest(0, emails_started - 1)
      where usage_date = v_today;
      return query select false, 'account_daily_limit'::text, null::uuid, v_today, v_limit,
        coalesce((select emails_started from public.tradeflow_app_email_daily_usage where usage_date = v_today), 0);
      return;
    end if;
  end if;

  insert into public.tradeflow_app_email_reservations(usage_date, source, user_id)
  values (v_today, v_source, p_user_id)
  returning id into v_reservation_id;
  return query select true, 'allowed'::text, v_reservation_id, v_today, v_limit, v_global_used;
end;
$$;
revoke all on function public.workcraft_reserve_app_email(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_app_email(text, uuid, uuid) to service_role;

-- Preserve the established estimate-email RPC signature. Its result now
-- includes the durable reservation ID and database UTC date for safe release.
drop function if exists public.workcraft_reserve_estimate_email(uuid, uuid);
create function public.workcraft_reserve_estimate_email(p_user_id uuid, p_estimate_id uuid)
returns table (allowed boolean, reason text, reservation_id uuid, usage_date date, daily_limit integer, emails_used integer)
language sql
security definer
set search_path = ''
as $$
  select * from public.workcraft_reserve_app_email('estimate', p_user_id, p_estimate_id)
$$;
revoke all on function public.workcraft_reserve_estimate_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_estimate_email(uuid, uuid) to service_role;

drop function if exists public.workcraft_release_estimate_email(uuid, date);
create or replace function public.workcraft_release_app_email(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage_date date;
  v_source text;
  v_user_id uuid;
begin
  update public.tradeflow_app_email_reservations
  set released_at = pg_catalog.now()
  where id = p_reservation_id and released_at is null
  returning usage_date, source, user_id into v_usage_date, v_source, v_user_id;
  if not found then return false; end if;

  update public.tradeflow_app_email_daily_usage
  set emails_started = greatest(0, emails_started - 1)
  where usage_date = v_usage_date;
  if v_source = 'estimate' and v_user_id is not null then
    update public.estimate_email_daily_usage
    set email_count = greatest(0, email_count - 1)
    where user_id = v_user_id and usage_date = v_usage_date;
  end if;
  return true;
end;
$$;
revoke all on function public.workcraft_release_app_email(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_release_app_email(uuid) to service_role;

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
  if p_limit is null or p_limit < 1 or p_limit > 90 then
    raise exception using errcode = '22023', message = 'APP_EMAIL_LIMIT_MUST_BE_BETWEEN_1_AND_90';
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
