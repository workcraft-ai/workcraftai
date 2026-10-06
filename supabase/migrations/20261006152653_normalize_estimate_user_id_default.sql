-- Keep new estimate inserts consistent across Production and Staging.
-- Existing application writes already provide user_id explicitly; this is a
-- safe default for authenticated inserts that omit it.
alter table public.estimates
  alter column user_id set default auth.uid();
