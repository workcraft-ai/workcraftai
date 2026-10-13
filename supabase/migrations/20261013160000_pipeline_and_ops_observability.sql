begin;

-- Keep contractor pipeline labels separate from customer approval and payment
-- facts. Only the customer acceptance RPC and verified payment webhook update
-- estimates.status; this RPC changes an owner-scoped internal stage.
alter table public.estimates
  add column pipeline_stage text not null default 'active'
  check (pipeline_stage in ('active', 'follow_up', 'closed_won', 'closed_lost'));

-- Reconcile legacy manual status edits against immutable acceptance evidence,
-- decline evidence, and successful payment rows before removing that edit path.
alter table public.estimates disable trigger workcraft_create_estimate_response_notification;
update public.estimates e
set status = case
      when exists (
        select 1 from public.estimate_acceptances a
        where a.estimate_id = e.id
          and a.accepted_total_cents > 0
          and coalesce((select sum(greatest(cp.amount_cents - cp.amount_refunded_cents, 0))
                        from public.customer_payments cp
                        where cp.estimate_id = e.id and cp.status in ('succeeded', 'partially_refunded', 'refunded')), 0)
              >= a.accepted_total_cents
      ) then 'paid'
      when exists (select 1 from public.estimate_acceptances a where a.estimate_id = e.id) then 'accepted'
      when e.customer_declined_at is not null then 'declined'
      else 'pending'
    end,
    signature_name = (select a.signature_name from public.estimate_acceptances a where a.estimate_id = e.id),
    accepted_at = (select a.accepted_at from public.estimate_acceptances a where a.estimate_id = e.id),
    selected_package = (select a.selected_package from public.estimate_acceptances a where a.estimate_id = e.id)
where e.status in ('accepted', 'paid', 'declined');
alter table public.estimates enable trigger workcraft_create_estimate_response_notification;

update public.estimates
set pipeline_stage = case
  when status in ('accepted', 'paid') then 'closed_won'
  when status = 'declined' then 'closed_lost'
  when status = 'pending' and followup_at is not null then 'follow_up'
  else 'active'
end;

-- Preserve the payment terms as they stood when existing estimates were
-- accepted. New acceptance rows receive the same snapshot fields below.
update public.estimate_acceptances a
set proposal_snapshot = coalesce(a.proposal_snapshot, '{}'::jsonb) || jsonb_build_object(
  'require_deposit', coalesce(e.require_deposit, false),
  'deposit_percentage', coalesce(e.deposit_percentage, 0)
)
from public.estimates e
where e.id = a.estimate_id;

create or replace function private.workcraft_snapshot_acceptance_payment_terms()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.estimate_acceptances a
  set proposal_snapshot = coalesce(a.proposal_snapshot, '{}'::jsonb) || jsonb_build_object(
    'require_deposit', coalesce(e.require_deposit, false),
    'deposit_percentage', coalesce(e.deposit_percentage, 0)
  )
  from public.estimates e
  where a.estimate_id = new.estimate_id and e.id = new.estimate_id;
  return new;
end;
$$;
revoke all on function private.workcraft_snapshot_acceptance_payment_terms() from public, anon, authenticated, service_role;
drop trigger if exists workcraft_snapshot_acceptance_payment_terms on public.estimate_acceptances;
create trigger workcraft_snapshot_acceptance_payment_terms
after insert on public.estimate_acceptances
for each row execute function private.workcraft_snapshot_acceptance_payment_terms();

create or replace function private.workcraft_sync_pipeline_stage_to_customer_status()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status in ('accepted', 'paid') then
    new.pipeline_stage := 'closed_won';
  elsif new.status = 'declined' then
    new.pipeline_stage := 'closed_lost';
  elsif tg_op = 'UPDATE' and old.status in ('accepted', 'paid', 'declined') and new.status = 'pending' then
    new.pipeline_stage := 'active';
  end if;
  return new;
end;
$$;
revoke all on function private.workcraft_sync_pipeline_stage_to_customer_status() from public, anon, authenticated;
drop trigger if exists workcraft_sync_pipeline_stage_to_customer_status on public.estimates;
create trigger workcraft_sync_pipeline_stage_to_customer_status
before insert or update of status on public.estimates
for each row execute function private.workcraft_sync_pipeline_stage_to_customer_status();

drop function public.workcraft_update_estimate_status(uuid, text);

create function public.workcraft_update_estimate_pipeline_stage(p_estimate_id uuid, p_stage text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_stage text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_stage, '')));
  v_status text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if v_stage not in ('active', 'follow_up', 'closed_won', 'closed_lost') then
    raise exception using errcode = '22023', message = 'INVALID_PIPELINE_STAGE';
  end if;
  select e.status into v_status
  from public.estimates e
  where e.id = p_estimate_id and e.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ESTIMATE_NOT_FOUND';
  end if;
  if v_status in ('accepted', 'paid') and v_stage <> 'closed_won' then
    raise exception using errcode = '42501', message = 'ACCEPTED_ESTIMATE_STAGE_LOCKED';
  end if;
  if v_status = 'declined' and v_stage <> 'closed_lost' then
    raise exception using errcode = '42501', message = 'DECLINED_ESTIMATE_STAGE_LOCKED';
  end if;
  if v_status not in ('accepted', 'paid') and v_stage = 'closed_won' then
    raise exception using errcode = '22023', message = 'CUSTOMER_APPROVAL_REQUIRED';
  end if;
  update public.estimates set pipeline_stage = v_stage
  where id = p_estimate_id and user_id = v_user_id;
  return v_stage;
