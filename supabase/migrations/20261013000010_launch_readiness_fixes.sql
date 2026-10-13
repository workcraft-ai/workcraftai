begin;
-- Claim app-owned rows; resolve Auth identities with the server Admin API.
create or replace function public.workcraft_claim_inactivity_notices(p_limit integer default 50)
returns table(user_id uuid, email text, language text, last_active_at timestamptz, claimed_at timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select l.user_id
    from public.tradeflow_account_lifecycle l
    where l.deletion_status = 'active'
      and l.last_active_at <= pg_catalog.now() - interval '12 months'
      and l.notice_sent_at is null
      and (l.notice_claimed_at is null or l.notice_claimed_at < pg_catalog.now() - interval '1 hour')
      and not exists (select 1 from public.tradeflow_admins a where a.user_id = l.user_id)
    order by l.last_active_at
    for update of l skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.tradeflow_account_lifecycle l
    set notice_claimed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    from candidates c where l.user_id = c.user_id
    returning l.user_id, l.last_active_at, l.notice_claimed_at
  )
  select c.user_id, null::text,
    'en'::text,
    c.last_active_at, c.notice_claimed_at
  from claimed c;
end;
$$;
create or replace function public.workcraft_claim_due_account_deletions(p_limit integer default 25)
returns table(user_id uuid, email text, language text, last_active_at timestamptz, reason text, claimed_at timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select l.user_id
    from public.tradeflow_account_lifecycle l
    where ((l.deletion_status = 'pending_deletion' and l.deletion_due_at <= pg_catalog.now())
      or (l.deletion_status = 'deleting' and l.deletion_due_at <= pg_catalog.now()
        and l.deletion_claimed_at < pg_catalog.now() - interval '1 hour'))
      and l.notice_sent_at is not null
      and l.last_active_at <= pg_catalog.now() - interval '12 months'
      and (l.deletion_claimed_at is null or l.deletion_claimed_at < pg_catalog.now() - interval '1 hour')
      and not exists (select 1 from public.tradeflow_admins a where a.user_id = l.user_id)
    order by l.deletion_due_at
    for update of l skip locked
    limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.tradeflow_account_lifecycle l
    set deletion_status = 'deleting', deletion_claimed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    from candidates c where l.user_id = c.user_id
    returning l.user_id, l.last_active_at, l.deletion_reason, l.deletion_claimed_at
  )
  select c.user_id, null::text,
    'en'::text,
    c.last_active_at, c.deletion_reason, c.deletion_claimed_at
  from claimed c;
end;
$$;
create or replace function public.workcraft_claim_failed_account_deletions(p_limit integer default 10)
returns table(user_id uuid, email text, language text, last_active_at timestamptz, reason text, claimed_at timestamptz)
language plpgsql
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select l.user_id
    from public.tradeflow_account_lifecycle l
    where l.deletion_status = 'deleting'
      and l.deletion_due_at is null
      and l.deletion_claimed_at < pg_catalog.now() - interval '1 hour'
      and not exists (select 1 from public.tradeflow_admins a where a.user_id = l.user_id)
    order by l.deletion_claimed_at
    for update of l skip locked
    limit greatest(1, least(p_limit, 50))
  ), claimed as (
    update public.tradeflow_account_lifecycle l
    set deletion_claimed_at = pg_catalog.now(), updated_at = pg_catalog.now()
    from candidates c where l.user_id = c.user_id
    returning l.user_id, l.last_active_at, l.deletion_reason, l.deletion_claimed_at
  )
  select c.user_id, null::text,
    'en'::text,
    c.last_active_at, c.deletion_reason, c.deletion_claimed_at
  from claimed c;
end;
$$;

-- Auth sends are synchronous only. Generic cron cannot deliver pre-commit tokens.
create or replace function public.workcraft_claim_notifications(p_limit integer default 10,p_ids uuid[] default null)
returns setof public.notification_outbox language sql security definer set search_path='' as $$
 with due as (
  select o.id from public.notification_outbox o
  where (p_ids is null or o.id=any(p_ids)) and o.next_attempt_at<=now()
    and (p_ids is not null or o.source<>'auth')
    and (o.status='pending' or (o.status='sending' and o.lease_until<now()))
  order by case when o.source='billing' then 0 else 1 end,o.next_attempt_at
  for update skip locked limit greatest(1,least(p_limit,20))
 ) update public.notification_outbox o set status='sending',lease_until=now()+interval '2 minutes',attempts=attempts+1
 from due where o.id=due.id returning o.*;
$$;
revoke all on function public.workcraft_claim_notifications(integer,uuid[]) from public,anon,authenticated;
grant execute on function public.workcraft_claim_notifications(integer,uuid[]) to service_role;

-- One RPC reserves admission and claims the signed Auth attempt. No token/body
-- is persisted. A retry reuses its reservation and provider idempotency key.
create function public.workcraft_prepare_auth_email(p_send_key text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.notification_outbox%rowtype; q record;
begin
 if p_send_key !~ '^auth-[a-f0-9]{64}$' then raise exception 'INVALID_AUTH_KEY'; end if;
 insert into public.notification_outbox(source,send_key,status,payload)
 values('auth',p_send_key,'failed','{}'::jsonb) on conflict(send_key) do nothing;
 select * into r from public.notification_outbox where send_key=p_send_key for update;
 if r.status='sent' then return jsonb_build_object('id',r.id,'sent',true,'allowed',true); end if;
 if r.status='sending' and r.lease_until>clock_timestamp() then return jsonb_build_object('id',r.id,'sent',false,'allowed',false); end if;
 if r.reservation_id is null then
  select * into q from public.workcraft_reserve_app_email('auth',null,null,null);
  if not q.allowed then return jsonb_build_object('id',r.id,'sent',false,'allowed',false); end if;
  r.reservation_id:=q.reservation_id;
 end if;
 update public.notification_outbox set status='sending',lease_until=clock_timestamp()+interval '15 seconds',
 reservation_id=r.reservation_id,first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),attempts=attempts+1,payload='{}'::jsonb
 where id=r.id;
 return jsonb_build_object('id',r.id,'sent',false,'allowed',true);
