begin;
create or replace function public.workcraft_finish_estimate_media_upload(
  p_reservation_id uuid, p_uploaded boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_row public.tradeflow_media_upload_reservations%rowtype;
  v_bytes bigint;
begin
  if v_user is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':estimate-media', 0));
  select r.* into v_row from public.tradeflow_media_upload_reservations r
    where r.id = p_reservation_id and r.user_id = v_user for update;
  if not found then return false; end if;
  if v_row.status = 'consumed' then return true; end if;
  if v_row.status <> 'reserved' then return false; end if;
  select case when (o.metadata ->> 'size') ~ '^[0-9]+$'
    then (o.metadata ->> 'size')::bigint else null end into v_bytes
    from storage.objects o
    where o.bucket_id = 'estimate-media' and o.name = v_row.storage_path;
  if found then
    -- Keep a malformed-size object pending for server reconciliation.
    if v_bytes is null or v_bytes < 1 then return false; end if;
    insert into public.tradeflow_media_monthly_usage(user_id,usage_month,bytes_uploaded)
      values(v_user,v_row.usage_month,v_bytes)
      on conflict(user_id,usage_month) do update set bytes_uploaded =
        public.tradeflow_media_monthly_usage.bytes_uploaded + excluded.bytes_uploaded;
    update public.tradeflow_media_upload_reservations
      set status='consumed',finished_at=pg_catalog.now() where id=v_row.id;
    return true;
  end if;
  update public.tradeflow_media_upload_reservations
    set status='released',finished_at=pg_catalog.now() where id=v_row.id;
  return false;
end; $$;
revoke all on function public.workcraft_finish_estimate_media_upload(uuid,boolean)
  from public,anon;
grant execute on function public.workcraft_finish_estimate_media_upload(uuid,boolean)
  to authenticated;

create or replace function private.workcraft_can_delete_estimate_media(p_path text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or pg_catalog.split_part(p_path,'/',1) <> v_user::text
    then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':estimate-media',0));
  return not exists(select 1 from public.tradeflow_media_upload_reservations r
    where r.user_id=v_user and r.storage_path=p_path and r.status='reserved');
end; $$;
revoke all on function private.workcraft_can_delete_estimate_media(text) from public,anon;
grant execute on function private.workcraft_can_delete_estimate_media(text) to authenticated;
drop policy if exists "Users delete their own estimate media" on storage.objects;
create policy "Users delete their own estimate media" on storage.objects
  for delete to authenticated using(bucket_id='estimate-media'
    and private.workcraft_can_delete_estimate_media(name));
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user::text || ':estimate-media', 0)
  );

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


-- All payment transitions and estimate totals share checkout's estimate lock.
create or replace function public.workcraft_apply_customer_payment_state(
  p_payment_id uuid, p_stripe_account_id text, p_state text,
  p_payment_intent_id text default null, p_refunded_cents bigint default 0
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_estimate_id uuid;
  v_estimate public.estimates%rowtype;
  v_payment public.customer_payments%rowtype;
  v_subtotal numeric;
  v_markup numeric;
  v_total bigint;
  v_paid bigint;
begin
  if p_state is null or p_state not in ('succeeded','refunded','failed','expired')
    or p_stripe_account_id is null or p_refunded_cents is null or p_refunded_cents < 0 then
    raise exception using errcode='22023',message='INVALID_PAYMENT_STATE';
  end if;
  select cp.estimate_id into v_estimate_id from public.customer_payments cp
    where (p_payment_id is not null and cp.id=p_payment_id)
       or (p_payment_id is null and cp.stripe_payment_intent_id=p_payment_intent_id
           and cp.stripe_account_id=p_stripe_account_id);
  if not found then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_estimate_id::text,0));
  select e.* into v_estimate from public.estimates e where e.id=v_estimate_id for update;
  if not found then return false; end if;
  select cp.* into v_payment from public.customer_payments cp
    where cp.estimate_id=v_estimate_id
      and ((p_payment_id is not null and cp.id=p_payment_id)
        or (p_payment_id is null and cp.stripe_payment_intent_id=p_payment_intent_id
          and cp.stripe_account_id=p_stripe_account_id)) for update;
  if not found then return false; end if;
  if v_payment.stripe_account_id <> p_stripe_account_id then
    raise exception using errcode='42501',message='STRIPE_ACCOUNT_MISMATCH';
  end if;
  if p_payment_intent_id is not null and v_payment.stripe_payment_intent_id is not null
    and v_payment.stripe_payment_intent_id <> p_payment_intent_id then
    raise exception using errcode='42501',message='PAYMENT_INTENT_MISMATCH';
  end if;
  if p_state in ('failed','expired') then
    update public.customer_payments set status=p_state,updated_at=pg_catalog.now()
      where id=v_payment.id and status='pending';
    return true;
  end if;
  update public.customer_payments cp set
    stripe_payment_intent_id=coalesce(cp.stripe_payment_intent_id,p_payment_intent_id),
    amount_refunded_cents=greatest(cp.amount_refunded_cents,
      case when p_state='refunded' then least(cp.amount_cents,p_refunded_cents) else 0 end),
    status=case
      when greatest(cp.amount_refunded_cents,case when p_state='refunded' then p_refunded_cents else 0 end)>=cp.amount_cents then 'refunded'
      when greatest(cp.amount_refunded_cents,case when p_state='refunded' then p_refunded_cents else 0 end)>0 then 'partially_refunded'
      else 'succeeded' end,
    updated_at=pg_catalog.now()
    where cp.id=v_payment.id;
  if v_estimate.selected_package is not null then
    select pg_catalog.round((item.value->>'total')::numeric*100) into v_subtotal
      from pg_catalog.jsonb_array_elements(coalesce(v_estimate.package_options,'[]'::jsonb)) item(value)
      where item.value->>'name'=v_estimate.selected_package limit 1;
    if v_subtotal is null then raise exception 'ACCEPTED_PACKAGE_NOT_FOUND'; end if;
    v_markup:=0;
  else
    select coalesce(sum(pg_catalog.round(li.quantity*li.unit_price*100)),0) into v_subtotal
      from public.line_items li where li.estimate_id=v_estimate_id;
    v_markup:=pg_catalog.round(v_subtotal*coalesce(v_estimate.markup_percentage,0)/100);
  end if;
  v_total:=(v_subtotal+v_markup+pg_catalog.round((v_subtotal+v_markup)*coalesce(v_estimate.tax_rate,0)/100))::bigint;
  select coalesce(sum(greatest(cp.amount_cents-cp.amount_refunded_cents,0)),0)::bigint into v_paid
    from public.customer_payments cp where cp.estimate_id=v_estimate_id
      and cp.status in ('succeeded','partially_refunded','refunded');
  update public.estimates set status=case when v_total>0 and v_paid>=v_total then 'paid' else 'accepted' end
    where id=v_estimate_id and user_id=v_payment.user_id;
  return true;
end; $$;
revoke all on function public.workcraft_apply_customer_payment_state(uuid,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.workcraft_apply_customer_payment_state(uuid,text,text,text,bigint) to service_role;

alter table public.price_book_items add column if not exists pricing_basis text not null default 'unknown'
  check (pricing_basis in ('unknown','labor','materials','installed','other'));
commit;
