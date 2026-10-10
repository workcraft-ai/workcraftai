alter table public.estimates
  add column if not exists proposal_display_mode text not null default 'detailed',
  add column if not exists proposal_summary text;

alter table public.estimates
  drop constraint if exists estimates_proposal_display_mode_check,
  add constraint estimates_proposal_display_mode_check
    check (proposal_display_mode in ('detailed', 'summary')),
  drop constraint if exists estimates_proposal_summary_length_check,
  add constraint estimates_proposal_summary_length_check
    check (proposal_summary is null or char_length(proposal_summary) <= 1200);

alter table public.line_items
  add column if not exists unit text not null default 'each';

alter table public.line_items
  drop constraint if exists line_items_unit_length_check,
  add constraint line_items_unit_length_check
    check (char_length(btrim(unit)) between 1 and 40);

create or replace function public.workcraft_create_estimate_with_items(p_estimate jsonb, p_line_items jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate_id uuid;
  v_item record;
  v_display_mode text := coalesce(p_estimate ->> 'proposal_display_mode', 'detailed');
  v_summary text := nullif(pg_catalog.btrim(coalesce(p_estimate ->> 'proposal_summary', '')), '');
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  if p_line_items is null or pg_catalog.jsonb_typeof(p_line_items) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  if pg_catalog.jsonb_array_length(p_line_items) < 1 or pg_catalog.jsonb_array_length(p_line_items) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  for v_item in select * from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit text, unit_price numeric)
  loop
    if v_item.description is null or pg_catalog.length(pg_catalog.btrim(v_item.description)) < 1 or pg_catalog.length(v_item.description) > 240
      or v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity > 100000
      or v_item.unit_price is null or v_item.unit_price < 0 or v_item.unit_price > 100000000
      or (v_item.description_es is not null and pg_catalog.length(v_item.description_es) > 240)
      or (v_item.unit is not null and pg_catalog.length(pg_catalog.btrim(v_item.unit)) > 40) then
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
    or v_display_mode not in ('detailed', 'summary')
    or (v_summary is not null and pg_catalog.length(v_summary) > 1200)
    or (v_display_mode = 'summary' and v_summary is null)
    or not public.workcraft_valid_package_options(p_estimate -> 'package_options') then
    raise exception using errcode = '22023', message = 'INVALID_ESTIMATE';
  end if;

  insert into public.estimates (
    user_id, client_name, client_email, client_phone, job_address, trade,
    require_deposit, deposit_percentage, package_options, tax_rate, markup_percentage,
    proposal_language, proposal_display_mode, proposal_summary, status
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
    v_display_mode,
    v_summary,
    'pending'
  ) returning id into v_estimate_id;

  insert into public.line_items(estimate_id, description, description_es, quantity, unit, unit_price)
  select v_estimate_id, pg_catalog.btrim(x.description), nullif(pg_catalog.btrim(x.description_es), ''), x.quantity,
    coalesce(nullif(pg_catalog.btrim(x.unit), ''), 'each'), x.unit_price
  from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit text, unit_price numeric);
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
  v_display_mode text;
  v_summary text;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  if p_line_items is null or pg_catalog.jsonb_typeof(p_line_items) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  if pg_catalog.jsonb_array_length(p_line_items) < 1 or pg_catalog.jsonb_array_length(p_line_items) > 100 then
    raise exception using errcode = '22023', message = 'INVALID_LINE_ITEMS';
  end if;
  for v_item in select * from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit text, unit_price numeric)
  loop
    if v_item.description is null or pg_catalog.length(pg_catalog.btrim(v_item.description)) < 1 or pg_catalog.length(v_item.description) > 240
      or v_item.quantity is null or v_item.quantity <= 0 or v_item.quantity > 100000
      or v_item.unit_price is null or v_item.unit_price < 0 or v_item.unit_price > 100000000
      or (v_item.description_es is not null and pg_catalog.length(v_item.description_es) > 240)
      or (v_item.unit is not null and pg_catalog.length(pg_catalog.btrim(v_item.unit)) > 40) then
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
  v_display_mode := coalesce(p_estimate ->> 'proposal_display_mode', v_existing.proposal_display_mode, 'detailed');
  v_summary := case
    when p_estimate ? 'proposal_summary' then nullif(pg_catalog.btrim(coalesce(p_estimate ->> 'proposal_summary', '')), '')
    else v_existing.proposal_summary
  end;
  if v_display_mode not in ('detailed', 'summary') or (v_summary is not null and pg_catalog.length(v_summary) > 1200)
    or (v_display_mode = 'summary' and v_summary is null) then
    raise exception using errcode = '22023', message = 'INVALID_ESTIMATE';
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
    proposal_display_mode = v_display_mode,
    proposal_summary = v_summary,
    selected_package = null, signature_name = null, accepted_at = null,
    updated_at = pg_catalog.now()
  where id = p_estimate_id and user_id = v_user_id and lower(coalesce(status, 'pending')) = 'pending';
  delete from public.line_items where estimate_id = p_estimate_id;
  insert into public.line_items(estimate_id, description, description_es, quantity, unit, unit_price)
  select p_estimate_id, pg_catalog.btrim(x.description), nullif(pg_catalog.btrim(x.description_es), ''), x.quantity,
    coalesce(nullif(pg_catalog.btrim(x.unit), ''), 'each'), x.unit_price
  from pg_catalog.jsonb_to_recordset(p_line_items) as x(description text, description_es text, quantity numeric, unit text, unit_price numeric);
