begin;

-- New estimates remain private until the app installs their encrypted,
-- expiring share token. Existing customer links retain their prior state.
alter table public.estimates
  alter column share_revoked_at set default now();

commit;
