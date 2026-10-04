-- Account activity and retention lifecycle. All access is server-side only.
create table if not exists public.tradeflow_account_lifecycle (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_active_at timestamptz not null,
  deletion_status text not null default 'active'
    check (deletion_status in ('active', 'pending_deletion', 'deleting')),
  notice_claimed_at timestamptz,
  notice_sent_at timestamptz,
  deletion_due_at timestamptz,
  deletion_claimed_at timestamptz,
  deletion_reason text,
  updated_at timestamptz not null default now()
);
create index if not exists tradeflow_account_lifecycle_due_idx
  on public.tradeflow_account_lifecycle(deletion_due_at)
  where deletion_status = 'pending_deletion';
alter table public.tradeflow_account_lifecycle enable row level security;
revoke all on public.tradeflow_account_lifecycle from public, anon, authenticated;
grant all on public.tradeflow_account_lifecycle to service_role;

insert into public.tradeflow_account_lifecycle(user_id, last_active_at)
select id, coalesce(last_sign_in_at, created_at, now())
from auth.users
on conflict (user_id) do nothing;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.seed_tradeflow_account_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tradeflow_account_lifecycle(user_id, last_active_at)
  values (new.id, coalesce(new.last_sign_in_at, new.created_at, pg_catalog.now()))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.seed_tradeflow_account_lifecycle() from public, anon, authenticated;
drop trigger if exists tradeflow_seed_account_lifecycle on auth.users;
create trigger tradeflow_seed_account_lifecycle
after insert on auth.users
for each row execute function private.seed_tradeflow_account_lifecycle();

