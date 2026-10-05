begin;

-- The upload helper is only needed inside Storage's policy, not as a PostgREST
-- RPC. Keep it in a non-exposed schema while granting the role that evaluates
-- the policy enough access to invoke it.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

drop policy if exists "Pro users upload their own estimate media" on storage.objects;
drop function if exists public.workcraft_can_upload_estimate_media(uuid, text, bigint, text);

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

-- Quota reservation changes state, so only the authenticated application server
-- may call it after validating the signed-in contractor and estimate owner.
drop function if exists public.workcraft_reserve_estimate_email(uuid);
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
  if not exists (
    select 1 from public.estimates e
    join public.subscriptions s on s.user_id = e.user_id
    where e.id = p_estimate_id and e.user_id = p_user_id and s.status in ('active', 'trialing')
  ) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
  end if;

  insert into public.estimate_email_daily_usage(user_id, usage_date, email_count)
  values (p_user_id, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (user_id, usage_date) do update
    set email_count = estimate_email_daily_usage.email_count + 1
    where estimate_email_daily_usage.email_count < 50;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_EMAIL_DAILY_LIMIT';
  end if;
  return true;
end;
$$;
revoke all on function public.workcraft_reserve_estimate_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_estimate_email(uuid, uuid) to service_role;

commit;
