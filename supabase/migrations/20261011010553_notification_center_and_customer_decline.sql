-- Persist contractor-facing customer activity notifications.
-- Browser access is limited by per-user RLS and read_at-only update grants.
alter table public.estimates
  add column if not exists customer_declined_at timestamptz,
  add column if not exists customer_decline_reason text;
alter table public.estimates
  drop constraint if exists estimates_customer_decline_reason_length_check,
  add constraint estimates_customer_decline_reason_length_check
    check (customer_decline_reason is null or char_length(customer_decline_reason) <= 500);
create table public.contractor_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  estimate_id uuid references public.estimates(id) on delete cascade,
  event_type text not null check (event_type in (
    'customer_question',
    'estimate_accepted',
    'estimate_declined',
    'payment_received'
  )),
  customer_name text not null check (char_length(customer_name) <= 120),
  estimate_reference text,
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  currency text check (currency is null or currency ~ '^[A-Za-z]{3}$'),
  source_key text not null unique check (char_length(source_key) between 1 and 200),
  details text check (details is null or char_length(details) <= 500),
  created_at timestamptz not null default pg_catalog.now(),
  read_at timestamptz
);

comment on table public.contractor_notifications is
  'Private in-app activity notifications for contractors. Event rows are written by database triggers and scoped to the owning user.';

create index contractor_notifications_user_created_idx
  on public.contractor_notifications(user_id, created_at desc);
create index contractor_notifications_unread_idx
  on public.contractor_notifications(user_id, created_at desc)
  where read_at is null;

alter table public.contractor_notifications enable row level security;
revoke all on public.contractor_notifications from public, anon, authenticated;
grant select (id, user_id, estimate_id, event_type, customer_name, estimate_reference, amount_cents, currency, details, created_at, read_at)
  on public.contractor_notifications to authenticated;
grant update (read_at) on public.contractor_notifications to authenticated;
grant all on public.contractor_notifications to service_role;

create policy "Contractors read their own notifications"
  on public.contractor_notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Contractors mark their own notifications read"
  on public.contractor_notifications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and read_at is not null);

