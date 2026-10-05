-- Failed deletion stages stay claimed for retry; they must never restore a
-- partially cleaned account to the active state.
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
  where user_id = p_user_id
    and (deletion_status <> 'deleting' or deletion_claimed_at < pg_catalog.now() - interval '1 hour');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.workcraft_begin_account_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.workcraft_begin_account_deletion(uuid, text) to service_role;

create or replace function public.workcraft_mark_account_deletion_retryable(p_user_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare changed integer;
begin
  update public.tradeflow_account_lifecycle
  set deletion_status = 'deleting', deletion_due_at = null,
      deletion_claimed_at = pg_catalog.now() - interval '1 hour 1 second', updated_at = pg_catalog.now()
  where user_id = p_user_id and deletion_status = 'deleting';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;
revoke all on function public.workcraft_mark_account_deletion_retryable(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_mark_account_deletion_retryable(uuid) to service_role;

create or replace function public.workcraft_claim_failed_account_deletions(p_limit integer default 10)
returns table(user_id uuid, email text, language text, last_active_at timestamptz, reason text, claimed_at timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select l.user_id
    from public.tradeflow_account_lifecycle l
    where l.deletion_status = 'deleting'
      and l.deletion_due_at is null
      and l.deletion_claimed_at < pg_catalog.now() - interval '1 hour'
      and not exists (select 1 from public.tradeflow_admins a where a.user_id = l.user_id)
    order by l.deletion_claimed_at
    for update of l skip locked
    limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.tradeflow_account_lifecycle l
    set deletion_claimed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    from candidates c where l.user_id = c.user_id
    returning l.user_id, l.last_active_at, l.deletion_reason, l.deletion_claimed_at
  )
  select c.user_id, u.email::text,
    case when u.raw_user_meta_data ->> 'app_language' = 'es' then 'es' else 'en' end,
    c.last_active_at, c.deletion_reason, c.deletion_claimed_at
  from claimed c join auth.users u on u.id = c.user_id;
end;
$$;
revoke all on function public.workcraft_claim_failed_account_deletions(integer) from public, anon, authenticated;
grant execute on function public.workcraft_claim_failed_account_deletions(integer) to service_role;

-- Keep proposal acceptance immutable and retain the accepted commercial terms.
create table if not exists public.estimate_acceptances (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null unique references public.estimates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  signature_name text not null check (length(signature_name) between 2 and 120),
  selected_package text,
  accepted_total_cents bigint not null check (accepted_total_cents >= 0),
  accepted_at timestamptz not null default now(),
  proposal_snapshot jsonb not null
);
alter table public.estimate_acceptances enable row level security;
revoke all on public.estimate_acceptances from public, anon, authenticated;
grant all on public.estimate_acceptances to service_role;

create or replace function public.workcraft_accept_estimate_once(
  p_estimate_id uuid,
  p_signature_name text,
  p_selected_package text default null
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
  v_selected jsonb;
  v_subtotal numeric;
  v_markup numeric;
  v_tax numeric;
  v_total_cents bigint;
  v_accepted_at timestamptz := pg_catalog.now();
  v_rows integer;
begin
  if p_signature_name is null or pg_catalog.length(pg_catalog.btrim(p_signature_name)) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'INVALID_SIGNATURE_NAME';
  end if;

  select e.* into v_estimate
  from public.estimates e where e.id = p_estimate_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND'; end if;
  if pg_catalog.lower(coalesce(v_estimate.status, 'pending')) <> 'pending' then
    if exists (
      select 1 from public.estimate_acceptances a
      where a.estimate_id = p_estimate_id
        and a.signature_name = pg_catalog.btrim(p_signature_name)
        and a.selected_package is not distinct from p_selected_package
    ) then
      select a.accepted_total_cents into v_total_cents
      from public.estimate_acceptances a where a.estimate_id = p_estimate_id;
      return v_total_cents;
    end if;
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_OPEN';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(v_estimate.package_options, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_PACKAGE_OPTIONS';
  end if;
  if pg_catalog.jsonb_array_length(coalesce(v_estimate.package_options, '[]'::jsonb)) > 0 then
    if p_selected_package is null then
      raise exception using errcode = '22023', message = 'PACKAGE_SELECTION_REQUIRED';
    end if;
    select packages.value into v_selected
    from pg_catalog.jsonb_array_elements(coalesce(v_estimate.package_options, '[]'::jsonb)) as packages(value)
    where packages.value ->> 'name' = p_selected_package
    limit 1;
    if v_selected is null then raise exception using errcode = '22023', message = 'INVALID_PACKAGE_SELECTION'; end if;
    v_subtotal := pg_catalog.round((v_selected ->> 'total')::numeric * 100) / 100;
    v_markup := 0;
  else
    if p_selected_package is not null then
      raise exception using errcode = '22023', message = 'INVALID_PACKAGE_SELECTION';
    end if;
    select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)) / 100, 0) into v_subtotal
    from public.line_items li where li.estimate_id = p_estimate_id;
    v_markup := pg_catalog.round(v_subtotal * coalesce(v_estimate.markup_percentage, 0)) / 100;
  end if;
  v_tax := pg_catalog.round((v_subtotal + v_markup) * coalesce(v_estimate.tax_rate, 0)) / 100;
  v_total_cents := pg_catalog.round((v_subtotal + v_markup + v_tax) * 100)::bigint;

  update public.estimates
  set signature_name = pg_catalog.btrim(p_signature_name),
      selected_package = p_selected_package,
      accepted_at = v_accepted_at,
      status = 'accepted',
      updated_at = v_accepted_at
  where id = p_estimate_id and status = v_estimate.status;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_OPEN'; end if;

  insert into public.estimate_acceptances(estimate_id, user_id, signature_name, selected_package, accepted_total_cents, accepted_at, proposal_snapshot)
  values (
    p_estimate_id, v_estimate.user_id, pg_catalog.btrim(p_signature_name), p_selected_package, v_total_cents, v_accepted_at,
    pg_catalog.jsonb_build_object(
      'estimate_id', p_estimate_id,
      'client_name', v_estimate.client_name,
      'job_address', v_estimate.job_address,
      'tax_rate', v_estimate.tax_rate,
      'markup_percentage', v_estimate.markup_percentage,
      'selected_package', p_selected_package,
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'description', li.description, 'description_es', li.description_es,
        'quantity', li.quantity, 'unit_price', li.unit_price
      ) order by li.id) from public.line_items li where li.estimate_id = p_estimate_id), '[]'::jsonb)
    )
  );
  return v_total_cents;
