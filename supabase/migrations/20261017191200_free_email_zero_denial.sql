-- Free accounts with zero email allowance retain the existing explicit denial.
-- A positive admin-set allowance still enables Free estimate emails.
begin;
create or replace function public.workcraft_reserve_customer_email_internal(
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
  v_pro boolean;
  v_daily_limit integer;
  v_monthly_limit integer;
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

  v_pro := case when v_user_limited then public.workcraft_user_has_pro(p_user_id) else false end;
  if v_source = 'invoice' then
    if not exists (
      select 1
      from public.jobs as job
      where job.id = p_job_id
        and job.user_id = p_user_id
    ) or not v_pro then
      raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
    end if;
  elsif v_user_limited and (
    not exists (
      select 1
      from public.estimates as estimate
      where estimate.id = p_estimate_id
        and estimate.user_id = p_user_id
    )
    or (v_source <> 'estimate' and not v_pro)
  ) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
  end if;

  select settings.app_email_daily_limit,
    case when v_pro then settings.pro_email_daily_limit else settings.free_email_daily_limit end,
    case when v_pro then settings.pro_email_monthly_limit else settings.free_email_monthly_limit end
  into v_platform_limit, v_daily_limit, v_monthly_limit
  from public.tradeflow_app_settings as settings
  where settings.singleton = true
  for share;
  if v_platform_limit is null then
    raise exception using errcode = '55000', message = 'APP_EMAIL_LIMIT_NOT_CONFIGURED';
  end if;

  if v_user_limited and (v_daily_limit = 0 or v_monthly_limit = 0) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
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
        case when v_user_limited then v_daily_limit else null end,
        case when v_user_limited then v_monthly_limit else null end,
        null::integer,
        null::integer;
    return;
  end if;

  if v_user_limited then
    insert into public.estimate_email_daily_usage as daily_usage (user_id, usage_date, email_count)
    values (p_user_id, v_today, 1)
    on conflict on constraint estimate_email_daily_usage_pkey do update
      set email_count = daily_usage.email_count + 1
      where daily_usage.email_count < v_daily_limit
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
          v_daily_limit,
          v_monthly_limit,
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
      where monthly_usage.email_count < v_monthly_limit
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
          v_daily_limit,
          v_monthly_limit,
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
      case when v_user_limited then v_daily_limit else null end,
      case when v_user_limited then v_monthly_limit else null end,
      v_user_daily_used,
      v_user_monthly_used;
end;
$$;

commit;
