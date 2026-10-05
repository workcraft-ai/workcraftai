begin;

-- Admin-sponsored Pro grants are separate from Stripe subscriptions so Stripe
-- webhook updates can never erase or override a support/testing grant.
create table public.tradeflow_pro_access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grant_type text not null check (grant_type in ('temporary', 'permanent')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  revoked_by uuid references auth.users(id) on delete set null,
  reason text not null check (length(btrim(reason)) between 8 and 500),
  created_at timestamptz not null default now(),
  constraint tradeflow_pro_grant_expiry_matches_type check (
    (grant_type = 'permanent' and expires_at is null)
    or (grant_type = 'temporary' and expires_at is not null and expires_at > starts_at)
  )
);

create index tradeflow_pro_access_grants_active_user_idx
  on public.tradeflow_pro_access_grants(user_id, starts_at desc, expires_at)
  where revoked_at is null;

alter table public.tradeflow_pro_access_grants enable row level security;
revoke all on public.tradeflow_pro_access_grants from public, anon, authenticated;
grant all on public.tradeflow_pro_access_grants to service_role;

comment on table public.tradeflow_pro_access_grants is
  'Private admin-sponsored Pro entitlements. Temporary grants expire automatically; permanent grants remain until revoked.';

-- Internal checker used by privileged database functions and triggers.
create or replace function public.workcraft_user_has_pro(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id and s.status in ('active', 'trialing')
  ) or exists (
    select 1 from public.tradeflow_pro_access_grants g
    where g.user_id = p_user_id
      and g.starts_at <= pg_catalog.now()
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > pg_catalog.now())
  );
$$;
revoke all on function public.workcraft_user_has_pro(uuid) from public, anon, authenticated;

-- RLS policies can call this non-exposed helper, but only for the signed-in
-- user's own ID. The helper reads billing and grant records as its owner.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.workcraft_user_has_pro(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_user_id is distinct from auth.uid() then
    return false;
  end if;
  return public.workcraft_user_has_pro(p_user_id);
end;
$$;
revoke all on function private.workcraft_user_has_pro(uuid) from public, anon;
grant execute on function private.workcraft_user_has_pro(uuid) to authenticated;

-- Keep SQL-side Pro feature enforcement consistent with the server checks.
drop policy if exists "Pro users create their own jobs" on public.jobs;
create policy "Pro users create their own jobs" on public.jobs for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.workcraft_user_has_pro((select auth.uid()))));

drop policy if exists "Pro users update their own jobs" on public.jobs;
create policy "Pro users update their own jobs" on public.jobs for update to authenticated
  using ((select auth.uid()) = user_id and (select private.workcraft_user_has_pro((select auth.uid()))))
  with check ((select auth.uid()) = user_id and (select private.workcraft_user_has_pro((select auth.uid()))));

drop policy if exists "Pro users delete their own jobs" on public.jobs;
create policy "Pro users delete their own jobs" on public.jobs for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.workcraft_user_has_pro((select auth.uid()))));

drop policy if exists "Pro users add estimate attachments" on public.estimate_attachments;
create policy "Pro users add estimate attachments" on public.estimate_attachments for insert to authenticated
  with check ((select auth.uid()) = user_id
    and (select private.workcraft_user_has_pro((select auth.uid())))
    and exists (select 1 from public.estimates e where e.id::text = estimate_id and e.user_id = (select auth.uid())));

drop policy if exists "Pro users update estimate attachments" on public.estimate_attachments;
create policy "Pro users update estimate attachments" on public.estimate_attachments for update to authenticated
  using ((select auth.uid()) = user_id and (select private.workcraft_user_has_pro((select auth.uid()))))
  with check ((select auth.uid()) = user_id
    and (select private.workcraft_user_has_pro((select auth.uid())))
    and exists (select 1 from public.estimates e where e.id::text = estimate_id and e.user_id = (select auth.uid())));

-- Free-only estimate quotas stop applying while a grant is effective, and
-- resume automatically after a temporary grant expires or an admin revokes it.
create or replace function public.enforce_free_daily_estimate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_limit integer;
  used_count integer;
  today_utc date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  if new.user_id is null or public.workcraft_user_has_pro(new.user_id) then
    return new;
  end if;

  select settings.free_daily_estimate_limit into current_limit
  from public.tradeflow_app_settings settings
  where settings.singleton = true
  for share;

  if current_limit is null then
    raise exception using errcode = '55000', message = 'FREE_DAILY_ESTIMATE_LIMIT_NOT_CONFIGURED';
  end if;
  if current_limit = 0 then
    raise exception using errcode = 'P0001', message = 'FREE_DAILY_ESTIMATE_LIMIT';
  end if;

  insert into public.tradeflow_daily_estimate_usage as daily_usage (user_id, usage_date, estimates_created)
  values (new.user_id, today_utc, 1)
  on conflict (user_id, usage_date) do update
    set estimates_created = daily_usage.estimates_created + 1
    where daily_usage.estimates_created < current_limit
  returning estimates_created into used_count;

  if not found then
    raise exception using errcode = 'P0001', message = 'FREE_DAILY_ESTIMATE_LIMIT';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_free_daily_estimate_limit() from public, anon, authenticated;

-- Pro AI remains subject to both the existing per-account and global daily
-- caps regardless of whether access comes from Stripe or an admin grant.
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
  if not public.workcraft_user_has_pro(p_user_id) then
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