end;
$$;
revoke all on function public.workcraft_accept_estimate_once(uuid, text, text) from public, anon, authenticated;
grant execute on function public.workcraft_accept_estimate_once(uuid, text, text) to service_role;

create or replace function public.workcraft_valid_package_options(p_options jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_option jsonb;
  v_total numeric;
  v_count integer;
  v_unique_names integer;
begin
  if p_options is null or p_options = 'null'::jsonb then return true; end if;
  if pg_catalog.jsonb_typeof(p_options) <> 'array' then return false; end if;
  v_count := pg_catalog.jsonb_array_length(p_options);
  if v_count > 3 then return false; end if;
  select count(distinct x.value ->> 'name') into v_unique_names
  from pg_catalog.jsonb_array_elements(p_options) as x(value);
  if v_count <> v_unique_names then return false; end if;
  for v_option in select x.value from pg_catalog.jsonb_array_elements(p_options) as x(value)
  loop
    if pg_catalog.jsonb_typeof(v_option) <> 'object'
      or v_option ->> 'name' not in ('Good', 'Better', 'Best')
      or pg_catalog.length(coalesce(v_option ->> 'description', '')) > 500
      or pg_catalog.length(coalesce(v_option ->> 'description_es', '')) > 500
      or not (v_option ->> 'total' ~ '^[0-9]{1,9}(\.[0-9]{1,2})?$') then
      return false;
    end if;
    v_total := (v_option ->> 'total')::numeric;
    if v_total < 0 or v_total > 100000000 then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function public.workcraft_valid_package_options(jsonb) from public, anon;
grant execute on function public.workcraft_valid_package_options(jsonb) to authenticated, service_role;

-- A user-facing estimate and its line items are written in one transaction.
create or replace function public.workcraft_create_estimate_with_items(p_estimate jsonb, p_line_items jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate_id uuid;
  v_item record;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  if p_line_items is null or pg_catalog.jsonb_typeof(p_line_items) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  if pg_catalog.jsonb_array_length(p_line_items) < 1 or pg_catalog.jsonb_array_length(p_line_items) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  for v_item in select * from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit_price numeric)
  loop
    if v_item.description is null or pg_catalog.length(pg_catalog.btrim(v_item.description)) < 1 or pg_catalog.length(v_item.description) > 240
      or v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity > 100000
      or v_item.unit_price is null or v_item.unit_price < 0 or v_item.unit_price > 100000000
      or (v_item.description_es is not null and pg_catalog.length(v_item.description_es) > 240) then
      raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
    end if;
  end loop;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_name', ''))) not between 1 and 200
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', ''))) not between 3 and 320
    or pg_catalog.length(coalesce(p_estimate ->> 'client_phone', '')) > 80
    or pg_catalog.length(coalesce(p_estimate ->> 'job_address', '')) > 500
    or coalesce((p_estimate ->> 'deposit_percentage')::numeric, 0) not between 0 and 100
    or coalesce((p_estimate ->> 'tax_rate')::numeric, 0) not between 0 and 100
    or coalesce((p_estimate ->> 'markup_percentage')::numeric, 0) not between 0 and 500
    or not public.workcraft_valid_package_options(p_estimate -> 'package_options') then
    raise exception using errcode = '22023', message = 'INVALID_ESTIMATE';
  end if;

  insert into public.estimates (
    user_id, client_name, client_email, client_phone, job_address, trade,
    require_deposit, deposit_percentage, package_options, tax_rate, markup_percentage,
    proposal_language, status
  ) values (
    v_user_id,
    pg_catalog.btrim(p_estimate ->> 'client_name'),
    pg_catalog.btrim(p_estimate ->> 'client_email'),
    nullif(pg_catalog.btrim(p_estimate ->> 'client_phone'), ''),
    nullif(pg_catalog.btrim(p_estimate ->> 'job_address'), ''),
    left(coalesce(p_estimate ->> 'trade', 'General'), 80),
    coalesce((p_estimate ->> 'require_deposit')::boolean, false),
    coalesce((p_estimate ->> 'deposit_percentage')::numeric, 20),
    case when pg_catalog.jsonb_typeof(p_estimate -> 'package_options') = 'array' then p_estimate -> 'package_options' else '[]'::jsonb end,
    coalesce((p_estimate ->> 'tax_rate')::numeric, 0),
    coalesce((p_estimate ->> 'markup_percentage')::numeric, 0),
    case when p_estimate ->> 'proposal_language' = 'es' then 'es' else 'en' end,
    'pending'
  ) returning id into v_estimate_id;

  insert into public.line_items(estimate_id, description, description_es, quantity, unit_price)
  select v_estimate_id, pg_catalog.btrim(x.description), nullif(pg_catalog.btrim(x.description_es), ''), x.quantity, x.unit_price
  from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit_price numeric);
  return v_estimate_id;