create or replace function public.workcraft_customer_decline_estimate(
  p_estimate_id uuid,
  p_reason text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $decline$
declare
  v_estimate public.estimates%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if p_estimate_id is null or pg_catalog.length(coalesce(v_reason, '')) > 500 then
    raise exception using errcode = '22023', message = 'INVALID_DECLINE_REASON';
  end if;

  select e.* into v_estimate
  from public.estimates e
  where e.id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND';
  end if;

  -- Make retries safe, while keeping contractor-marked declines distinct.
  if pg_catalog.lower(coalesce(v_estimate.status, '')) = 'declined'
     and v_estimate.customer_declined_at is not null then
    return v_estimate.customer_declined_at;
  end if;
  if pg_catalog.lower(coalesce(v_estimate.status, 'pending')) <> 'pending'
     or v_estimate.accepted_at is not null
     or v_estimate.customer_declined_at is not null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_OPEN';
  end if;

  update public.estimates
  set status = 'declined',
      customer_declined_at = v_now,
      customer_decline_reason = v_reason,
      updated_at = v_now
  where id = p_estimate_id
    and pg_catalog.lower(coalesce(status, 'pending')) = 'pending'
    and accepted_at is null
    and customer_declined_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_NOT_OPEN';
  end if;

  return v_now;
end;
$decline$;
revoke all on function public.workcraft_customer_decline_estimate(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.workcraft_customer_decline_estimate(uuid, text) to service_role;

create function private.workcraft_notify_proposal_question()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
begin
  select e.* into v_estimate
  from public.estimates e
  where e.id::text = new.estimate_id
    and e.user_id = new.user_id;

  if not found then
    return new;
  end if;

  insert into public.contractor_notifications(
    user_id, estimate_id, event_type, customer_name, estimate_reference, source_key
  ) values (
    v_estimate.user_id,
    v_estimate.id,
    'customer_question',
    pg_catalog.left(coalesce(nullif(pg_catalog.btrim(new.customer_name), ''), 'Customer'), 120),
    v_estimate.reference_number,
    'question:' || new.id::text
  )
  on conflict (source_key) do nothing;

  delete from public.contractor_notifications n
  where n.user_id = v_estimate.user_id
    and n.read_at is not null
    and n.created_at < pg_catalog.now() - interval '90 days';

  return new;
end;
$$;

revoke all on function private.workcraft_notify_proposal_question() from public, anon, authenticated;

drop trigger if exists workcraft_create_contractor_question_notification on public.proposal_questions;
create trigger workcraft_create_contractor_question_notification
  after insert on public.proposal_questions
  for each row execute function private.workcraft_notify_proposal_question();

create function private.workcraft_notify_estimate_customer_response()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_event_type text;
  v_request_role text := pg_catalog.current_setting('request.jwt.claim.role', true);
begin
  -- Contractor status edits are for their own reports, not customer activity.
  if v_request_role = 'authenticated' or old.status is not distinct from new.status then
    return new;
  end if;

  if pg_catalog.lower(coalesce(new.status, '')) = 'accepted'
     and new.accepted_at is not null then
    v_event_type := 'estimate_accepted';
  elsif pg_catalog.lower(coalesce(new.status, '')) = 'declined'
     and new.customer_declined_at is not null then
    v_event_type := 'estimate_declined';
  else
    return new;
  end if;

  insert into public.contractor_notifications(
    user_id, estimate_id, event_type, customer_name, estimate_reference, source_key, details
  ) values (
    new.user_id,
    new.id,
    v_event_type,
    pg_catalog.left(coalesce(nullif(pg_catalog.btrim(new.client_name), ''), 'Customer'), 120),
    new.reference_number,
    'estimate:' || new.id::text || ':' || v_event_type,
    case when v_event_type = 'estimate_declined' then new.customer_decline_reason else null end
  )
  on conflict (source_key) do nothing;

  delete from public.contractor_notifications n
  where n.user_id = new.user_id
    and n.read_at is not null
    and n.created_at < pg_catalog.now() - interval '90 days';

  return new;
end;
$$;

revoke all on function private.workcraft_notify_estimate_customer_response() from public, anon, authenticated;

drop trigger if exists workcraft_create_estimate_response_notification on public.estimates;
create trigger workcraft_create_estimate_response_notification
  after update of status on public.estimates
  for each row execute function private.workcraft_notify_estimate_customer_response();

create function private.workcraft_notify_customer_payment_received()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
begin
  if new.status <> 'succeeded' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'succeeded' then
    return new;
  end if;

  select e.* into v_estimate
  from public.estimates e
  where e.id = new.estimate_id
    and e.user_id = new.user_id;

  if not found then
    return new;
  end if;

  insert into public.contractor_notifications(
    user_id, estimate_id, event_type, customer_name, estimate_reference,
    amount_cents, currency, source_key
  ) values (
    new.user_id,
    new.estimate_id,
    'payment_received',
    pg_catalog.left(coalesce(nullif(pg_catalog.btrim(v_estimate.client_name), ''), 'Customer'), 120),
    v_estimate.reference_number,
    new.amount_cents,
    new.currency,
    'payment:' || new.id::text
  )
  on conflict (source_key) do nothing;

  delete from public.contractor_notifications n
  where n.user_id = new.user_id
    and n.read_at is not null
    and n.created_at < pg_catalog.now() - interval '90 days';

  return new;
end;
$$;

revoke all on function private.workcraft_notify_customer_payment_received() from public, anon, authenticated;

drop trigger if exists workcraft_create_payment_received_notification on public.customer_payments;
create trigger workcraft_create_payment_received_notification
  after insert or update of status on public.customer_payments
  for each row execute function private.workcraft_notify_customer_payment_received();
