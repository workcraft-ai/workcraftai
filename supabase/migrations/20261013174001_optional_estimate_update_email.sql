begin;

-- Email is optional when saving a shareable estimate; email delivery still requires an address.
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
    or (pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', ''))) > 0
      and (pg_catalog.length(pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', ''))) > 320
        or pg_catalog.btrim(coalesce(p_estimate ->> 'client_email', '')) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
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
    client_email = coalesce(pg_catalog.btrim(p_estimate ->> 'client_email'), ''),
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

commit;
