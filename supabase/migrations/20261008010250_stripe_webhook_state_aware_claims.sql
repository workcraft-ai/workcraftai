-- Return the durable claim state so the webhook can distinguish an already
-- completed event (HTTP 200) from an in-flight event (HTTP 503 for Stripe retry).
-- Keep the original boolean RPC during the rollout so old app deployments work.
create or replace function public.workcraft_claim_stripe_webhook_state(p_event_id text, p_event_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean := false;
  v_status text;
begin
  insert into public.stripe_webhook_events(event_id, event_type, status)
  values (p_event_id, p_event_type, 'processing')
  on conflict (event_id) do update set
    event_type = excluded.event_type,
    status = 'processing',
    attempts = public.stripe_webhook_events.attempts + 1,
    processing_started_at = pg_catalog.now(),
    last_error = null
  where public.stripe_webhook_events.status <> 'processed'
    and (public.stripe_webhook_events.status <> 'processing'
      or public.stripe_webhook_events.processing_started_at < pg_catalog.now() - interval '5 minutes')
  returning true into v_claimed;

  if coalesce(v_claimed, false) then
    return 'claimed';
  end if;

  select event.status into v_status
  from public.stripe_webhook_events as event
  where event.event_id = p_event_id;

  if not found then
    return 'retry';
  end if;
  if v_status = 'processed' then
    return 'processed';
  end if;
  return 'processing';
end;
$$;
revoke all on function public.workcraft_claim_stripe_webhook_state(text, text) from public, anon, authenticated;
grant execute on function public.workcraft_claim_stripe_webhook_state(text, text) to service_role;