end; $$;
revoke all on function public.workcraft_prepare_auth_email(text) from public,anon,authenticated;
grant execute on function public.workcraft_prepare_auth_email(text) to service_role;

-- Preserve accepted tax snapshots, including valid zero-tax totals. A manual
-- job without a matching estimate has unknown tax unless its quote is zero.
alter table public.jobs add column quoted_tax_cents bigint check(quoted_tax_cents is null or quoted_tax_cents>=0);
create function private.workcraft_snapshot_job_tax() returns trigger
language plpgsql security invoker set search_path='' as $$
declare e public.estimates%rowtype; subtotal numeric; markup numeric; tax numeric;
begin
 new.quoted_tax_cents:=null;
 if coalesce(new.quoted_total,0)=0 then new.quoted_tax_cents:=0; return new; end if;
 select * into e from public.estimates where id::text=new.estimate_id and user_id=new.user_id;
 if not found then return new; end if;
 if e.selected_package is not null then
  select round((o.value->>'total')::numeric*100) into subtotal from jsonb_array_elements(coalesce(e.package_options,'[]'::jsonb)) o(value) where o.value->>'name'=e.selected_package limit 1;
  if subtotal is null then return new; end if;
  markup:=0;
 else
  select coalesce(sum(round(quantity*unit_price*100)),0) into subtotal from public.line_items where estimate_id=e.id;
  markup:=round(subtotal*coalesce(e.markup_percentage,0)/100);
 end if;
 tax:=round((subtotal+markup)*coalesce(e.tax_rate,0)/100);
 if subtotal+markup+tax=round(new.quoted_total*100) then new.quoted_tax_cents:=tax::bigint; end if;
 return new;
end; $$;
revoke all on function private.workcraft_snapshot_job_tax() from public,anon,authenticated;
create trigger workcraft_job_tax_snapshot before insert or update of quoted_total,estimate_id,user_id,quoted_tax_cents on public.jobs
for each row execute function private.workcraft_snapshot_job_tax();
update public.jobs set quoted_tax_cents=null;

-- One owner-scoped aggregate response avoids REST row-cap truncation and
-- computes all financial summaries from a single statement snapshot.
create function public.workcraft_report_snapshot() returns jsonb
language sql security invoker set search_path='' as $$
 with owned as (select * from public.estimates where user_id=(select auth.uid())),
 sums as (select e.id,coalesce(sum(round(l.quantity*l.unit_price*100)),0) as cents from owned e left join public.line_items l on l.estimate_id=e.id group by e.id),
 priced as (select e.*,case when e.selected_package is not null then
  (select round((o.value->>'total')::numeric*100) from jsonb_array_elements(coalesce(e.package_options,'[]'::jsonb)) o(value) where o.value->>'name'=e.selected_package limit 1)
  else s.cents+round(s.cents*coalesce(e.markup_percentage,0)/100) end as pretax from owned e join sums s on s.id=e.id),
 totals as (select id,reference_number,status,created_at,coalesce(pretax,0)+round(coalesce(pretax,0)*coalesce(tax_rate,0)/100) as total_cents from priced),
 completed as (select * from public.jobs where user_id=(select auth.uid()) and status='completed' and private.workcraft_user_has_pro((select auth.uid())))
 select jsonb_build_object('estimates',coalesce((select jsonb_agg(t order by t.created_at desc,t.id) from totals t),'[]'::jsonb),
 'completed_count',(select count(*) from completed),
 'completed_total_cents',(select coalesce(sum(round(quoted_total*100)),0) from completed),
 'revenue_cents',(select coalesce(sum(round(quoted_total*100)-quoted_tax_cents) filter(where quoted_tax_cents is not null),0) from completed),
 'cost_cents',(select coalesce(sum(round(actual_cost*100)) filter(where quoted_tax_cents is not null),0) from completed),
 'unknown_tax_count',(select count(*) from completed where quoted_tax_cents is null));
$$;
revoke all on function public.workcraft_report_snapshot() from public,anon;
grant execute on function public.workcraft_report_snapshot() to authenticated;

create function public.workcraft_legacy_share_secrets(p_limit integer default 10)
returns table(estimate_id uuid,encrypted_token text,share_token_hash text) language sql security invoker set search_path='' as $$
 select s.estimate_id,s.encrypted_token,e.share_token_hash from private.proposal_share_secrets s join public.estimates e on e.id=s.estimate_id where s.encrypted_token not like 'v2:%' order by s.estimate_id limit greatest(1,least(p_limit,20));
$$;
revoke all on function public.workcraft_legacy_share_secrets(integer) from public,anon,authenticated;
grant execute on function public.workcraft_legacy_share_secrets(integer) to service_role;
create function public.workcraft_upgrade_share_secret(p_id uuid,p_previous text,p_current text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_current not like 'v2:%' or length(p_current)>512 then raise exception 'INVALID_SHARE_ENVELOPE'; end if;
 update private.proposal_share_secrets set encrypted_token=p_current,updated_at=now() where estimate_id=p_id and encrypted_token=p_previous;
 return found;
end; $$;
revoke all on function public.workcraft_upgrade_share_secret(uuid,text,text) from public,anon,authenticated;
grant execute on function public.workcraft_upgrade_share_secret(uuid,text,text) to service_role;
commit;
