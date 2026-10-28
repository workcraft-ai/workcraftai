-- Archiving is a presentation preference, not an edit to an approved quote.
-- Keep the normal update policy restricted to pending estimates.
create or replace function public.workcraft_set_estimate_archived(p_estimate_id uuid, p_archived boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or p_estimate_id is null or p_archived is null
    or not (select auth_gate.mfa_session_allowed()) then
    return false;
  end if;
  update public.estimates
  set is_archived = p_archived
  where id = p_estimate_id and user_id = (select auth.uid());
  return found;
end;
$$;
revoke all on function public.workcraft_set_estimate_archived(uuid, boolean) from public, anon, authenticated;
grant execute on function public.workcraft_set_estimate_archived(uuid, boolean) to authenticated;
