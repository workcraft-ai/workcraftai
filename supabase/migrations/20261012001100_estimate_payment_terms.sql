begin;

alter table public.estimates
  add column payment_terms text,
  add column payment_terms_es text;
alter table public.estimates
  add constraint estimates_payment_terms_length_check check (payment_terms is null or char_length(payment_terms) <= 1000),
  add constraint estimates_payment_terms_es_length_check check (payment_terms_es is null or char_length(payment_terms_es) <= 1000);

-- Wrap the existing atomic estimate RPCs so commercial terms share their transaction.
create function public.workcraft_create_estimate_with_terms(p_estimate jsonb, p_line_items jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare v_id uuid;
begin
  if char_length(coalesce(p_estimate ->> 'payment_terms', '')) > 1000
    or char_length(coalesce(p_estimate ->> 'payment_terms_es', '')) > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_TERMS';
  end if;
  v_id := public.workcraft_create_estimate_with_items(p_estimate, p_line_items);
  update public.estimates set
    payment_terms = nullif(btrim(p_estimate ->> 'payment_terms'), ''),
    payment_terms_es = nullif(btrim(p_estimate ->> 'payment_terms_es'), '')
  where id = v_id and user_id = auth.uid();
  if not found then raise exception using errcode = '42501', message = 'ESTIMATE_TERMS_NOT_SAVED'; end if;
  return v_id;
end;
$$;
revoke all on function public.workcraft_create_estimate_with_terms(jsonb,jsonb) from public,anon;
grant execute on function public.workcraft_create_estimate_with_terms(jsonb,jsonb) to authenticated;

create function public.workcraft_replace_estimate_with_terms(p_estimate_id uuid,p_estimate jsonb,p_line_items jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if char_length(coalesce(p_estimate ->> 'payment_terms', '')) > 1000
    or char_length(coalesce(p_estimate ->> 'payment_terms_es', '')) > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_PAYMENT_TERMS';
  end if;
  perform public.workcraft_replace_estimate_with_items(p_estimate_id,p_estimate,p_line_items);
  update public.estimates set
    payment_terms = case when p_estimate ? 'payment_terms' then nullif(btrim(p_estimate ->> 'payment_terms'), '') else payment_terms end,
    payment_terms_es = case when p_estimate ? 'payment_terms_es' then nullif(btrim(p_estimate ->> 'payment_terms_es'), '') else payment_terms_es end
  where id = p_estimate_id and user_id = auth.uid() and lower(coalesce(status,'pending')) = 'pending';
  if not found then raise exception using errcode = '42501', message = 'ESTIMATE_TERMS_NOT_SAVED'; end if;
end;
$$;
revoke all on function public.workcraft_replace_estimate_with_terms(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.workcraft_replace_estimate_with_terms(uuid,jsonb,jsonb) to authenticated;

-- Acceptance snapshots retain the exact terms shown on the customer proposal.
create or replace function public.workcraft_accept_shared_estimate(p_estimate_id uuid,p_signature_name text,p_selected_package text,p_share_hash text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_total bigint;
begin
  perform private.workcraft_lock_customer_share(p_estimate_id,p_share_hash);
  v_total := public.workcraft_accept_estimate_once(p_estimate_id,p_signature_name,p_selected_package);
  update public.estimate_acceptances a set proposal_snapshot = a.proposal_snapshot ||
    jsonb_build_object('payment_terms', e.payment_terms, 'payment_terms_es', e.payment_terms_es)
  from public.estimates e where a.estimate_id = p_estimate_id and e.id = a.estimate_id;
  return v_total;
end;
$$;
revoke all on function public.workcraft_accept_shared_estimate(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.workcraft_accept_shared_estimate(uuid,text,text,text) to service_role;

commit;
