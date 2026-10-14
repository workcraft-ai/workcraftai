begin;

-- Email is optional when saving a shareable estimate; email delivery still requires an address.
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
    or (pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', ''))) > 0
      and (pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', ''))) > 320
        or pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', '')) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
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
    coalesce(pg_catalog.btrim(p_estimate ->> 'client_email'), ''),
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

commit;
