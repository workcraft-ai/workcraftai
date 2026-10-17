-- An opted-in contractor must complete a second factor before accessing
-- browser-facing data, including direct PostgREST and Storage requests.
create schema if not exists auth_gate;
revoke all on schema auth_gate from public, anon, authenticated;
grant usage on schema auth_gate to authenticated;

create or replace function auth_gate.mfa_session_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    or not exists (
      select 1 from auth.mfa_factors factor
      where factor.user_id = (select auth.uid())
        and factor.status = 'verified'
    );
$$;

revoke all on function auth_gate.mfa_session_allowed() from public, anon, authenticated;
grant execute on function auth_gate.mfa_session_allowed() to authenticated;

-- Restrictive policies combine with every existing owner policy. The role
-- condition leaves anonymous customer proposal links unchanged. Include every
-- RLS-enabled public table, including service-only tables, so future grants
-- cannot accidentally expose data to an AAL1 session.
do $$
declare item record;
begin
  for item in
    select namespace.nspname as schema_name, relation.relname as table_name
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where relation.relkind in ('r', 'p')
      and relation.relrowsecurity
      and namespace.nspname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I',
      'Require opted-in MFA', item.schema_name, item.table_name);
    execute format('create policy %I on %I.%I as restrictive for all to authenticated using ((select auth_gate.mfa_session_allowed())) with check ((select auth_gate.mfa_session_allowed()))',
      'Require opted-in MFA', item.schema_name, item.table_name);
  end loop;
end $$;

drop policy if exists "Require opted-in MFA for storage" on storage.objects;
create policy "Require opted-in MFA for storage" on storage.objects
  as restrictive for all to authenticated
  using ((select auth_gate.mfa_session_allowed()))
  with check ((select auth_gate.mfa_session_allowed()));

-- These RPCs run as SECURITY DEFINER and would otherwise bypass table RLS.
-- Move their existing implementations into an unexposed schema, remove
-- browser-role execute rights, and expose small MFA-checking wrappers.
alter function public.workcraft_update_estimate_pipeline_stage(uuid, text) set schema auth_gate;
revoke all on function auth_gate.workcraft_update_estimate_pipeline_stage(uuid, text) from public, anon, authenticated;
create function public.workcraft_update_estimate_pipeline_stage(p_estimate_id uuid, p_stage text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not auth_gate.mfa_session_allowed() then
    raise exception using errcode = '42501', message = 'MFA_REQUIRED';
  end if;
  return auth_gate.workcraft_update_estimate_pipeline_stage(p_estimate_id, p_stage);
end; $$;
revoke all on function public.workcraft_update_estimate_pipeline_stage(uuid, text) from public, anon;
grant execute on function public.workcraft_update_estimate_pipeline_stage(uuid, text) to authenticated;

alter function public.workcraft_get_accepted_total_cents(uuid) set schema auth_gate;
revoke all on function auth_gate.workcraft_get_accepted_total_cents(uuid) from public, anon, authenticated;
create function public.workcraft_get_accepted_total_cents(p_estimate_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if not auth_gate.mfa_session_allowed() then
    raise exception using errcode = '42501', message = 'MFA_REQUIRED';
  end if;
  return auth_gate.workcraft_get_accepted_total_cents(p_estimate_id);
end; $$;
revoke all on function public.workcraft_get_accepted_total_cents(uuid) from public, anon;
grant execute on function public.workcraft_get_accepted_total_cents(uuid) to authenticated;

alter function public.workcraft_reserve_estimate_media_upload(uuid, text, bigint, text) set schema auth_gate;
revoke all on function auth_gate.workcraft_reserve_estimate_media_upload(uuid, text, bigint, text) from public, anon, authenticated;
create function public.workcraft_reserve_estimate_media_upload(
  p_estimate_id uuid, p_storage_path text, p_size bigint, p_mime_type text
) returns table (allowed boolean, reason text, reservation_id uuid, monthly_used bigint, retained_used bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if not auth_gate.mfa_session_allowed() then
    raise exception using errcode = '42501', message = 'MFA_REQUIRED';
  end if;
  return query select * from auth_gate.workcraft_reserve_estimate_media_upload(
    p_estimate_id, p_storage_path, p_size, p_mime_type);
end; $$;
revoke all on function public.workcraft_reserve_estimate_media_upload(uuid, text, bigint, text) from public, anon;
grant execute on function public.workcraft_reserve_estimate_media_upload(uuid, text, bigint, text) to authenticated;

alter function public.workcraft_finish_estimate_media_upload(uuid, boolean) set schema auth_gate;
revoke all on function auth_gate.workcraft_finish_estimate_media_upload(uuid, boolean) from public, anon, authenticated;
create function public.workcraft_finish_estimate_media_upload(p_reservation_id uuid, p_uploaded boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not auth_gate.mfa_session_allowed() then
    raise exception using errcode = '42501', message = 'MFA_REQUIRED';
  end if;
  return auth_gate.workcraft_finish_estimate_media_upload(p_reservation_id, p_uploaded);
end; $$;
revoke all on function public.workcraft_finish_estimate_media_upload(uuid, boolean) from public, anon;
grant execute on function public.workcraft_finish_estimate_media_upload(uuid, boolean) to authenticated;

create or replace function public.convert_accepted_estimate_to_job(
  p_estimate_id text, p_scheduled_at timestamptz default null,
  p_title text default null, p_notes text default ''
) returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  if not auth_gate.mfa_session_allowed() then
    raise exception using errcode = '42501', message = 'MFA_REQUIRED';
  end if;
  return private.workcraft_convert_accepted_estimate_to_job(
    p_estimate_id, p_scheduled_at, p_title, p_notes);
end; $$;
