-- Give each contractor a readable estimate reference while retaining UUIDs
-- for the database and customer proposal URLs. Numbers restart by UTC year.
create schema if not exists private;

create table private.workcraft_estimate_number_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  estimate_year integer not null check (estimate_year between 1900 and 9999),
  last_number bigint not null check (last_number > 0),
  primary key (user_id, estimate_year)
);
alter table private.workcraft_estimate_number_counters enable row level security;
revoke all on private.workcraft_estimate_number_counters from public, anon, authenticated, service_role;

alter table public.estimates add column reference_number text;

with numbered_estimates as (
  select
    e.id,
    e.user_id,
    pg_catalog.date_part('year', coalesce(e.created_at, pg_catalog.now()) at time zone 'UTC')::integer as estimate_year,
    pg_catalog.row_number() over (
      partition by e.user_id, pg_catalog.date_part('year', coalesce(e.created_at, pg_catalog.now()) at time zone 'UTC')
      order by e.created_at nulls last, e.id
    ) as sequence_number
  from public.estimates e
  where e.user_id is not null
)
update public.estimates e
set reference_number = 'WC-' || n.estimate_year::text || '-' || pg_catalog.lpad(n.sequence_number::text, 4, '0')
from numbered_estimates n
where e.id = n.id;

-- Rows retained after an account has been removed have no contractor counter.
-- Keep those customer links identifiable without exposing an owner sequence.
update public.estimates e
set reference_number = 'WC-L-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(e.id::text, '-', ''), 1, 12))
where e.user_id is null;

insert into private.workcraft_estimate_number_counters (user_id, estimate_year, last_number)
select
  e.user_id,
  pg_catalog.date_part('year', coalesce(e.created_at, pg_catalog.now()) at time zone 'UTC')::integer,
  pg_catalog.count(*)::bigint
from public.estimates e
where e.user_id is not null
group by e.user_id, pg_catalog.date_part('year', coalesce(e.created_at, pg_catalog.now()) at time zone 'UTC')::integer;

alter table public.estimates alter column reference_number set not null;
create unique index estimates_user_reference_number_uidx
  on public.estimates (user_id, reference_number)
  where user_id is not null;
create unique index estimates_orphan_reference_number_uidx
  on public.estimates (reference_number)
  where user_id is null;

create or replace function private.workcraft_assign_estimate_reference_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer;
  v_number bigint;
begin
  if tg_op = 'UPDATE' then
    if new.reference_number is distinct from old.reference_number then
      raise exception using errcode = '42501', message = 'ESTIMATE_REFERENCE_NUMBER_IMMUTABLE';
    end if;
    return new;
  end if;

  if new.user_id is null then
    new.reference_number := 'WC-L-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(new.id::text, '-', ''), 1, 12));
    return new;
  end if;

  -- Use database UTC time, not a client-supplied created_at value.
  v_year := pg_catalog.date_part('year', pg_catalog.now() at time zone 'UTC')::integer;
  insert into private.workcraft_estimate_number_counters as counter (user_id, estimate_year, last_number)
  values (new.user_id, v_year, 1)
  on conflict (user_id, estimate_year)
  do update set last_number = counter.last_number + 1
  returning last_number into v_number;

  new.reference_number := 'WC-' || v_year::text || '-' || pg_catalog.lpad(v_number::text, 4, '0');
  return new;
end;
$$;
revoke all on function private.workcraft_assign_estimate_reference_number() from public, anon, authenticated, service_role;

create trigger estimates_assign_reference_number
before insert or update of reference_number on public.estimates
for each row execute function private.workcraft_assign_estimate_reference_number();
