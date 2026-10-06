-- Keep payment amounts and subscription checkout reservations authoritative
-- across serverless instances. These tables/functions are service-role only.

drop function if exists public.workcraft_prepare_customer_payment(uuid, uuid, text, bigint, text);

create or replace function public.workcraft_prepare_customer_payment(
  p_user_id uuid,
  p_estimate_id uuid,
  p_payment_kind text,
  p_stripe_account_id text
)
returns table(payment_id uuid, payment_kind text, amount_cents bigint, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
  v_existing public.customer_payments%rowtype;
  v_subtotal_cents numeric;
  v_markup_cents numeric;
  v_tax_cents numeric;
  v_total_cents numeric;
  v_paid_cents numeric;
  v_due_cents numeric;
  v_expected_cents numeric;
  v_connected_account_id text;
begin
  if p_payment_kind is null or p_payment_kind not in ('deposit', 'balance') then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_REQUEST';
  end if;
  if not public.workcraft_user_has_pro(p_user_id) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
  end if;

  -- Serialize all payment attempts for this estimate and keep the estimate
  -- stable while deriving the due amount.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_estimate_id::text, 0));
  select e.* into v_estimate
  from public.estimates e
  where e.id = p_estimate_id and e.user_id = p_user_id and e.status = 'accepted'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ESTIMATE_NOT_PAYABLE';
  end if;

  select ca.stripe_account_id into v_connected_account_id
  from public.stripe_connected_accounts ca
  where ca.user_id = p_user_id;
  if v_connected_account_id is null or v_connected_account_id <> p_stripe_account_id then
    raise exception using errcode = '42501', message = 'STRIPE_ACCOUNT_MISMATCH';
  end if;

  if v_estimate.selected_package is not null then
    select pg_catalog.round(nullif(option.value ->> 'total', '')::numeric * 100)
      into v_subtotal_cents
    from pg_catalog.jsonb_array_elements(coalesce(v_estimate.package_options, '[]'::jsonb)) as option(value)
    where option.value ->> 'name' = v_estimate.selected_package
    limit 1;
    if v_subtotal_cents is null then
      raise exception using errcode = '22023', message = 'ACCEPTED_PACKAGE_NOT_FOUND';
    end if;
    v_markup_cents := 0;
  else
    select coalesce(sum(pg_catalog.round(li.quantity * li.unit_price * 100)), 0)
      into v_subtotal_cents
    from public.line_items li
    where li.estimate_id = p_estimate_id;
    v_markup_cents := pg_catalog.round(v_subtotal_cents * coalesce(v_estimate.markup_percentage, 0) / 100);
  end if;

  v_tax_cents := pg_catalog.round((v_subtotal_cents + v_markup_cents) * coalesce(v_estimate.tax_rate, 0) / 100);
  v_total_cents := v_subtotal_cents + v_markup_cents + v_tax_cents;
  if v_total_cents <= 0 then
    raise exception using errcode = '22023', message = 'NO_REMAINING_BALANCE';
  end if;

  select coalesce(sum(greatest(cp.amount_cents - cp.amount_refunded_cents, 0)), 0)
    into v_paid_cents
  from public.customer_payments cp
  where cp.estimate_id = p_estimate_id
    and cp.status in ('succeeded', 'partially_refunded', 'refunded');

  v_due_cents := greatest(v_total_cents - v_paid_cents, 0);
  if p_payment_kind = 'deposit' then
    if not coalesce(v_estimate.require_deposit, false) or v_paid_cents > 0 then
      raise exception using errcode = '22023', message = 'DEPOSIT_NOT_AVAILABLE';
    end if;
    v_expected_cents := least(
      v_due_cents,
      pg_catalog.round(v_total_cents * coalesce(v_estimate.deposit_percentage, 0) / 100)
    );
  else
    v_expected_cents := v_due_cents;
  end if;

  if v_expected_cents < 1 then
    raise exception using errcode = '22023', message = 'NO_REMAINING_BALANCE';
  end if;
  -- Stripe's USD charge limit is below 100 million cents.
  if v_expected_cents > 99999999 then
    raise exception using errcode = '22023', message = 'PAYMENT_AMOUNT_LIMIT_EXCEEDED';
  end if;

  select cp.* into v_existing
  from public.customer_payments cp
  where cp.estimate_id = p_estimate_id and cp.status = 'pending'
  order by cp.created_at desc
  limit 1;
  if found then
    if v_existing.payment_kind <> p_payment_kind or v_existing.amount_cents <> v_expected_cents then
      raise exception using errcode = '55000', message = 'PAYMENT_CHECKOUT_ALREADY_OPEN';
    end if;
    return query select v_existing.id, v_existing.payment_kind, v_existing.amount_cents, true;
    return;
  end if;

  if (select count(*) from public.customer_payments cp
      where cp.estimate_id = p_estimate_id
        and cp.created_at >= pg_catalog.now() - interval '24 hours') >= 10 then
    raise exception using errcode = '54000', message = 'CHECKOUT_RATE_LIMITED';
  end if;

  insert into public.customer_payments(user_id, estimate_id, stripe_account_id, payment_kind, amount_cents)
  values (p_user_id, p_estimate_id, p_stripe_account_id, p_payment_kind, v_expected_cents::bigint)
  returning id into payment_id;
  payment_kind := p_payment_kind;
  amount_cents := v_expected_cents::bigint;
  reused := false;
  return next;
