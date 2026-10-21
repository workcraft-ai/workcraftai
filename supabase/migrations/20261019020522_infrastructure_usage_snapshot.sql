-- Read-only aggregate capacity snapshot for the MFA-protected admin console.
-- The Storage figure sums object payload metadata; provider billing also
-- accounts for time and other resources, so it is an approximation.
create or replace function public.workcraft_infrastructure_usage()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'storage_payload_bytes', coalesce((
      select pg_catalog.sum(
        case when o.metadata->>'size' ~ '^[0-9]+$'
          then (o.metadata->>'size')::bigint else 0 end
      ) from storage.objects o
    ), 0),
    'storage_objects', (select pg_catalog.count(*) from storage.objects)
  )
$$;

revoke all on function public.workcraft_infrastructure_usage() from public, anon, authenticated, service_role;
grant execute on function public.workcraft_infrastructure_usage() to service_role;
