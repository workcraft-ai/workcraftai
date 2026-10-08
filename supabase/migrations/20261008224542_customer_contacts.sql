-- Reusable contractor-owned contacts for estimate creation.
create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 200),
  email text not null default '' check (pg_catalog.length(email) <= 320),
  phone text not null default '' check (pg_catalog.length(phone) <= 80),
  job_address text not null default '' check (pg_catalog.length(job_address) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_contacts_user_name_idx
  on public.customer_contacts (user_id, lower(name));

alter table public.customer_contacts enable row level security;

revoke all on table public.customer_contacts from public, anon;
grant select, insert, update, delete on table public.customer_contacts to authenticated;

create policy "Users read their own customer contacts"
  on public.customer_contacts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their own customer contacts"
  on public.customer_contacts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their own customer contacts"
  on public.customer_contacts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their own customer contacts"
  on public.customer_contacts for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Preserve the existing atomic, owner-scoped conversion path while allowing a
-- fully paid estimate to be scheduled/invoiced if the contractor did not convert
-- it before the customer paid. Job INSERT RLS continues to enforce Pro access.
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
declare
  v_estimate public.estimates%rowtype;
  v_subtotal_cents numeric;
  v_markup_cents numeric;
  v_tax_cents numeric;
  v_total_cents numeric;
  v_job_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED'; end if;
  select e.* into v_estimate from public.estimates e
  where e.id::text = p_estimate_id and e.user_id = v_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'APPROVED_ESTIMATE_NOT_FOUND'; end if;
  if pg_catalog.lower(coalesce(v_estimate.status, '')) not in ('accepted', 'paid') then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_APPROVED';
  end if;
  if v_estimate.converted_job_id is not null then return v_estimate.converted_job_id::uuid; end if;
  if pg_catalog.length(coalesce(p_title, '')) > 200 or pg_catalog.length(coalesce(p_notes, '')) > 5000 then
    raise exception using errcode = '22023', message = 'JOB_DETAILS_TOO_LONG';
  end if;

  if v_estimate.selected_package is not null then
    select pg_catalog.round(nullif(option.value ->> 'total', '')::numeric * 100) into v_subtotal_cents
    from pg_catalog.jsonb_array_elements(coalesce(v_estimate.package_options, '[]'::jsonb)) as option(value)
    where option.value ->> 'name' = v_estimate.selected_package limit 1;
    if v_subtotal_cents is null then raise exception using errcode = '22023', message = 'ACCEPTED_PACKAGE_NOT_FOUND'; end if;
    v_markup_cents := 0;
  else
    select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)), 0) into v_subtotal_cents
    from public.line_items li where li.estimate_id = v_estimate.id;
    v_markup_cents := pg_catalog.round(v_subtotal_cents * coalesce(v_estimate.markup_percentage, 0) / 100);
  end if;
  v_tax_cents := pg_catalog.round((v_subtotal_cents + v_markup_cents) * coalesce(v_estimate.tax_rate, 0) / 100);
  v_total_cents := v_subtotal_cents + v_markup_cents + v_tax_cents;

  insert into public.jobs(
    user_id, estimate_id, title, client_name, client_email, job_address,
    scheduled_at, notes, quoted_total, status
  ) values (
    v_user_id, v_estimate.id::text,
    coalesce(nullif(pg_catalog.btrim(p_title), ''), coalesce(nullif(v_estimate.client_name, ''), 'Customer') || ' job'),
    v_estimate.client_name, v_estimate.client_email, coalesce(v_estimate.job_address, ''),
    p_scheduled_at, coalesce(p_notes, ''), v_total_cents / 100, 'scheduled'
  ) returning id into v_job_id;

  update public.estimates set converted_job_id = v_job_id::text where id = v_estimate.id and user_id = v_user_id;
  return v_job_id;
end;
$$;
revoke all on function public.convert_accepted_estimate_to_job(text, timestamptz, text, text) from public, anon;
grant execute on function public.convert_accepted_estimate_to_job(text, timestamptz, text, text) to authenticated;
