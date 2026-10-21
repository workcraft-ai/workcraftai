begin;

-- Keep a contractor's account of a conversation distinct from a customer's
-- signed approval. Existing acceptances were recorded through the customer link.
alter table public.estimate_acceptances
  alter column signature_name drop not null,
  add column approval_method text not null default 'customer_online'
    check (approval_method in ('customer_online', 'contractor_verbal')),
  add column recorded_by uuid references auth.users(id),
  add column verbal_contact_name text,
  add column verbal_note text,
  add constraint estimate_acceptance_method_details check (
    (approval_method = 'customer_online' and signature_name is not null
      and recorded_by is null and verbal_contact_name is null and verbal_note is null)
    or
    (approval_method = 'contractor_verbal' and signature_name is null
      and recorded_by is not null and recorded_by = user_id
      and verbal_contact_name is not null
      and length(btrim(verbal_contact_name)) between 2 and 120
      and (verbal_note is null or length(verbal_note) <= 500))
  );

create function private.workcraft_record_verbal_estimate_approval(
  p_estimate_id uuid,
  p_contact_name text,
  p_selected_package text default null,
  p_note text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := (select auth.uid());
  v_estimate public.estimates%rowtype;
  v_selected jsonb;
  v_subtotal numeric;
  v_markup numeric;
  v_tax numeric;
  v_total_cents bigint;
  v_approved_at timestamptz := pg_catalog.now();
begin
  if v_owner is null or not auth_gate.mfa_session_allowed() then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_contact_name is null or pg_catalog.length(pg_catalog.btrim(p_contact_name)) not between 2 and 120
     or (p_note is not null and pg_catalog.length(p_note) > 500) then
    raise exception using errcode = '22023', message = 'INVALID_APPROVAL_DETAILS';
  end if;

  select e.* into v_estimate from public.estimates e
  where e.id = p_estimate_id and e.user_id = v_owner for update;
  if not found then raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND'; end if;
  if pg_catalog.lower(coalesce(v_estimate.status, 'pending')) <> 'pending'
     or exists (select 1 from public.estimate_acceptances a where a.estimate_id = p_estimate_id) then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_OPEN';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(v_estimate.package_options, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_PACKAGE_OPTIONS';
  end if;
  if pg_catalog.jsonb_array_length(coalesce(v_estimate.package_options, '[]'::jsonb)) > 0 then
    if p_selected_package is null then
      raise exception using errcode = '22023', message = 'PACKAGE_SELECTION_REQUIRED';
    end if;
    select item.value into v_selected
    from pg_catalog.jsonb_array_elements(v_estimate.package_options) as item(value)
    where item.value ->> 'name' = p_selected_package limit 1;
    if v_selected is null then
      raise exception using errcode = '22023', message = 'INVALID_PACKAGE_SELECTION';
    end if;
    v_subtotal := pg_catalog.round((v_selected ->> 'total')::numeric * 100) / 100;
    v_markup := 0;
  else
    if p_selected_package is not null then
      raise exception using errcode = '22023', message = 'INVALID_PACKAGE_SELECTION';
    end if;
    select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)) / 100, 0)
      into v_subtotal from public.line_items li where li.estimate_id = p_estimate_id;
    v_markup := pg_catalog.round(v_subtotal * coalesce(v_estimate.markup_percentage, 0)) / 100;
  end if;
  v_tax := pg_catalog.round((v_subtotal + v_markup) * coalesce(v_estimate.tax_rate, 0)) / 100;
  v_total_cents := pg_catalog.round((v_subtotal + v_markup + v_tax) * 100)::bigint;

  update public.estimates
  set signature_name = null, selected_package = p_selected_package,
      accepted_at = v_approved_at, status = 'accepted', updated_at = v_approved_at
  where id = p_estimate_id;

  insert into public.estimate_acceptances (
    estimate_id, user_id, signature_name, selected_package, accepted_total_cents,
    accepted_at, proposal_snapshot, approval_method, recorded_by,
    verbal_contact_name, verbal_note
  ) values (
    p_estimate_id, v_owner, null, p_selected_package, v_total_cents,
    v_approved_at,
    pg_catalog.jsonb_build_object(
      'estimate_id', p_estimate_id,
      'client_name', v_estimate.client_name,
      'job_address', v_estimate.job_address,
      'tax_rate', v_estimate.tax_rate,
      'markup_percentage', v_estimate.markup_percentage,
      'selected_package', p_selected_package,
      'proposal_display_mode', v_estimate.proposal_display_mode,
      'proposal_summary', v_estimate.proposal_summary,
      'approval_method', 'contractor_verbal',
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'description', li.description, 'description_es', li.description_es,
        'quantity', li.quantity, 'unit', li.unit, 'unit_price', li.unit_price
      ) order by li.id) from public.line_items li where li.estimate_id = p_estimate_id), '[]'::jsonb)
    ),
    'contractor_verbal', v_owner, pg_catalog.btrim(p_contact_name),
    nullif(pg_catalog.btrim(coalesce(p_note, '')), '')
  );
  return v_total_cents;
end;
$$;

revoke all on function private.workcraft_record_verbal_estimate_approval(uuid, text, text, text) from public, anon;
grant execute on function private.workcraft_record_verbal_estimate_approval(uuid, text, text, text) to authenticated;

create function public.workcraft_record_verbal_estimate_approval(
  p_estimate_id uuid,
  p_contact_name text,
  p_selected_package text default null,
  p_note text default null
) returns bigint
language sql security invoker set search_path = '' as $$
  select private.workcraft_record_verbal_estimate_approval(
    p_estimate_id, p_contact_name, p_selected_package, p_note
  );
$$;
revoke all on function public.workcraft_record_verbal_estimate_approval(uuid, text, text, text) from public, anon;
grant execute on function public.workcraft_record_verbal_estimate_approval(uuid, text, text, text) to authenticated;

commit;
