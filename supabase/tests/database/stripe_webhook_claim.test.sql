begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.stripe_webhook_events'::regclass),
  'Stripe webhook event records keep RLS enabled'
);
select ok(
  has_function_privilege('service_role', 'public.workcraft_claim_stripe_webhook_state(text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.workcraft_claim_stripe_webhook_state(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.workcraft_claim_stripe_webhook_state(text,text)', 'EXECUTE'),
  'only the service role can claim Stripe events'
);
select is(
  (select array_position(proconfig, 'search_path=""') from pg_proc where oid = 'public.workcraft_claim_stripe_webhook_state(text,text)'::regprocedure),
  1,
  'the claim function pins an empty search_path'
);

set local role service_role;
select is(
  public.workcraft_claim_stripe_webhook_state('evt_claim_retry_test_01', 'payment_intent.succeeded'),
  'claimed',
  'a new event is claimed for processing'
);
select is(
  public.workcraft_claim_stripe_webhook_state('evt_claim_retry_test_01', 'payment_intent.succeeded'),
  'processing',
  'an active claim is reported as in flight, not as a completed duplicate'
);
select lives_ok(
  $$select public.workcraft_fail_stripe_webhook('evt_claim_retry_test_01', 'test failure')$$,
  'a failed event can be marked retryable'
);
select is(
  public.workcraft_claim_stripe_webhook_state('evt_claim_retry_test_01', 'payment_intent.succeeded'),
  'claimed',
  'Stripe can reclaim an event after processing failed'
);
select lives_ok(
  $$select public.workcraft_complete_stripe_webhook('evt_claim_retry_test_01')$$,
  'a claimed event can be marked complete'
);
select is(
  public.workcraft_claim_stripe_webhook_state('evt_claim_retry_test_01', 'payment_intent.succeeded'),
  'processed',
  'a completed event is identified as a duplicate'
);

insert into public.stripe_webhook_events (event_id, event_type, status, processing_started_at)
values ('evt_claim_retry_test_02', 'charge.refunded', 'processing', pg_catalog.now() - interval '6 minutes');
select is(
  public.workcraft_claim_stripe_webhook_state('evt_claim_retry_test_02', 'charge.refunded'),
  'claimed',
  'a stale processing lease can be recovered for Stripe retry'
);
reset role;

select * from finish();
rollback;