end;
$$;
revoke all on function public.workcraft_replace_estimate_with_items(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.workcraft_replace_estimate_with_items(uuid, jsonb, jsonb) to authenticated;

-- Preserve the displayed quote format and measurement units in the signed acceptance snapshot.
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

  select e.* into v_estimate from public.estimates e where e.id = p_estimate_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND'; end if;
  if pg_catalog.lower(coalesce(v_estimate.status, 'pending')) <> 'pending' then
    if exists (
      select 1 from public.estimate_acceptances a
      where a.estimate_id = p_estimate_id
        and a.signature_name = pg_catalog.btrim(p_signature_name)
        and a.selected_package is not distinct from p_selected_package
    ) then
      select a.accepted_total_cents into v_total_cents from public.estimate_acceptances a where a.estimate_id = p_estimate_id;
      return v_total_cents;
    end if;
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_OPEN';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(v_estimate.package_options, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_PACKAGE_OPTIONS';
  end if;
  if pg_catalog.jsonb_array_length(coalesce(v_estimate.package_options, '[]'::jsonb)) > 0 then
    if p_selected_package is null then raise exception using errcode = '22023', message = 'PACKAGE_SELECTION_REQUIRED'; end if;
    select packages.value into v_selected
    from pg_catalog.jsonb_array_elements(coalesce(v_estimate.package_options, '[]'::jsonb)) as packages(value)
    where packages.value ->> 'name' = p_selected_package limit 1;
    if v_selected is null then raise exception using errcode = '22023', message = 'INVALID_PACKAGE_SELECTION'; end if;
    v_subtotal := pg_catalog.round((v_selected ->> 'total')::numeric * 100) / 100;
    v_markup := 0;
  else
    if p_selected_package is not null then raise exception using errcode = '22023', message = 'INVALID_PACKAGE_SELECTION'; end if;
    select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)) / 100, 0) into v_subtotal
    from public.line_items li where li.estimate_id = p_estimate_id;
    v_markup := pg_catalog.round(v_subtotal * coalesce(v_estimate.markup_percentage, 0)) / 100;
  end if;
  v_tax := pg_catalog.round((v_subtotal + v_markup) * coalesce(v_estimate.tax_rate, 0)) / 100;
  v_total_cents := pg_catalog.round((v_subtotal + v_markup + v_tax) * 100)::bigint;

  update public.estimates
  set signature_name = pg_catalog.btrim(p_signature_name), selected_package = p_selected_package,
      accepted_at = v_accepted_at, status = 'accepted', updated_at = v_accepted_at
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
      'proposal_display_mode', v_estimate.proposal_display_mode,
      'proposal_summary', v_estimate.proposal_summary,
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'description', li.description, 'description_es', li.description_es,
        'quantity', li.quantity, 'unit', li.unit, 'unit_price', li.unit_price
      ) order by li.id) from public.line_items li where li.estimate_id = p_estimate_id), '[]'::jsonb)
    )
  );
  return v_total_cents;
end;
$$;
revoke all on function public.workcraft_accept_estimate_once(uuid, text, text) from public, anon, authenticated;
grant execute on function public.workcraft_accept_estimate_once(uuid, text, text) to service_role;
