-- Show the guided setup overlay once per confirmed account while keeping the
-- existing dismissed_at field for the completed checklist's Done action.
alter table public.workcraft_onboarding
  add column if not exists intro_seen_at timestamptz;
