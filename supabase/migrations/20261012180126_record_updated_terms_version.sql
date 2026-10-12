begin;

-- Record the revised Terms and Privacy Policy version for new account signups.
-- Existing acceptance rows retain their original version and timestamp.
create or replace function private.workcraft_record_signup_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_user_meta_data ->> 'workcraft_terms_version' = '2026-10-12'
    and new.raw_user_meta_data ->> 'workcraft_terms_accepted' = 'true' then
    insert into private.workcraft_terms_acceptances (user_id, policy_version)
      values (new.id, '2026-10-12')
      on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.workcraft_record_signup_terms_acceptance() from public, anon, authenticated;
grant execute on function private.workcraft_record_signup_terms_acceptance() to service_role;

commit;
