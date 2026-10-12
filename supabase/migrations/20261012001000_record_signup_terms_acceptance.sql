begin;

-- Keep a server-timestamped record of the policy version submitted at signup.
-- Browser roles cannot read or alter this record after account creation.
create table private.workcraft_terms_acceptances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  policy_version text not null check (length(policy_version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  source text not null default 'signup' check (source = 'signup')
);
alter table private.workcraft_terms_acceptances enable row level security;
revoke all on private.workcraft_terms_acceptances from public, anon, authenticated;
grant usage on schema private to service_role;
grant select on private.workcraft_terms_acceptances to service_role;

create function private.workcraft_record_signup_terms_acceptance()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_user_meta_data ->> 'workcraft_terms_version' = '2026-10-11'
    and new.raw_user_meta_data ->> 'workcraft_terms_accepted' = 'true' then
    insert into private.workcraft_terms_acceptances (user_id, policy_version)
      values (new.id, '2026-10-11') on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.workcraft_record_signup_terms_acceptance() from public, anon, authenticated;
create trigger workcraft_record_signup_terms_acceptance
  after insert on auth.users for each row
  execute function private.workcraft_record_signup_terms_acceptance();

comment on table private.workcraft_terms_acceptances is
  'Server-timestamped signup assent. Client metadata states the checked policy version; the private record is immutable to browser roles.';

commit;
