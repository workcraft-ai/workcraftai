begin;

-- Extend per-account transactional email quotas to customer invoice emails.
-- Invoice reservations validate ownership through the job row, including jobs
-- created without an estimate.
alter table public.tradeflow_app_email_reservations
  drop constraint if exists tradeflow_app_email_reservations_source_check;
alter table public.tradeflow_app_email_reservations
  add constraint tradeflow_app_email_reservations_source_check
  check (source in ('estimate', 'follow_up', 'support', 'proposal_question', 'account_retention', 'invoice'));

drop function if exists public.workcraft_reserve_estimate_email(uuid, uuid);
drop function if exists public.workcraft_reserve_app_email(text, uuid, uuid);

create function public.workcraft_reserve_app_email(
  p_source text,
  p_user_id uuid default null,
  p_estimate_id uuid default null,
  p_job_id uuid default null
)
returns table (
  allowed boolean,
  reason text,
  reservation_id uuid,
  usage_date date,
  daily_limit integer,
  emails_used integer,
  account_daily_limit integer,
  account_monthly_limit integer,
  account_daily_used integer,
  account_monthly_used integer
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
  if v_source not in ('estimate', 'follow_up', 'support', 'proposal_question', 'account_retention', 'invoice') then
    raise exception using errcode = '22023', message = 'INVALID_APP_EMAIL_SOURCE';
  end if;

  v_user_limited := v_source in ('estimate', 'follow_up', 'proposal_question', 'invoice');
  if (v_source in ('estimate', 'follow_up', 'proposal_question')
      and (p_user_id is null or p_estimate_id is null or p_job_id is not null))
    or (v_source = 'invoice' and (p_user_id is null or p_job_id is null or p_estimate_id is not null))
    or (not v_user_limited and (p_user_id is not null or p_estimate_id is not null or p_job_id is not null)) then
    raise exception using errcode = '22023', message = 'INVALID_APP_EMAIL_RESERVATION';
  end if;

  if v_source = 'invoice' then
    if not exists (
      select 1
      from public.jobs as job
      where job.id = p_job_id
        and job.user_id = p_user_id
    ) or not public.workcraft_user_has_pro(p_user_id) then
      raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
    end if;
  elsif v_user_limited and (
    not exists (
      select 1
      from public.estimates as estimate
      where estimate.id = p_estimate_id
        and estimate.user_id = p_user_id
    )
    or not public.workcraft_user_has_pro(p_user_id)
  ) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
  end if;

  select settings.app_email_daily_limit
  into v_platform_limit
  from public.tradeflow_app_settings as settings
  where settings.singleton = true
  for share;
  if v_platform_limit is null then
    raise exception using errcode = '55000', message = 'APP_EMAIL_LIMIT_NOT_CONFIGURED';
  end if;

  delete from public.tradeflow_app_email_reservations as reservation
  where reservation.created_at < pg_catalog.now() - interval '90 days';
  delete from public.tradeflow_app_email_daily_usage as global_usage
  where global_usage.usage_date < v_today - 90;
  delete from public.estimate_email_daily_usage as daily_usage
  where daily_usage.usage_date < v_today - 90;
  delete from public.estimate_email_monthly_usage as monthly_usage
  where monthly_usage.usage_month < v_month - interval '3 months';

  insert into public.tradeflow_app_email_daily_usage as global_usage (usage_date, emails_started)
  values (v_today, 1)
  on conflict on constraint tradeflow_app_email_daily_usage_pkey do update
    set emails_started = global_usage.emails_started + 1
    where global_usage.emails_started < v_platform_limit
  returning global_usage.emails_started into v_platform_used;
  if not found then
    return query
      select false,
        'platform_daily_limit'::text,
        null::uuid,
        v_today,
        v_platform_limit,
        coalesce((
          select global_usage.emails_started
          from public.tradeflow_app_email_daily_usage as global_usage
          where global_usage.usage_date = v_today
        ), 0),
        case when v_user_limited then 5 else null end,
        case when v_user_limited then 100 else null end,
        null::integer,
        null::integer;
    return;
  end if;

  if v_user_limited then
    insert into public.estimate_email_daily_usage as daily_usage (user_id, usage_date, email_count)
    values (p_user_id, v_today, 1)
    on conflict on constraint estimate_email_daily_usage_pkey do update
      set email_count = daily_usage.email_count + 1
      where daily_usage.email_count < 5
    returning daily_usage.email_count into v_user_daily_used;
    if not found then
      update public.tradeflow_app_email_daily_usage as global_usage
      set emails_started = greatest(0, global_usage.emails_started - 1)
      where global_usage.usage_date = v_today;
      return query
        select false,
          'account_daily_limit'::text,
          null::uuid,
          v_today,
          v_platform_limit,
          coalesce((
            select global_usage.emails_started
            from public.tradeflow_app_email_daily_usage as global_usage
            where global_usage.usage_date = v_today
          ), 0),
          5,
          100,
          coalesce((
            select daily_usage.email_count
            from public.estimate_email_daily_usage as daily_usage
            where daily_usage.user_id = p_user_id
              and daily_usage.usage_date = v_today
          ), 0),
          coalesce((
            select monthly_usage.email_count
            from public.estimate_email_monthly_usage as monthly_usage
            where monthly_usage.user_id = p_user_id
              and monthly_usage.usage_month = v_month
          ), 0);
      return;
    end if;

    insert into public.estimate_email_monthly_usage as monthly_usage (user_id, usage_month, email_count)
    values (p_user_id, v_month, 1)
    on conflict on constraint estimate_email_monthly_usage_pkey do update
      set email_count = monthly_usage.email_count + 1
      where monthly_usage.email_count < 100
    returning monthly_usage.email_count into v_user_monthly_used;
    if not found then
      update public.estimate_email_daily_usage as daily_usage
      set email_count = greatest(0, daily_usage.email_count - 1)
      where daily_usage.user_id = p_user_id
        and daily_usage.usage_date = v_today;
      update public.tradeflow_app_email_daily_usage as global_usage
      set emails_started = greatest(0, global_usage.emails_started - 1)
      where global_usage.usage_date = v_today;
      return query
        select false,
          'account_monthly_limit'::text,
          null::uuid,
          v_today,
          v_platform_limit,
          coalesce((
            select global_usage.emails_started
            from public.tradeflow_app_email_daily_usage as global_usage
            where global_usage.usage_date = v_today
          ), 0),
          5,
          100,
          coalesce((
            select daily_usage.email_count
            from public.estimate_email_daily_usage as daily_usage
            where daily_usage.user_id = p_user_id
              and daily_usage.usage_date = v_today
          ), 0),
          coalesce((
            select monthly_usage.email_count
            from public.estimate_email_monthly_usage as monthly_usage
            where monthly_usage.user_id = p_user_id
              and monthly_usage.usage_month = v_month
          ), 0);
      return;
    end if;
  end if;

  insert into public.tradeflow_app_email_reservations as reservation (usage_date, source, user_id)
  values (v_today, v_source, p_user_id)
  returning reservation.id into v_reservation;

  return query
    select true,
      'allowed'::text,
      v_reservation,
      v_today,
      v_platform_limit,
      v_platform_used,
      case when v_user_limited then 5 else null end,
      case when v_user_limited then 100 else null end,
      v_user_daily_used,
      v_user_monthly_used;
end;
$$;

revoke all on function public.workcraft_reserve_app_email(text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_app_email(text, uuid, uuid, uuid) to service_role;

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
as $$ select * from public.workcraft_reserve_app_email('estimate', p_user_id, p_estimate_id, null) $$;
revoke all on function public.workcraft_reserve_estimate_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_estimate_email(uuid, uuid) to service_role;

create or replace function public.workcraft_release_app_email(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_source text;
  v_user_id uuid;
begin
  update public.tradeflow_app_email_reservations as reservation
  set released_at = pg_catalog.now()
  where reservation.id = p_reservation_id
    and reservation.released_at is null
  returning reservation.usage_date, reservation.source, reservation.user_id
    into v_date, v_source, v_user_id;
  if not found then return false; end if;

  update public.tradeflow_app_email_daily_usage as global_usage
  set emails_started = greatest(0, global_usage.emails_started - 1)
  where global_usage.usage_date = v_date;

  if v_source in ('estimate', 'follow_up', 'proposal_question', 'invoice') and v_user_id is not null then
    update public.estimate_email_daily_usage as daily_usage
    set email_count = greatest(0, daily_usage.email_count - 1)
    where daily_usage.user_id = v_user_id and daily_usage.usage_date = v_date;
    update public.estimate_email_monthly_usage as monthly_usage
    set email_count = greatest(0, monthly_usage.email_count - 1)
    where monthly_usage.user_id = v_user_id
      and monthly_usage.usage_month = pg_catalog.date_trunc('month', v_date::timestamp)::date;
  end if;
  return true;
end;
$$;
revoke all on function public.workcraft_release_app_email(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_release_app_email(uuid) to service_role;

comment on table public.estimate_email_monthly_usage is
  'Private UTC-month per-account counters for estimate, follow-up, proposal-question, and invoice emails.';

commit;
