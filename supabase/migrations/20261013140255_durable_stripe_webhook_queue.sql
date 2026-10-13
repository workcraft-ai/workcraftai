-- The signed Stripe request is committed before acknowledging delivery.
-- Only the service role can read the retained payload or claim work.
alter table public.stripe_webhook_events drop constraint stripe_webhook_events_status_check;
alter table public.stripe_webhook_events add constraint stripe_webhook_events_status_check
  check (status in ('pending', 'processing', 'processed', 'failed'));
alter table public.stripe_webhook_events add column payload jsonb;
alter table public.stripe_webhook_events add column next_attempt_at timestamptz not null default now();
create index stripe_webhook_events_due_idx on public.stripe_webhook_events(next_attempt_at)
  where status in ('pending', 'failed');

create or replace function public.workcraft_enqueue_stripe_webhook(p_event_id text, p_event_type text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  if p_payload->>'id' is distinct from p_event_id or p_payload->>'type' is distinct from p_event_type then
    raise exception 'Stripe event identity mismatch';
  end if;
  insert into public.stripe_webhook_events(event_id,event_type,status,payload)
  values (p_event_id,p_event_type,'pending',p_payload)
  on conflict (event_id) do update set
    payload = coalesce(public.stripe_webhook_events.payload,excluded.payload),
    status = case when public.stripe_webhook_events.status='failed' then 'pending' else public.stripe_webhook_events.status end,
    next_attempt_at = now()
  where public.stripe_webhook_events.status <> 'processed';
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;
revoke all on function public.workcraft_enqueue_stripe_webhook(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.workcraft_enqueue_stripe_webhook(text,text,jsonb) to service_role;

create or replace function public.workcraft_complete_stripe_webhook(p_event_id text)
returns void language sql security definer set search_path = '' as $$
  update public.stripe_webhook_events
  set status='processed',processed_at=now(),payload=null,last_error=null
  where event_id=p_event_id and status='processing'
$$;
revoke all on function public.workcraft_complete_stripe_webhook(text) from public,anon,authenticated;
grant execute on function public.workcraft_complete_stripe_webhook(text) to service_role;

create or replace function public.workcraft_fail_stripe_webhook(p_event_id text,p_error text)
returns void language sql security definer set search_path = '' as $$
  update public.stripe_webhook_events
  set status='failed',last_error=left(coalesce(p_error,'processing failed'),500),
      next_attempt_at=now()+(least(900,30*power(2,least(attempts,5)))::text||' seconds')::interval
  where event_id=p_event_id and status='processing'
$$;
revoke all on function public.workcraft_fail_stripe_webhook(text,text) from public,anon,authenticated;
grant execute on function public.workcraft_fail_stripe_webhook(text,text) to service_role;

-- The monitor reads only aggregate pressure and sanitized exception metadata.
create or replace function public.workcraft_db_pressure()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('connections',count(*),'max_connections',current_setting('max_connections')::integer)
  from pg_catalog.pg_stat_activity
$$;
revoke all on function public.workcraft_db_pressure() from public,anon,authenticated;
grant execute on function public.workcraft_db_pressure() to service_role;

create table public.operational_exceptions (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  route text not null check(length(route) <= 160),
  error_type text not null check(length(error_type) <= 100),
  digest text check(length(digest) <= 160)
);
create index operational_exceptions_recent_idx on public.operational_exceptions(occurred_at desc);
alter table public.operational_exceptions enable row level security;
revoke all on public.operational_exceptions from public,anon,authenticated;
grant all on public.operational_exceptions to service_role;

create table public.operational_heartbeats (
  name text primary key,
  last_success_at timestamptz not null
);
alter table public.operational_heartbeats enable row level security;
revoke all on public.operational_heartbeats from public,anon,authenticated;
grant all on public.operational_heartbeats to service_role;

create table public.operational_api_probes (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  status_code integer not null check(status_code between 0 and 599),
  duration_ms integer not null check(duration_ms >= 0)
);
create index operational_api_probes_recent_idx on public.operational_api_probes(checked_at desc);
alter table public.operational_api_probes enable row level security;
revoke all on public.operational_api_probes from public,anon,authenticated;
grant all on public.operational_api_probes to service_role;

-- Supabase Cron provides a second scheduler independent of GitHub Actions.
-- Until the restricted Vault secret is installed, this job sends no requests.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('workcraft-operations-every-five-minutes', '*/5 * * * *', $job$
  select net.http_get(
    url := origin.decrypted_secret || route.path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret.decrypted_secret),
    timeout_milliseconds := 55000
  )
  from vault.decrypted_secrets secret
  cross join vault.decrypted_secrets origin
  cross join (values
    ('/api/cron/notifications'),
    ('/api/cron/stripe-webhooks'),
    ('/api/cron/operations-check')
  ) as route(path)
  where secret.name = 'workcraft_scheduler_secret'
    and origin.name = 'workcraft_scheduler_origin';
$job$);
