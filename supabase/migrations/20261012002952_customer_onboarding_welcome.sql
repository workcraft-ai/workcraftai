begin;

-- The checklist contains only progress timestamps. Browser roles cannot forge
-- completion or read another account's progress.
create table public.workcraft_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  previewed_at timestamptz,
  shared_link_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workcraft_onboarding enable row level security;
revoke all on public.workcraft_onboarding from public, anon, authenticated;
grant all on public.workcraft_onboarding to service_role;

-- Welcome messages use the durable, idempotent notification outbox. They are
-- charged to the existing general app mail pool by the worker.
alter table public.notification_outbox drop constraint notification_outbox_source_check;
alter table public.notification_outbox add constraint notification_outbox_source_check
  check (source in ('estimate','proposal_question','invoice','follow_up','billing','auth','welcome'));

commit;
