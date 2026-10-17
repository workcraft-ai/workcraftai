begin;

-- Defaults preserve existing behavior: Free has no app-sent estimate emails;
-- trial and paid Pro share the existing 5/day and 100/month allowance.
alter table public.tradeflow_app_settings
  add column free_email_daily_limit integer not null default 0 check (free_email_daily_limit between 0 and 10),
  add column free_email_monthly_limit integer not null default 0 check (free_email_monthly_limit between 0 and 100),
  add column pro_email_daily_limit integer not null default 5 check (pro_email_daily_limit between 1 and 50),
  add column pro_email_monthly_limit integer not null default 100 check (pro_email_monthly_limit between 1 and 1000);

-- Only service-role code can call this audited, super-admin-only mutation.
create function public.update_workcraft_account_email_limits(
  p_free_daily integer, p_free_monthly integer, p_pro_daily integer, p_pro_monthly integer,
  p_actor_user_id uuid, p_actor_email text, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous public.tradeflow_app_settings%rowtype;
begin
  if p_free_daily is null or p_free_daily not between 0 and 10
    or p_free_monthly is null or p_free_monthly not between 0 and 100
    or p_pro_daily is null or p_pro_daily not between 1 and 50
    or p_pro_monthly is null or p_pro_monthly not between 1 and 1000
    or (p_free_daily = 0 and p_free_monthly <> 0)
    or (p_free_daily > 0 and p_free_monthly < p_free_daily)
    or p_pro_monthly < p_pro_daily then
    raise exception using errcode = '22023', message = 'INVALID_ACCOUNT_EMAIL_LIMITS';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 8 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_AUDIT_REASON';
  end if;
  if not exists (select 1 from public.tradeflow_admins a where a.user_id = p_actor_user_id and a.role = 'super_admin') then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_REQUIRED';
  end if;
  select * into previous from public.tradeflow_app_settings where singleton = true for update;
  if not found then raise exception using errcode = '55000', message = 'APP_SETTINGS_MISSING'; end if;
  update public.tradeflow_app_settings set
    free_email_daily_limit = p_free_daily, free_email_monthly_limit = p_free_monthly,
    pro_email_daily_limit = p_pro_daily, pro_email_monthly_limit = p_pro_monthly,
    updated_at = now(), updated_by = p_actor_user_id where singleton = true;
  insert into public.tradeflow_admin_audit_log(actor_user_id, actor_email, action, reason, details, outcome)
  values (p_actor_user_id, p_actor_email, 'account_email_limits_updated', btrim(p_reason),
    jsonb_build_object('previous', jsonb_build_object('free_daily', previous.free_email_daily_limit,
      'free_monthly', previous.free_email_monthly_limit, 'pro_daily', previous.pro_email_daily_limit,
      'pro_monthly', previous.pro_email_monthly_limit),
      'new', jsonb_build_object('free_daily', p_free_daily, 'free_monthly', p_free_monthly,
      'pro_daily', p_pro_daily, 'pro_monthly', p_pro_monthly)), 'succeeded');
  return jsonb_build_object('free_daily', p_free_daily, 'free_monthly', p_free_monthly,
    'pro_daily', p_pro_daily, 'pro_monthly', p_pro_monthly);
end;
$$;
revoke all on function public.update_workcraft_account_email_limits(integer,integer,integer,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.update_workcraft_account_email_limits(integer,integer,integer,integer,uuid,text,text) to service_role;

-- The provider-wide 75/day admission guard wraps this internal function.
-- Keep the original function signature and atomic counters unchanged.
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

revoke all on function public.workcraft_reserve_customer_email_internal(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.workcraft_reserve_customer_email_internal(text,uuid,uuid,uuid) to service_role;

-- The profile/dashboard snapshot and reservation now read the same settings.
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
    'email', pg_catalog.jsonb_build_object('included', v_pro or v_settings.free_email_daily_limit > 0, 'daily_used', coalesce(v_email_daily,0),
      'daily_limit', case when v_pro then v_settings.pro_email_daily_limit else v_settings.free_email_daily_limit end,
      'monthly_used', coalesce(v_email_monthly,0),
      'monthly_limit', case when v_pro then v_settings.pro_email_monthly_limit else v_settings.free_email_monthly_limit end),
    'media', pg_catalog.jsonb_build_object('included', v_pro, 'monthly_used_bytes', v_storage_month,
      'monthly_limit_bytes', case when v_pro then 104857600 else 0 end, 'retained_bytes', v_storage_retained,
      'retained_limit_bytes', 262144000, 'file_count', v_media_count, 'file_limit', 100)
  );
end;
$$;

commit;
