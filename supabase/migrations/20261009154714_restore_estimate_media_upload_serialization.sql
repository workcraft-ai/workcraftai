-- Keep per-account storage limits race-safe while accepting both Storage's
-- upload preflight metadata and the completed object's exact byte count.
create or replace function private.workcraft_can_upload_estimate_media(
  p_path text,
  p_size bigint,
  p_content_length bigint,
  p_mime_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_estimate uuid;
  v_reserved_bytes bigint;
  v_count bigint;
  v_bytes bigint;
begin
  if v_user is null
    or p_mime_type not in ('image/jpeg','image/png','image/webp','image/heic','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav')
    or p_path !~ ('^' || v_user::text || '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9._-]{1,220}$') then
    return false;
  end if;

  if p_size is not null and (p_size < 1 or p_size > 15728640) then
    return false;
  end if;
  if p_size is null and p_content_length is not null
    and (p_content_length < 1 or p_content_length > 15728640 + 1048576) then
    return false;
  end if;

  begin
    v_estimate := pg_catalog.split_part(p_path, '/', 2)::uuid;
  exception when others then
    return false;
  end;

  if not exists (
    select 1 from public.estimates e
    where e.id = v_estimate and e.user_id = v_user
  ) or not public.workcraft_user_has_pro(v_user) then
    return false;
  end if;

  select r.bytes into v_reserved_bytes
  from public.tradeflow_media_upload_reservations r
  where r.user_id = v_user
    and r.estimate_id = v_estimate
    and r.storage_path = p_path
    and r.mime_type = p_mime_type
    and r.status = 'reserved';
  if not found then
    return false;
  end if;

  if p_size is not null then
    if p_size <> v_reserved_bytes then
      return false;
    end if;
  elsif p_content_length is not null
    and (p_content_length < v_reserved_bytes or p_content_length > v_reserved_bytes + 1048576) then
    return false;
  end if;

  -- Serialize Storage object inserts for this user so concurrent requests
  -- cannot both pass the retained-count and retained-byte checks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':estimate-media', 0)
  );

  select pg_catalog.count(*), coalesce(pg_catalog.sum(
    case when (o.metadata ->> 'size') ~ '^[0-9]+$'
      then (o.metadata ->> 'size')::bigint else 0 end
  ), 0)
  into v_count, v_bytes
  from storage.objects o
  where o.bucket_id = 'estimate-media' and o.name like v_user::text || '/%';

  return v_count < 100 and v_bytes + v_reserved_bytes <= 262144000;
end;
$$;

revoke all on function private.workcraft_can_upload_estimate_media(text, bigint, bigint, text) from public, anon;
grant execute on function private.workcraft_can_upload_estimate_media(text, bigint, bigint, text) to authenticated;
