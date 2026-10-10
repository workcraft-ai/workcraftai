begin;
alter table public.estimates
 add column share_token_hash text check(share_token_hash is null or share_token_hash ~ '^[0-9a-f]{64}$'),
 add column share_expires_at timestamptz,
 add column share_revoked_at timestamptz;
-- Keep the reusable token encrypted, separate from customer-facing estimate data.
create table private.proposal_share_secrets(
 estimate_id uuid primary key references public.estimates(id) on delete cascade,
 encrypted_token text not null,
 updated_at timestamptz not null default now()
);
alter table private.proposal_share_secrets enable row level security;
revoke all on private.proposal_share_secrets from public,anon,authenticated;
grant all on private.proposal_share_secrets to service_role;
create function public.workcraft_set_proposal_share(p_estimate_id uuid,p_user_id uuid,p_hash text,p_encrypted text,p_expires timestamptz,p_revoke boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.estimates where id=p_estimate_id and user_id=p_user_id for update;
 if not found then return false; end if;
 if p_revoke then
  update public.estimates set share_revoked_at=now() where id=p_estimate_id;
 else
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_encrypted is null or length(p_encrypted)>512 then raise exception 'INVALID_SHARE_TOKEN'; end if;
  update public.estimates set share_token_hash=p_hash,share_expires_at=p_expires,share_revoked_at=null where id=p_estimate_id;
  insert into private.proposal_share_secrets(estimate_id,encrypted_token) values(p_estimate_id,p_encrypted)
  on conflict(estimate_id) do update set encrypted_token=excluded.encrypted_token,updated_at=now();
 end if;
 return true;
end; $$;
revoke all on function public.workcraft_set_proposal_share(uuid,uuid,text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.workcraft_set_proposal_share(uuid,uuid,text,text,timestamptz,boolean) to service_role;
create function public.workcraft_get_proposal_share_secret(p_estimate_id uuid) returns text language sql security definer set search_path='' as $$ select encrypted_token from private.proposal_share_secrets where estimate_id=p_estimate_id $$;
revoke all on function public.workcraft_get_proposal_share_secret(uuid) from public,anon,authenticated;
grant execute on function public.workcraft_get_proposal_share_secret(uuid) to service_role;
commit;