end;
$$;
revoke all on function public.workcraft_create_estimate_with_items(jsonb, jsonb) from public, anon;
grant execute on function public.workcraft_create_estimate_with_items(jsonb, jsonb) to authenticated;

create or replace function public.workcraft_replace_estimate_with_items(p_estimate_id uuid, p_estimate jsonb, p_line_items jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.estimates%rowtype;
  v_item record;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  if p_line_items is null or pg_catalog.jsonb_typeof(p_line_items) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  if pg_catalog.jsonb_array_length(p_line_items) < 1 or pg_catalog.jsonb_array_length(p_line_items) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  for v_item in select * from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit_price numeric)
  loop
    if v_item.description is null or pg_catalog.length(pg_catalog.btrim(v_item.description)) < 1 or pg_catalog.length(v_item.description) > 240
      or v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity > 100000
      or v_item.unit_price is null or v_item.unit_price < 0 or v_item.unit_price > 100000000
      or (v_item.description_es is not null and pg_catalog.length(v_item.description_es) > 240) then
      raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
    end if;
  end loop;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_name', ''))) not between 1 and 200
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', ''))) not between 3 and 320
    or pg_catalog.length(coalesce(p_estimate ->> 'client_phone', '')) > 80
    or pg_catalog.length(coalesce(p_estimate ->> 'job_address', '')) > 500
    or coalesce((p_estimate ->> 'deposit_percentage')::numeric, 0) not between 0 and 100
    or coalesce((p_estimate ->> 'tax_rate')::numeric, 0) not between 0 and 100
    or coalesce((p_estimate ->> 'markup_percentage')::numeric, 0) not between 0 and 500
    or not public.workcraft_valid_package_options(p_estimate -> 'package_options') then
    raise exception using errcode = '22023', message = 'INVALID_ESTIMATE';
  end if;

  select e.* into v_existing from public.estimates e
  where e.id = p_estimate_id and e.user_id = v_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND'; end if;
  if pg_catalog.lower(coalesce(v_existing.status, 'pending')) <> 'pending' then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_EDITABLE';
  end if;

  update public.estimates set
    client_name = pg_catalog.btrim(p_estimate ->> 'client_name'),
    client_email = pg_catalog.btrim(p_estimate ->> 'client_email'),
    client_phone = nullif(pg_catalog.btrim(p_estimate ->> 'client_phone'), ''),
    job_address = nullif(pg_catalog.btrim(p_estimate ->> 'job_address'), ''),
    trade = left(coalesce(p_estimate ->> 'trade', v_existing.trade), 80),
    require_deposit = coalesce((p_estimate ->> 'require_deposit')::boolean, v_existing.require_deposit),
    deposit_percentage = coalesce((p_estimate ->> 'deposit_percentage')::numeric, v_existing.deposit_percentage),
    package_options = case when pg_catalog.jsonb_typeof(p_estimate -> 'package_options') = 'array' then p_estimate -> 'package_options' else '[]'::jsonb end,
    tax_rate = coalesce((p_estimate ->> 'tax_rate')::numeric, v_existing.tax_rate),
    markup_percentage = coalesce((p_estimate ->> 'markup_percentage')::numeric, v_existing.markup_percentage),
    proposal_language = case when p_estimate ->> 'proposal_language' = 'es' then 'es' else 'en' end,
    selected_package = null, signature_name = null, accepted_at = null,
    updated_at = pg_catalog.now()
  where id = p_estimate_id and user_id = v_user_id and lower(coalesce(status, 'pending')) = 'pending';
  delete from public.line_items where estimate_id = p_estimate_id;
  insert into public.line_items(estimate_id, description, description_es, quantity, unit_price)
  select p_estimate_id, pg_catalog.btrim(x.description), nullif(pg_catalog.btrim(x.description_es), ''), x.quantity, x.unit_price
  from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit_price numeric);