-- Keep estimate email, scheduled follow-up, connected payments, deposits, jobs,
-- and private media on the same Pro entitlement calculation.
create or replace function public.workcraft_reserve_estimate_email(p_user_id uuid, p_estimate_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if p_user_id is null or p_estimate_id is null then
    raise exception using errcode = '22023', message = 'Invalid estimate email reservation.';
  end if;
  if not exists (select 1 from public.estimates e where e.id = p_estimate_id and e.user_id = p_user_id)
    or not public.workcraft_user_has_pro(p_user_id) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
  end if;

  insert into public.estimate_email_daily_usage as email_usage(user_id, usage_date, email_count)
  values (p_user_id, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_date) do update
    set email_count = email_usage.email_count + 1
    where email_usage.email_count < 50;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DAILY_LIMIT';
  end if;
  return true;
end;
$$;
revoke all on function public.workcraft_reserve_estimate_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_estimate_email(uuid, uuid) to service_role;

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
      and public.workcraft_user_has_pro(e.user_id)
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

create or replace function public.grant_workcraft_pro_access(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_grant_type text,
  p_duration_days integer,
  p_audit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  v_starts_at timestamptz := pg_catalog.clock_timestamp();
  v_expires_at timestamptz;
begin
  if p_target_user_id is null or p_actor_user_id is null or p_audit_id is null
    or p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 8 and 500
    or p_grant_type is null or p_grant_type not in ('temporary', 'permanent')
    or (p_grant_type = 'temporary' and (p_duration_days is null or p_duration_days < 1 or p_duration_days > 365))
    or (p_grant_type = 'permanent' and p_duration_days is not null) then
    raise exception using errcode = '22023', message = 'INVALID_PRO_ACCESS_GRANT';
  end if;
  if not exists (select 1 from public.tradeflow_admins a where a.user_id = p_actor_user_id and a.role in ('billing', 'super_admin')) then
    raise exception using errcode = '42501', message = 'BILLING_ADMIN_REQUIRED';
  end if;
  if not exists (select 1 from public.tradeflow_admin_audit_log l
    where l.id = p_audit_id and l.actor_user_id = p_actor_user_id and l.target_user_id = p_target_user_id
      and l.action = 'pro_access_granted' and l.outcome = 'started') then
    raise exception using errcode = '42501', message = 'PRO_ACCESS_AUDIT_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_target_user_id::text || ':admin-pro-access', 0));
  if exists (select 1 from public.tradeflow_pro_access_grants g
    where g.user_id = p_target_user_id and g.starts_at <= v_starts_at and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > v_starts_at)) then
    raise exception using errcode = 'P0001', message = 'PRO_ACCESS_ALREADY_ACTIVE';
  end if;

  v_expires_at := case when p_grant_type = 'temporary' then v_starts_at + pg_catalog.make_interval(days => p_duration_days) else null end;
  insert into public.tradeflow_pro_access_grants(user_id, grant_type, starts_at, expires_at, granted_by, reason)
  values (p_target_user_id, p_grant_type, v_starts_at, v_expires_at, p_actor_user_id, pg_catalog.btrim(p_reason))
  returning id into v_grant_id;

  update public.tradeflow_admin_audit_log set outcome = 'succeeded', details = details || pg_catalog.jsonb_build_object(
    'grant_id', v_grant_id, 'grant_type', p_grant_type, 'starts_at', v_starts_at, 'expires_at', v_expires_at
  ) where id = p_audit_id;
  return pg_catalog.jsonb_build_object('id', v_grant_id, 'grant_type', p_grant_type, 'starts_at', v_starts_at, 'expires_at', v_expires_at);
end;
$$;
revoke all on function public.grant_workcraft_pro_access(uuid, uuid, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.grant_workcraft_pro_access(uuid, uuid, text, text, integer, uuid) to service_role;

create or replace function public.revoke_workcraft_pro_access(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_reason text,
  p_audit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_ids uuid[];
  v_revoked_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_target_user_id is null or p_actor_user_id is null or p_audit_id is null
    or p_reason is null or pg_catalog.length(pg_catalog.btrim(p_reason)) not between 8 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_PRO_ACCESS_REVOCATION';
  end if;
  if not exists (select 1 from public.tradeflow_admins a where a.user_id = p_actor_user_id and a.role in ('billing', 'super_admin')) then
    raise exception using errcode = '42501', message = 'BILLING_ADMIN_REQUIRED';
  end if;
  if not exists (select 1 from public.tradeflow_admin_audit_log l
    where l.id = p_audit_id and l.actor_user_id = p_actor_user_id and l.target_user_id = p_target_user_id
      and l.action = 'pro_access_revoked' and l.outcome = 'started') then
    raise exception using errcode = '42501', message = 'PRO_ACCESS_AUDIT_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_target_user_id::text || ':admin-pro-access', 0));
  with revoked as (
    update public.tradeflow_pro_access_grants g
    set revoked_at = v_revoked_at, revoked_by = p_actor_user_id
    where g.user_id = p_target_user_id and g.starts_at <= v_revoked_at and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > v_revoked_at)
    returning g.id
  ) select pg_catalog.array_agg(id) into v_grant_ids from revoked;

  if v_grant_ids is null then
    raise exception using errcode = 'P0001', message = 'NO_ACTIVE_PRO_ACCESS_GRANT';
  end if;
  update public.tradeflow_admin_audit_log set outcome = 'succeeded', details = details || pg_catalog.jsonb_build_object(
    'grant_ids', pg_catalog.to_jsonb(v_grant_ids), 'revoked_at', v_revoked_at
  ) where id = p_audit_id;
  return pg_catalog.jsonb_build_object('grant_ids', pg_catalog.to_jsonb(v_grant_ids), 'revoked_at', v_revoked_at);
end;
$$;
revoke all on function public.revoke_workcraft_pro_access(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_workcraft_pro_access(uuid, uuid, text, uuid) to service_role;

commit;
