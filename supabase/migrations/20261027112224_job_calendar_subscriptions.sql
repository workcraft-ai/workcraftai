begin;

-- A job's UTC start is already stored in scheduled_at. Keep the intended
-- duration and the time zone used when the contractor scheduled it.
alter table public.jobs
  add column scheduled_end_at timestamptz,
  add column schedule_timezone text;

update public.jobs
set scheduled_end_at = scheduled_at + interval '2 hours'
where scheduled_at is not null and scheduled_end_at is null;

alter table public.jobs
  add constraint jobs_schedule_end_after_start
    check (scheduled_end_at is null or (scheduled_at is not null and scheduled_end_at > scheduled_at)),
  add constraint jobs_schedule_timezone_length
    check (schedule_timezone is null or length(schedule_timezone) between 1 and 100);

-- A private, revocable URL is the credential for read-only calendar clients.
-- Only the server's service role may read or change the token or preferences.
create table public.workcraft_calendar_feeds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  feed_token text not null unique check (feed_token ~ '^[a-f0-9]{64}$'),
  include_estimate_jobs boolean not null default true,
  include_standalone_jobs boolean not null default true,
  include_completed_jobs boolean not null default false,
  show_customer_name boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workcraft_calendar_feeds enable row level security;
alter table public.workcraft_calendar_feeds force row level security;
revoke all on public.workcraft_calendar_feeds from public, anon, authenticated;
grant all on public.workcraft_calendar_feeds to service_role;

commit;
