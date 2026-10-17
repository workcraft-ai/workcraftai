begin;

-- The Stripe retry window and access grace period are separate. Three weekdays
-- after the first observed past-due transition, at the same local clock time.
create or replace function public.workcraft_pro_grace_deadline(p_started_at timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_started_at at time zone 'America/New_York';
  v_days integer := 0;
begin
  if p_started_at is null then return null; end if;
  while v_days < 3 loop
    v_local := v_local + interval '1 day';
    if extract(isodow from v_local) < 6 then v_days := v_days + 1; end if;
  end loop;
  return v_local at time zone 'America/New_York';
end; $$;
revoke all on function public.workcraft_pro_grace_deadline(timestamptz) from public, anon, authenticated;
grant execute on function public.workcraft_pro_grace_deadline(timestamptz) to service_role;

alter table public.subscriptions
  add column past_due_since timestamptz,
  add column grace_ends_at timestamptz;

-- Existing past-due accounts receive a full grace period on rollout. The
-- original failure time was not persisted, so an earlier date cannot be proven.
update public.subscriptions
set past_due_since = pg_catalog.now(),
    grace_ends_at = public.workcraft_pro_grace_deadline(pg_catalog.now())
where status = 'past_due';

create table public.subscription_billing_invoices (
  invoice_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id text not null,
  status text not null,
  amount_due bigint not null default 0 check (amount_due >= 0),
  currency text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now()
);
create index subscription_billing_invoices_user_updated_idx
  on public.subscription_billing_invoices(user_id, updated_at desc);
create index subscription_billing_invoices_status_updated_idx
  on public.subscription_billing_invoices(status, updated_at desc);
alter table public.subscription_billing_invoices enable row level security;
revoke all on public.subscription_billing_invoices from public, anon, authenticated;
grant all on public.subscription_billing_invoices to service_role;

create or replace function public.workcraft_user_has_pro(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s where s.user_id = p_user_id
      and (s.status in ('active', 'trialing')
        or (s.status = 'past_due' and s.grace_ends_at > pg_catalog.now()))
  ) or exists (
    select 1 from public.tradeflow_pro_access_grants g
    where g.user_id = p_user_id and g.starts_at <= pg_catalog.now()
      and g.revoked_at is null and (g.expires_at is null or g.expires_at > pg_catalog.now())
  );
$$;
revoke all on function public.workcraft_user_has_pro(uuid) from public, anon, authenticated;

create or replace function public.workcraft_apply_subscription_sync(
  p_user_id uuid, p_token uuid, p_subscription_id text, p_customer_id text,
  p_created bigint, p_status text, p_period_end timestamptz,
  p_attempt_id uuid default null, p_session_id text default null,
  p_previous_created bigint default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_current public.subscriptions%rowtype;
  v_attempt public.pro_checkout_attempts%rowtype;
  v_created bigint;
  v_past_due_since timestamptz;
begin
  perform 1 from private.subscription_sync_leases
    where user_id=p_user_id and token=p_token and expires_at>pg_catalog.clock_timestamp()
    for update;
  if not found then raise exception 'SUBSCRIPTION_LEASE_EXPIRED'; end if;
  if p_subscription_id is null or p_customer_id is null or p_status is null or p_created is null or p_created<0 or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or p_customer_id !~ '^cus_[A-Za-z0-9]+$'
    or p_status not in ('active','trialing','past_due','unpaid','canceled','incomplete','incomplete_expired','paused') then
    raise exception 'INVALID_SUBSCRIPTION_STATE';
  end if;
  select * into v_current from public.subscriptions where user_id=p_user_id for update;
  if p_attempt_id is not null then
    select * into v_attempt from public.pro_checkout_attempts
      where id=p_attempt_id and user_id=p_user_id and stripe_checkout_session_id=p_session_id for update;
    if not found then raise exception 'CHECKOUT_ATTEMPT_MISMATCH'; end if;
    update public.pro_checkout_attempts set status='completed', checkout_url=null,
      updated_at=pg_catalog.now() where id=v_attempt.id;
  end if;
  if v_current.stripe_subscription_id is distinct from p_subscription_id then
    if p_attempt_id is null then return false; end if;
    if v_current.stripe_subscription_id is not null then
      v_created := coalesce(v_current.stripe_subscription_created_at, p_previous_created);
      if v_created is null then raise exception 'SUBSCRIPTION_BASELINE_REQUIRED'; end if;
      if p_created<v_created or (p_created=v_created and
        (v_current.stripe_checkout_created_at is null or v_attempt.created_at<=v_current.stripe_checkout_created_at)) then
        return false;
      end if;
    end if;
  end if;
  if p_status = 'past_due' then
    v_past_due_since := case when v_current.stripe_subscription_id = p_subscription_id
      and v_current.status = 'past_due' then coalesce(v_current.past_due_since, pg_catalog.now())
      else pg_catalog.now() end;
  end if;
  insert into public.subscriptions(user_id,stripe_customer_id,stripe_subscription_id,status,
    current_period_end,updated_at,stripe_subscription_created_at,stripe_checkout_created_at,
    past_due_since,grace_ends_at)
  values(p_user_id,p_customer_id,p_subscription_id,p_status,p_period_end,pg_catalog.now(),p_created,v_attempt.created_at,
    v_past_due_since,public.workcraft_pro_grace_deadline(v_past_due_since))
  on conflict(user_id) do update set stripe_customer_id=excluded.stripe_customer_id,
    stripe_subscription_id=excluded.stripe_subscription_id,status=excluded.status,
    current_period_end=excluded.current_period_end,updated_at=excluded.updated_at,
    stripe_subscription_created_at=excluded.stripe_subscription_created_at,
    stripe_checkout_created_at=coalesce(excluded.stripe_checkout_created_at,subscriptions.stripe_checkout_created_at),
    past_due_since=excluded.past_due_since,grace_ends_at=excluded.grace_ends_at;
  return true;
end; $$;
revoke all on function public.workcraft_apply_subscription_sync(uuid,uuid,text,text,bigint,text,timestamptz,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.workcraft_apply_subscription_sync(uuid,uuid,text,text,bigint,text,timestamptz,uuid,text,bigint) to service_role;

-- A fetched, current Stripe invoice snapshot wins over old webhook delivery.
-- Paid is terminal for this invoice; stale retry events cannot undo recovery.
create function public.workcraft_record_subscription_invoice(
  p_invoice_id text, p_user_id uuid, p_subscription_id text, p_status text,
  p_amount_due bigint, p_currency text, p_attempt_count integer,
  p_next_retry_at timestamptz, p_failed_at timestamptz, p_paid_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_invoice_id is null or p_invoice_id !~ '^in_[A-Za-z0-9]+$'
    or p_subscription_id is null or p_subscription_id !~ '^sub_[A-Za-z0-9]+$'
    or p_user_id is null or p_status not in ('draft','open','paid','void','uncollectible')
    or p_amount_due < 0 or p_attempt_count < 0 or p_currency !~ '^[a-z]{3}$' then
    raise exception 'INVALID_BILLING_INVOICE';
  end if;
  if not exists (select 1 from public.subscriptions s where s.user_id=p_user_id
    and s.stripe_subscription_id=p_subscription_id) then
    return;
  end if;
  insert into public.subscription_billing_invoices as invoice(
    invoice_id,user_id,subscription_id,status,amount_due,currency,attempt_count,
    next_retry_at,first_failed_at,last_failed_at,paid_at)
  values(p_invoice_id,p_user_id,p_subscription_id,p_status,p_amount_due,p_currency,p_attempt_count,
    p_next_retry_at,p_failed_at,p_failed_at,p_paid_at)
  on conflict(invoice_id) do update set
    status=case when invoice.status='paid' then 'paid' when excluded.status='paid' then 'paid'
      when excluded.attempt_count>=invoice.attempt_count then excluded.status else invoice.status end,
    amount_due=case when excluded.attempt_count>=invoice.attempt_count then excluded.amount_due else invoice.amount_due end,
    attempt_count=greatest(invoice.attempt_count,excluded.attempt_count),
    next_retry_at=case when invoice.status='paid' or excluded.status='paid' then null
      when excluded.attempt_count>=invoice.attempt_count then excluded.next_retry_at else invoice.next_retry_at end,
    first_failed_at=coalesce(invoice.first_failed_at,excluded.first_failed_at),
    last_failed_at=greatest(invoice.last_failed_at,excluded.last_failed_at),
    paid_at=coalesce(invoice.paid_at,excluded.paid_at),
    updated_at=pg_catalog.now()
  where invoice.user_id=excluded.user_id and invoice.subscription_id=excluded.subscription_id;
end; $$;
revoke all on function public.workcraft_record_subscription_invoice(text,uuid,text,text,bigint,text,integer,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.workcraft_record_subscription_invoice(text,uuid,text,text,bigint,text,integer,timestamptz,timestamptz,timestamptz) to service_role;

commit;
