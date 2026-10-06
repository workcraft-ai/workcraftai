-- Let contractors update only their estimate status for pipeline reporting.
-- This does not create a customer signature or alter Stripe payment records.
create or replace function public.workcraft_update_estimate_status(
  p_estimate_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_status text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_status, '')));
  v_estimate public.estimates%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if v_status not in ('pending', 'accepted', 'paid', 'declined') then
    raise exception using errcode = '22023', message = 'INVALID_ESTIMATE_STATUS';
  end if;

  select e.* into v_estimate
  from public.estimates e
  where e.id = p_estimate_id and e.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND';
  end if;

  -- A recorded customer approval is immutable: contractors may keep it accepted
  -- or record it paid, but must not erase the approval or relabel it declined.
  if (v_estimate.accepted_at is not null or nullif(pg_catalog.btrim(coalesce(v_estimate.signature_name, '')), '') is not null)
     and v_status not in ('accepted', 'paid') then
    raise exception using errcode = '42501', message = 'SIGNED_APPROVAL_STATUS_LOCKED';
  end if;

  update public.estimates
  set status = v_status,
      updated_at = pg_catalog.now()
  where id = p_estimate_id and user_id = v_user_id;

  return v_status;
end;
$$;

revoke all on function public.workcraft_update_estimate_status(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.workcraft_update_estimate_status(uuid, text) to authenticated;

comment on function public.workcraft_update_estimate_status(uuid, text) is
  'Allows an authenticated estimate owner to update only the estimate status used for reports; does not record customer approval or update Stripe payment records.';
