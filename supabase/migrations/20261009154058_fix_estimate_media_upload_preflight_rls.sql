begin;

-- Supabase Storage authorizes a new upload before the object is written. That
-- preflight metadata contains `contentLength`; the completed object metadata
-- contains the actual `size`. Accept both phases, while requiring the exact
-- reservation byte count when actual object size is available.
drop policy if exists "Pro users upload their own estimate media" on storage.objects;
drop function if exists private.workcraft_can_upload_estimate_media(text, bigint, text);

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

  -- `p_size` is the completed object's exact byte count. A Storage preflight
  -- has no object size yet, so use its declared request length only as a
  -- bounded sanity check; the completed-object check below remains exact.
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
    -- Multipart request framing adds a small amount to the actual file size.
    -- A 1 MiB ceiling permits that framing but prevents grossly mismatched
    -- declared lengths. The final object-size check still requires equality.
    return false;
  end if;

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

create policy "Pro users upload their own estimate media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'estimate-media'
  and private.workcraft_can_upload_estimate_media(
    name,
    case when (metadata ->> 'size') ~ '^[0-9]+$' then (metadata ->> 'size')::bigint else null end,
    case when (metadata ->> 'contentLength') ~ '^[0-9]+$' then (metadata ->> 'contentLength')::bigint else null end,
    lower(coalesce(metadata ->> 'mimetype', ''))
  )
);

commit;