end;
$$;
revoke all on function public.workcraft_update_estimate_pipeline_stage(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.workcraft_update_estimate_pipeline_stage(uuid, text) to authenticated;

create function public.workcraft_get_accepted_total_cents(p_estimate_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_total bigint;
begin
  if auth.uid() is null then return null; end if;
  select a.accepted_total_cents into v_total
  from public.estimate_acceptances a
  join public.estimates e on e.id = a.estimate_id and e.user_id = auth.uid()
  where a.estimate_id = p_estimate_id;
  return v_total;
end;
$$;
revoke all on function public.workcraft_get_accepted_total_cents(uuid) from public, anon, authenticated, service_role;
grant execute on function public.workcraft_get_accepted_total_cents(uuid) to authenticated;

-- Reserve payment amounts from the customer's accepted snapshot, never from
-- estimate rows that may have changed after approval.
create or replace function public.workcraft_prepare_customer_payment(
  p_user_id uuid,
  p_estimate_id uuid,
  p_payment_kind text,
  p_stripe_account_id text
)
returns table(payment_id uuid, payment_kind text, amount_cents bigint, reused boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_estimate public.estimates%rowtype;
  v_acceptance public.estimate_acceptances%rowtype;
  v_existing public.customer_payments%rowtype;
  v_total_cents bigint;
  v_paid_cents bigint;
  v_due_cents bigint;
  v_expected_cents bigint;
  v_deposit_percent numeric;
  v_require_deposit boolean;
  v_connected_account_id text;
begin
  if p_payment_kind is null or p_payment_kind not in ('deposit', 'balance') then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_REQUEST';
  end if;
  if not public.workcraft_user_has_pro(p_user_id) then
    raise exception using errcode = '42501', message = 'WORKCRAFT_PRO_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_estimate_id::text, 0));
  select e.* into v_estimate
  from public.estimates e
  where e.id = p_estimate_id and e.user_id = p_user_id and e.status = 'accepted'
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ESTIMATE_NOT_PAYABLE';
  end if;

  select a.* into v_acceptance
  from public.estimate_acceptances a
  where a.estimate_id = p_estimate_id and a.user_id = p_user_id;
  if not found then
    raise exception using errcode = '42501', message = 'ESTIMATE_ACCEPTANCE_REQUIRED';
  end if;
  v_total_cents := v_acceptance.accepted_total_cents;
  v_require_deposit := coalesce((v_acceptance.proposal_snapshot ->> 'require_deposit')::boolean, false);
  v_deposit_percent := coalesce((v_acceptance.proposal_snapshot ->> 'deposit_percentage')::numeric, 0);
  if v_deposit_percent < 0 or v_deposit_percent > 100 then
    raise exception using errcode = '22023', message = 'INVALID_ACCEPTED_DEPOSIT_TERMS';
  end if;
  if v_total_cents <= 0 then
    raise exception using errcode = '22023', message = 'NO_REMAINING_BALANCE';
  end if;

  select ca.stripe_account_id into v_connected_account_id
  from public.stripe_connected_accounts ca
  where ca.user_id = p_user_id;
  if v_connected_account_id is null or v_connected_account_id <> p_stripe_account_id then
    raise exception using errcode = '42501', message = 'STRIPE_ACCOUNT_MISMATCH';
  end if;

  select coalesce(sum(greatest(cp.amount_cents - cp.amount_refunded_cents, 0)), 0)::bigint
    into v_paid_cents
  from public.customer_payments cp
  where cp.estimate_id = p_estimate_id
    and cp.status in ('succeeded', 'partially_refunded', 'refunded');

  v_due_cents := greatest(v_total_cents - v_paid_cents, 0);
  if p_payment_kind = 'deposit' then
    if not v_require_deposit or v_paid_cents > 0 then
      raise exception using errcode = '22023', message = 'DEPOSIT_NOT_AVAILABLE';
    end if;
    v_expected_cents := least(v_due_cents, pg_catalog.round(v_total_cents * v_deposit_percent / 100));
  else
    v_expected_cents := v_due_cents;
  end if;

  if v_expected_cents < 1 then
    raise exception using errcode = '22023', message = 'NO_REMAINING_BALANCE';
  end if;
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
  values (p_user_id, p_estimate_id, p_stripe_account_id, p_payment_kind, v_expected_cents)
  returning id into payment_id;
  payment_kind := p_payment_kind;
  amount_cents := v_expected_cents;
  reused := false;
  return next;
end;
$$;
revoke all on function public.workcraft_prepare_customer_payment(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.workcraft_prepare_customer_payment(uuid, uuid, text, text) to service_role;

-- An invoice/job can only be generated from a customer-approved snapshot.
create or replace function private.workcraft_require_acceptance_for_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.converted_job_id is distinct from old.converted_job_id
    and new.converted_job_id is not null
    and not exists (
      select 1 from public.estimate_acceptances a
      where a.estimate_id = new.id and a.user_id = new.user_id
    ) then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_ACCEPTANCE_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function private.workcraft_require_acceptance_for_job() from public, anon, authenticated;
drop trigger if exists workcraft_require_acceptance_for_job on public.estimates;
create trigger workcraft_require_acceptance_for_job
before update of converted_job_id on public.estimates
for each row execute function private.workcraft_require_acceptance_for_job();

-- The service-only shared-payment wrapper requires an owner-matched acceptance
-- snapshot before delegating to the existing serialized amount reservation.
create or replace function public.workcraft_prepare_shared_customer_payment(
  p_user_id uuid, p_estimate_id uuid, p_payment_kind text,
  p_stripe_account_id text, p_share_hash text
)
returns table(payment_id uuid, payment_kind text, amount_cents bigint, reused boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.workcraft_lock_customer_share(p_estimate_id, p_share_hash);
  if not exists (
    select 1 from public.estimate_acceptances a
    join public.estimates e on e.id = a.estimate_id and e.user_id = p_user_id
    where a.estimate_id = p_estimate_id and a.user_id = p_user_id
  ) then
    raise exception using errcode = '42501', message = 'ESTIMATE_ACCEPTANCE_REQUIRED';
  end if;
  return query select * from public.workcraft_prepare_customer_payment(
    p_user_id, p_estimate_id, p_payment_kind, p_stripe_account_id
  );
end;
$$;
revoke all on function public.workcraft_prepare_shared_customer_payment(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.workcraft_prepare_shared_customer_payment(uuid, uuid, text, text, text) to service_role;

-- A small aggregated counter records returned 5xx responses on critical paths
-- without request URLs, bodies, identities, or provider error text.
create table public.operational_http_failures (
  minute_started_at timestamptz not null,
  route text not null check (char_length(route) between 6 and 120),
  status_code smallint not null check (status_code between 500 and 599),
  failure_count integer not null default 1 check (failure_count > 0),
  primary key (minute_started_at, route, status_code)
);
create index operational_http_failures_recent_idx on public.operational_http_failures(minute_started_at desc);
alter table public.operational_http_failures enable row level security;
revoke all on public.operational_http_failures from public, anon, authenticated;
grant all on public.operational_http_failures to service_role;

create function public.workcraft_record_api_failure(p_route text, p_status_code integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_route is null or char_length(p_route) not between 6 and 120 or left(p_route, 5) <> '/api/'
    or p_route ~ '[?#]' or p_status_code not between 500 and 599 then
    raise exception using errcode = '22023', message = 'INVALID_API_FAILURE_METRIC';
  end if;
  insert into public.operational_http_failures(minute_started_at, route, status_code, failure_count)
  values (date_trunc('minute', clock_timestamp()), p_route, p_status_code, 1)
  on conflict (minute_started_at, route, status_code)
  do update set failure_count = operational_http_failures.failure_count + 1;
end;
$$;
revoke all on function public.workcraft_record_api_failure(text, integer) from public, anon, authenticated;
grant execute on function public.workcraft_record_api_failure(text, integer) to service_role;

create function public.workcraft_recent_api_failures(p_since timestamptz)
returns table(route text, failure_count bigint)
language sql security definer set search_path = '' as $$
  select f.route, sum(f.failure_count)::bigint
  from public.operational_http_failures f
  where f.minute_started_at >= p_since
  group by f.route
$$;
revoke all on function public.workcraft_recent_api_failures(timestamptz) from public, anon, authenticated;
grant execute on function public.workcraft_recent_api_failures(timestamptz) to service_role;

-- Preserve the existing pressure sample while adding active/waiting DB session
-- counts. These SQL sessions do not expose Supavisor's external pool queue.
create or replace function public.workcraft_db_pressure()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'connections', count(*),
    'max_connections', current_setting('max_connections')::integer,
    'active_connections', count(*) filter (where a.state = 'active'),
    'waiting_connections', count(*) filter (where a.state = 'active' and a.wait_event_type is not null),
    'idle_in_transaction', count(*) filter (where a.state = 'idle in transaction')
  )
  from pg_catalog.pg_stat_activity a
$$;
revoke all on function public.workcraft_db_pressure() from public, anon, authenticated, service_role;
grant execute on function public.workcraft_db_pressure() to service_role;

select cron.schedule('workcraft-prune-api-failure-metrics-daily', '25 4 * * *',
  $job$delete from public.operational_http_failures where minute_started_at < now() - interval '14 days';$job$);

commit;
