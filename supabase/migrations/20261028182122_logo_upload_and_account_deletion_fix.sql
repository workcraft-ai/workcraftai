-- A company logo is intentionally public because it appears on customer proposals.
-- All writes go through the authenticated profile API using the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 2097152,
  array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = excluded.allowed_mime_types;

-- Auth user deletion cascades through estimates to line_items. During that
-- cascade the parent estimate can already be gone, which is valid for DELETE.
-- Direct browser deletes still require the existing owner RLS policy.
create or replace function public.workcraft_validate_line_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estimate_id uuid;
  v_status text;
  v_existing_total_cents numeric;
begin
  v_estimate_id := case when tg_op = 'DELETE' then old.estimate_id else new.estimate_id end;
  select e.status into v_status from public.estimates e where e.id = v_estimate_id for update;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    raise exception using errcode = '23503', message = 'ESTIMATE_NOT_FOUND';
  end if;
  if current_setting('request.jwt.claim.role', true) = 'authenticated' and pg_catalog.lower(coalesce(v_status, 'pending')) <> 'pending' then
    raise exception using errcode = '42501', message = 'ESTIMATE_NOT_EDITABLE';
  end if;
  if tg_op <> 'DELETE' then
    if new.description is null or pg_catalog.length(pg_catalog.btrim(new.description)) not between 1 and 240
      or new.quantity is null or new.quantity <= 0 or new.quantity > 100000
      or new.unit_price is null or new.unit_price < 0 or new.unit_price > 100000000
      or (new.description_es is not null and pg_catalog.length(new.description_es) > 240) then
      raise exception using errcode = '22023', message = 'INVALID_LINE_ITEM';
    end if;
    if tg_op = 'UPDATE' then
      select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)), 0) into v_existing_total_cents
      from public.line_items li where li.estimate_id = v_estimate_id and li.id <> old.id;
    else
      select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)), 0) into v_existing_total_cents
      from public.line_items li where li.estimate_id = v_estimate_id;
    end if;
    if v_existing_total_cents + pg_catalog.round(new.quantity * new.unit_price * 100) > 100000000000 then
      raise exception using errcode = '22023', message = 'ESTIMATE_TOTAL_TOO_LARGE';
    end if;
    return new;
  end if;
  return old;
end;
$$;
