-- Count sustained idle transactions separately from momentary idle sessions.
-- The daily audit can warn on a short-lived cluster without paging; a session
-- left idle in a transaction for five minutes still requires investigation.
create or replace function public.workcraft_db_pressure()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'connections', count(*),
    'max_connections', current_setting('max_connections')::integer,
    'active_connections', count(*) filter (where a.state = 'active'),
    'waiting_connections', count(*) filter (where a.state = 'active' and a.wait_event_type is not null),
    'idle_in_transaction', count(*) filter (where a.state = 'idle in transaction'),
    'idle_in_transaction_over_5m', count(*) filter (
      where a.state = 'idle in transaction'
        and a.state_change <= now() - interval '5 minutes'
    )
  )
  from pg_catalog.pg_stat_activity a
$$;
revoke all on function public.workcraft_db_pressure() from public, anon, authenticated, service_role;
grant execute on function public.workcraft_db_pressure() to service_role;