end;
$$;
revoke all on function public.workcraft_replace_estimate_with_items(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.workcraft_replace_estimate_with_items(uuid, jsonb, jsonb) to authenticated;

-- Browser writes can only mutate pending estimates; privileged API/webhook writes
-- continue through service_role. The transactional RPCs above are the supported path.
drop policy if exists "Contractors manage their own estimates" on public.estimates;
create policy "Contractors read their own estimates" on public.estimates for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Contractors create pending estimates" on public.estimates for insert to authenticated
  with check ((select auth.uid()) = user_id and lower(coalesce(status, 'pending')) = 'pending');
create policy "Contractors update pending estimates" on public.estimates for update to authenticated
  using ((select auth.uid()) = user_id and lower(coalesce(status, 'pending')) = 'pending')
  with check ((select auth.uid()) = user_id and lower(coalesce(status, 'pending')) = 'pending');
create policy "Contractors delete pending estimates" on public.estimates for delete to authenticated
  using ((select auth.uid()) = user_id and lower(coalesce(status, 'pending')) = 'pending');

drop policy if exists "Contractors manage line items for their estimates" on public.line_items;
create policy "Contractors read line items for their estimates" on public.line_items for select to authenticated
  using (exists (select 1 from public.estimates e where e.id = line_items.estimate_id and e.user_id = (select auth.uid())));
create policy "Contractors insert line items for pending estimates" on public.line_items for insert to authenticated
  with check (exists (select 1 from public.estimates e where e.id = line_items.estimate_id and e.user_id = (select auth.uid()) and lower(coalesce(e.status, 'pending')) = 'pending'));
create policy "Contractors update line items for pending estimates" on public.line_items for update to authenticated
  using (exists (select 1 from public.estimates e where e.id = line_items.estimate_id and e.user_id = (select auth.uid()) and lower(coalesce(e.status, 'pending')) = 'pending'))
  with check (exists (select 1 from public.estimates e where e.id = line_items.estimate_id and e.user_id = (select auth.uid()) and lower(coalesce(e.status, 'pending')) = 'pending'));
create policy "Contractors delete line items for pending estimates" on public.line_items for delete to authenticated
  using (exists (select 1 from public.estimates e where e.id = line_items.estimate_id and e.user_id = (select auth.uid()) and lower(coalesce(e.status, 'pending')) = 'pending'));

create or replace function public.workcraft_validate_line_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estimate_id uuid;
  v_status text;
  v_existing_total_cents numeric;
begin
  v_estimate_id := case when tg_op = 'DELETE' then old.estimate_id else new.estimate_id end;
  select e.status into v_status from public.estimates e where e.id = v_estimate_id for update;
  if not found then raise exception using errcode = '23503', message = 'ESTIMATE_NOT_FOUND'; end if;
  if current_setting('request.jwt.claim.role', true) = 'authenticated' and pg_catalog.lower(coalesce(v_status, 'pending')) <> 'pending' then
    raise exception using errcode = '42501', message = 'ESTIMATE_NOT_EDITABLE';
  end if;
  if tg_op <> 'DELETE' then
    if new.description is null or pg_catalog.length(pg_catalog.btrim(new.description)) not between 1 and 240
      or new.quantity is null or new.quantity <= 0 or new.quantity > 100000
      or new.unit_price is null or new.unit_price < 0 or new.unit_price > 100000000
      or (new.description_es is not null and pg_catalog.length(new.description_es) > 240) then
      raise exception using errcode = '22023', message = 'INVALID_LINE_ITEM';
    end if;
    if tg_op = 'UPDATE' then
      select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)), 0) into v_existing_total_cents
      from public.line_items li where li.estimate_id = v_estimate_id and li.id <> old.id;
    else
      select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)), 0) into v_existing_total_cents
      from public.line_items li where li.estimate_id = v_estimate_id;
    end if;
    if v_existing_total_cents + pg_catalog.round(new.quantity * new.unit_price * 100) > 100000000000 then
      raise exception using errcode = '22023', message = 'ESTIMATE_TOTAL_TOO_LARGE';
    end if;
    return new;
  end if;
  return old;
end;
$$;
revoke all on function public.workcraft_validate_line_item() from public, anon, authenticated;
drop trigger if exists workcraft_validate_line_item on public.line_items;
create trigger workcraft_validate_line_item before insert or update or delete on public.line_items
for each row execute function public.workcraft_validate_line_item();