end;
$$;
revoke all on function public.workcraft_prepare_customer_payment(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.workcraft_prepare_customer_payment(uuid, uuid, text, text) to service_role;

create table if not exists public.pro_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'creating' check (status in ('creating', 'open', 'completed', 'expired', 'failed')),
  stripe_checkout_session_id text unique,
  checkout_url text,
  expires_at timestamptz not null default (pg_catalog.now() + interval '5 minutes'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);
create unique index if not exists pro_checkout_attempts_one_live_per_user_idx
  on public.pro_checkout_attempts(user_id)
  where status in ('creating', 'open');
create index if not exists pro_checkout_attempts_user_created_idx
  on public.pro_checkout_attempts(user_id, created_at desc);
alter table public.pro_checkout_attempts enable row level security;
revoke all on public.pro_checkout_attempts from public, anon, authenticated;
grant all on public.pro_checkout_attempts to service_role;

create or replace function public.workcraft_reserve_pro_checkout(p_user_id uuid)
returns table(
  attempt_id uuid,
  stripe_checkout_session_id text,
  checkout_url text,
  expires_at timestamptz,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.pro_checkout_attempts%rowtype;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_USER';
  end if;
  if public.workcraft_user_has_pro(p_user_id) then
    raise exception using errcode = '55000', message = 'WORKCRAFT_PRO_ALREADY_ACTIVE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 1));
  update public.pro_checkout_attempts a
  set status = 'expired', updated_at = pg_catalog.now()
  where a.user_id = p_user_id and a.status in ('creating', 'open') and a.expires_at <= pg_catalog.now();

  select a.* into v_existing
  from public.pro_checkout_attempts a
  where a.user_id = p_user_id and a.status in ('creating', 'open')
  order by a.created_at desc
  limit 1
  for update;
  if found then
    return query select v_existing.id, v_existing.stripe_checkout_session_id,
      v_existing.checkout_url, v_existing.expires_at, true;
    return;
  end if;

  insert into public.pro_checkout_attempts(user_id)
  values (p_user_id)
  returning id, stripe_checkout_session_id, checkout_url, expires_at
  into attempt_id, stripe_checkout_session_id, checkout_url, expires_at;
  reused := false;
  return next;
end;
$$;
revoke all on function public.workcraft_reserve_pro_checkout(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_reserve_pro_checkout(uuid) to service_role;

comment on table public.pro_checkout_attempts is 'Service-only durable reservations prevent duplicate Pro Checkout Sessions across serverless instances.';
