-- Convert an accepted estimate to a job without weakening estimate RLS.
-- The function must lock and update accepted/paid estimates, while the browser
-- UPDATE policy intentionally permits edits only while an estimate is pending.
create or replace function private.workcraft_convert_accepted_estimate_to_job(
  p_estimate_id text,
  p_scheduled_at timestamptz default null,
  p_title text default null,
  p_notes text default ''
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
  v_subtotal_cents numeric;
  v_markup_cents numeric;
  v_tax_cents numeric;
  v_total_cents numeric;
  v_job_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  -- Owner-scope before any privileged reads or writes. FOR UPDATE is required
  -- to keep concurrent conversions atomic and idempotent.
  select e.* into v_estimate
  from public.estimates e
  where e.id::text = p_estimate_id
    and e.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'APPROVED_ESTIMATE_NOT_FOUND';
  end if;
  if not public.workcraft_user_has_pro(v_user_id) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
  end if;
  if pg_catalog.lower(coalesce(v_estimate.status, '')) not in ('accepted', 'paid') then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_APPROVED';
  end if;
  if v_estimate.converted_job_id is not null then
    return v_estimate.converted_job_id::uuid;
  end if;
  if pg_catalog.length(coalesce(p_title, '')) > 200
    or pg_catalog.length(coalesce(p_notes, '')) > 5000 then
    raise exception using errcode = '22023', message = 'JOB_DETAILS_TOO_LONG';
  end if;

  if v_estimate.selected_package is not null then
    select pg_catalog.round(nullif(option.value ->> 'total', '')::numeric * 100)
      into v_subtotal_cents
    from pg_catalog.jsonb_array_elements(coalesce(v_estimate.package_options, '[]'::jsonb)) as option(value)
    where option.value ->> 'name' = v_estimate.selected_package
    limit 1;
    if v_subtotal_cents is null then
      raise exception using errcode = '22023', message = 'ACCEPTED_PACKAGE_NOT_FOUND';
    end if;
    v_markup_cents := 0;
  else
    select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)), 0)
      into v_subtotal_cents
    from public.line_items li
    where li.estimate_id = v_estimate.id;
    v_markup_cents := pg_catalog.round(
      v_subtotal_cents * coalesce(v_estimate.markup_percentage, 0) / 100
    );
  end if;

  v_tax_cents := pg_catalog.round(
    (v_subtotal_cents + v_markup_cents) * coalesce(v_estimate.tax_rate, 0) / 100
  );
  v_total_cents := v_subtotal_cents + v_markup_cents + v_tax_cents;

  insert into public.jobs(
    user_id, estimate_id, title, client_name, client_email, job_address,
    scheduled_at, notes, quoted_total, status
  ) values (
    v_user_id,
    v_estimate.id::text,
    coalesce(
      nullif(pg_catalog.btrim(p_title), ''),
      coalesce(nullif(v_estimate.client_name, ''), 'Customer') || ' job'
    ),
    v_estimate.client_name,
    v_estimate.client_email,
    coalesce(v_estimate.job_address, ''),
    p_scheduled_at,
    coalesce(p_notes, ''),
    v_total_cents / 100,
    'scheduled'
  ) returning id into v_job_id;

  update public.estimates
  set converted_job_id = v_job_id::text
  where id = v_estimate.id
    and user_id = v_user_id;

  return v_job_id;
end;
$$;

revoke all on function private.workcraft_convert_accepted_estimate_to_job(text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function private.workcraft_convert_accepted_estimate_to_job(text, timestamptz, text, text)
  to authenticated;

-- Keep the existing authenticated PostgREST RPC as a security-invoker wrapper.
-- All elevated table work stays behind the helper's explicit auth, owner, and
-- Pro checks; public and anon retain no execute permission.
create or replace function public.convert_accepted_estimate_to_job(
  p_estimate_id text,
  p_scheduled_at timestamptz default null,
  p_title text default null,
  p_notes text default ''
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.workcraft_convert_accepted_estimate_to_job(
    p_estimate_id,
    p_scheduled_at,
    p_title,
    p_notes
  );
end;
$$;

revoke all on function public.convert_accepted_estimate_to_job(text, timestamptz, text, text)
  from public, anon;
grant execute on function public.convert_accepted_estimate_to_job(text, timestamptz, text, text)
  to authenticated;
