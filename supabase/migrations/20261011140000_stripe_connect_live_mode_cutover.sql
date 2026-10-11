-- Keep test-mode Connect records while allowing contractors to establish a
-- separate live connection after the platform changes Stripe environments.
alter table public.stripe_connected_accounts
  add column if not exists stripe_livemode boolean not null default false;

create table if not exists public.stripe_connected_account_replacements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  old_stripe_account_id text not null,
  old_stripe_livemode boolean not null,
  new_stripe_account_id text not null,
  new_stripe_livemode boolean not null,
  replaced_at timestamptz not null default now(),
  unique (user_id, old_stripe_account_id, new_stripe_account_id)
);
alter table public.stripe_connected_account_replacements enable row level security;
revoke all on public.stripe_connected_account_replacements from public, anon, authenticated;
grant all on public.stripe_connected_account_replacements to service_role;

create or replace function public.workcraft_replace_connected_stripe_account(
  p_user_id uuid,
  p_old_account_id text,
  p_old_livemode boolean,
  p_new_account_id text,
  p_new_livemode boolean,
  p_charges_enabled boolean,
  p_requirements_due boolean
) returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  v_saved public.stripe_connected_accounts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_old_account_id is null or p_new_account_id is null
    or p_old_account_id = p_new_account_id or p_old_livemode = p_new_livemode then
    raise exception 'Invalid Stripe account replacement';
  end if;

  select * into v_saved from public.stripe_connected_accounts
  where user_id = p_user_id for update;
  if not found or v_saved.stripe_account_id <> p_old_account_id
    or v_saved.stripe_livemode <> p_old_livemode then
    return false;
  end if;

  insert into public.stripe_connected_account_replacements (
    user_id, old_stripe_account_id, old_stripe_livemode,
    new_stripe_account_id, new_stripe_livemode
  ) values (
    p_user_id, p_old_account_id, p_old_livemode,
    p_new_account_id, p_new_livemode
  ) on conflict (user_id, old_stripe_account_id, new_stripe_account_id) do nothing;

  update public.stripe_connected_accounts set
    stripe_account_id = p_new_account_id,
    stripe_livemode = p_new_livemode,
    charges_enabled = p_charges_enabled,
    requirements_due = p_requirements_due,
    updated_at = now()
  where user_id = p_user_id;
  return true;
end;
$function$;
revoke all on function public.workcraft_replace_connected_stripe_account(
  uuid, text, boolean, text, boolean, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.workcraft_replace_connected_stripe_account(
  uuid, text, boolean, text, boolean, boolean, boolean
) to service_role;