-- Server-verified authenticated activity refreshes at most once every six hours.
-- A return during the notice window cancels the pending deletion.
create or replace function public.workcraft_record_account_activity(p_user_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare current_status text;
declare deletion_claim timestamptz;
declare deletion_due timestamptz;
begin
  select deletion_status, deletion_claimed_at, deletion_due_at
    into current_status, deletion_claim, deletion_due
  from public.tradeflow_account_lifecycle where user_id = p_user_id for update;
  if current_status = 'deleting' and (deletion_due is null or deletion_due > pg_catalog.now() or deletion_claim is null or deletion_claim >= pg_catalog.now() - interval '1 hour') then
    return 'deleting';
  end if;

  insert into public.tradeflow_account_lifecycle(user_id, last_active_at, deletion_status, notice_claimed_at, notice_sent_at, deletion_due_at, deletion_claimed_at, deletion_reason, updated_at)
  values (p_user_id, pg_catalog.now(), 'active', null, null, null, null, null, pg_catalog.now())
  on conflict (user_id) do update set
    last_active_at = case
      when public.tradeflow_account_lifecycle.deletion_status in ('pending_deletion', 'deleting')
        or public.tradeflow_account_lifecycle.last_active_at < pg_catalog.now() - interval '6 hours'
      then pg_catalog.now() else public.tradeflow_account_lifecycle.last_active_at end,
    deletion_status = 'active', notice_claimed_at = null, notice_sent_at = null,
    deletion_due_at = null, deletion_claimed_at = null, deletion_reason = null,
    updated_at = pg_catalog.now();
  return 'active';
end;
$$;
revoke all on function public.workcraft_record_account_activity(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_record_account_activity(uuid) to service_role;

create or replace function public.workcraft_claim_inactivity_notices(p_limit integer default 50)
returns table(user_id uuid, email text, language text, last_active_at timestamptz, claimed_at timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select l.user_id
    from public.tradeflow_account_lifecycle l
    where l.deletion_status = 'active'
      and l.last_active_at <= pg_catalog.now() - interval '12 months'
      and l.notice_sent_at is null
      and (l.notice_claimed_at is null or l.notice_claimed_at < pg_catalog.now() - interval '1 hour')
      and not exists (select 1 from public.tradeflow_admins a where a.user_id = l.user_id)
    order by l.last_active_at
    for update of l skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.tradeflow_account_lifecycle l
    set notice_claimed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    from candidates c where l.user_id = c.user_id
    returning l.user_id, l.last_active_at, l.notice_claimed_at
  )
  select c.user_id, u.email::text,
    case when u.raw_user_meta_data ->> 'app_language' = 'es' then 'es' else 'en' end,
    c.last_active_at, c.notice_claimed_at
  from claimed c join auth.users u on u.id = c.user_id;
end;
$$;
revoke all on function public.workcraft_claim_inactivity_notices(integer) from public, anon, authenticated;
grant execute on function public.workcraft_claim_inactivity_notices(integer) to service_role;

create or replace function public.workcraft_finish_inactivity_notice(p_user_id uuid, p_claimed_at timestamptz, p_sent boolean)
returns boolean
language plpgsql
set search_path = ''
as $$
declare changed integer;
begin
  if p_sent then
    update public.tradeflow_account_lifecycle
    set deletion_status = 'pending_deletion', notice_sent_at = pg_catalog.now(),
        deletion_due_at = pg_catalog.now() + interval '30 days', notice_claimed_at = null,
        deletion_reason = 'No authenticated app activity for 12 months; 30-day warning sent.', updated_at = pg_catalog.now()
    where user_id = p_user_id and deletion_status = 'active'
      and notice_claimed_at = p_claimed_at
      and last_active_at <= pg_catalog.now() - interval '12 months';
  else
    update public.tradeflow_account_lifecycle set notice_claimed_at = null, updated_at = pg_catalog.now()
    where user_id = p_user_id and deletion_status = 'active' and notice_claimed_at = p_claimed_at;
  end if;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.workcraft_finish_inactivity_notice(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.workcraft_finish_inactivity_notice(uuid, timestamptz, boolean) to service_role;

create or replace function public.workcraft_claim_due_account_deletions(p_limit integer default 25)
returns table(user_id uuid, email text, language text, last_active_at timestamptz, reason text, claimed_at timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select l.user_id
    from public.tradeflow_account_lifecycle l
    where ((l.deletion_status = 'pending_deletion' and l.deletion_due_at <= pg_catalog.now())
      or (l.deletion_status = 'deleting' and l.deletion_due_at <= pg_catalog.now()
        and l.deletion_claimed_at < pg_catalog.now() - interval '1 hour'))
      and l.notice_sent_at is not null
      and l.last_active_at <= pg_catalog.now() - interval '12 months'
      and (l.deletion_claimed_at is null or l.deletion_claimed_at < pg_catalog.now() - interval '1 hour')
      and not exists (select 1 from public.tradeflow_admins a where a.user_id = l.user_id)
    order by l.deletion_due_at
    for update of l skip locked
    limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.tradeflow_account_lifecycle l
    set deletion_status = 'deleting', deletion_claimed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    from candidates c where l.user_id = c.user_id
    returning l.user_id, l.last_active_at, l.deletion_reason, l.deletion_claimed_at
  )
  select c.user_id, u.email::text,
    case when u.raw_user_meta_data ->> 'app_language' = 'es' then 'es' else 'en' end,
    c.last_active_at, c.deletion_reason, c.deletion_claimed_at
  from claimed c join auth.users u on u.id = c.user_id;
end;
$$;
revoke all on function public.workcraft_claim_due_account_deletions(integer) from public, anon, authenticated;
grant execute on function public.workcraft_claim_due_account_deletions(integer) to service_role;

create or replace function public.workcraft_begin_account_deletion(p_user_id uuid, p_reason text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare changed integer;
begin
  if pg_catalog.length(pg_catalog.btrim(p_reason)) < 8 or pg_catalog.length(pg_catalog.btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_DELETION_REASON';
  end if;
  update public.tradeflow_account_lifecycle
  set deletion_status = 'deleting', deletion_claimed_at = pg_catalog.now(), deletion_due_at = null,
      deletion_reason = pg_catalog.btrim(p_reason), updated_at = pg_catalog.now()
  where user_id = p_user_id and deletion_status <> 'deleting';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.workcraft_begin_account_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.workcraft_begin_account_deletion(uuid, text) to service_role;

create or replace function public.workcraft_release_account_deletion(p_user_id uuid, p_keep_pending boolean default false)
returns void
language sql
set search_path = ''
as $$
  update public.tradeflow_account_lifecycle
  set deletion_status = case when p_keep_pending then 'pending_deletion' else 'active' end,
      deletion_claimed_at = null,
      deletion_due_at = case when p_keep_pending then pg_catalog.now() + interval '1 hour' else null end,
      notice_sent_at = case when p_keep_pending then notice_sent_at else null end,
      notice_claimed_at = null,
      updated_at = pg_catalog.now()
  where user_id = p_user_id and deletion_status = 'deleting';
$$;
revoke all on function public.workcraft_release_account_deletion(uuid, boolean) from public, anon, authenticated;
grant execute on function public.workcraft_release_account_deletion(uuid, boolean) to service_role;

-- Estimates contain customer and job PII. Remove them with their owner rather than
-- retaining unowned rows. Payment-ledger rows are cleared before Auth deletion.
alter table public.estimates drop constraint if exists estimates_user_id_fkey;
alter table public.estimates add constraint estimates_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
