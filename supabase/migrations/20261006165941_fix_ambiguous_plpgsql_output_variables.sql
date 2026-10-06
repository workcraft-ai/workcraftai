begin;

-- The RETURNS TABLE output named usage_date shadows the same-named columns in
-- these statements. Qualify columns so PL/pgSQL can resolve each reference.
create or replace function public.workcraft_reserve_app_email(
  p_source text,
  p_user_id uuid default null,
  p_estimate_id uuid default null
)
returns table (
  allowed boolean,
  reason text,
  reservation_id uuid,
  usage_date date,
  daily_limit integer,
  emails_used integer
)
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

  select settings.app_email_daily_limit into v_limit
  from public.tradeflow_app_settings as settings
  where settings.singleton = true
  for share;
  if v_limit is null then
    raise exception using errcode = '55000', message = 'APP_EMAIL_LIMIT_NOT_CONFIGURED';
  end if;

  delete from public.tradeflow_app_email_reservations as reservation
  where reservation.created_at < pg_catalog.now() - interval '90 days';
  delete from public.tradeflow_app_email_daily_usage as daily_usage
  where daily_usage.usage_date < v_today - 90;
  delete from public.estimate_email_daily_usage as estimate_usage
  where estimate_usage.usage_date < v_today - 90;

  insert into public.tradeflow_app_email_daily_usage as daily_usage (usage_date, emails_started)
  values (v_today, 1)
  on conflict on constraint tradeflow_app_email_daily_usage_pkey do update
    set emails_started = daily_usage.emails_started + 1
    where daily_usage.emails_started < v_limit
  returning daily_usage.emails_started into v_global_used;
  if not found then
    return query
      select false,
        'platform_daily_limit'::text,
        null::uuid,
        v_today,
        v_limit,
        coalesce((
          select daily_usage.emails_started
          from public.tradeflow_app_email_daily_usage as daily_usage
          where daily_usage.usage_date = v_today
        ), 0);
    return;
  end if;

  if v_source = 'estimate' then
    insert into public.estimate_email_daily_usage as estimate_usage (user_id, usage_date, email_count)
    values (p_user_id, v_today, 1)
    on conflict on constraint estimate_email_daily_usage_pkey do update
      set email_count = estimate_usage.email_count + 1
      where estimate_usage.email_count < 50
    returning estimate_usage.email_count into v_user_used;
    if not found then
      update public.tradeflow_app_email_daily_usage as daily_usage
      set emails_started = greatest(0, daily_usage.emails_started - 1)
      where daily_usage.usage_date = v_today;
      return query
        select false,
          'account_daily_limit'::text,
          null::uuid,
          v_today,
          v_limit,
          coalesce((
            select daily_usage.emails_started
            from public.tradeflow_app_email_daily_usage as daily_usage
            where daily_usage.usage_date = v_today
          ), 0);
      return;
    end if;
  end if;

  insert into public.tradeflow_app_email_reservations as app_email_reservation (usage_date, source, user_id)
  values (v_today, v_source, p_user_id)
  returning app_email_reservation.id into v_reservation_id;

  return query select true, 'allowed'::text, v_reservation_id, v_today, v_limit, v_global_used;
end;
$$;
revoke all on function public.workcraft_reserve_app_email(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_app_email(text, uuid, uuid) to service_role;

-- Qualify INSERT ... RETURNING columns that share names with output variables.
create or replace function public.workcraft_reserve_pro_checkout(p_user_id uuid)
returns table (
  attempt_id uuid,
  stripe_checkout_session_id text,
  checkout_url text,
  expires_at timestamptz,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.pro_checkout_attempts%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_USER';
  end if;
  if public.workcraft_user_has_pro(p_user_id) then
    raise exception using errcode = '55000', message = 'WORKCRAFT_PRO_ALREADY_ACTIVE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 1));
  update public.pro_checkout_attempts as attempt
  set status = 'expired', updated_at = pg_catalog.now()
  where attempt.user_id = p_user_id
    and attempt.status in ('creating', 'open')
    and attempt.expires_at <= pg_catalog.now();

  select attempt.* into v_existing
  from public.pro_checkout_attempts as attempt
  where attempt.user_id = p_user_id
    and attempt.status in ('creating', 'open')
  order by attempt.created_at desc
  limit 1
  for update;
  if found then
    return query
      select v_existing.id,
        v_existing.stripe_checkout_session_id,
        v_existing.checkout_url,
        v_existing.expires_at,
        true;
    return;
  end if;

  insert into public.pro_checkout_attempts as checkout_attempt (user_id)
  values (p_user_id)
  returning checkout_attempt.id,
    checkout_attempt.stripe_checkout_session_id,
    checkout_attempt.checkout_url,
    checkout_attempt.expires_at
  into attempt_id, stripe_checkout_session_id, checkout_url, expires_at;
  reused := false;
  return next;
end;
$$;
revoke all on function public.workcraft_reserve_pro_checkout(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_pro_checkout(uuid) to service_role;

commit;
