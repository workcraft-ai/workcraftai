begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a9000000-0000-4000-8000-000000000001', 'media-preflight-pro@example.test', '{}'),
  ('a9000000-0000-4000-8000-000000000002', 'media-preflight-free@example.test', '{}');
insert into public.subscriptions (user_id, status)
values ('a9000000-0000-4000-8000-000000000001', 'active');
insert into public.estimates (id, user_id, client_name, client_email, status, tax_rate)
values
  ('b9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'Media preflight Pro', 'fixture@example.test', 'pending', 0),
  ('b9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 'Media preflight Free', 'fixture@example.test', 'pending', 0);

select ok(
  position('pg_advisory_xact_lock' in pg_get_functiondef(
    'private.workcraft_can_upload_estimate_media(text,bigint,bigint,text)'::regprocedure
  )) > 0,
  'per-account media limits remain serialized during concurrent Storage inserts'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000001';
select is(
  (select allowed from public.workcraft_reserve_estimate_media_upload(
    'b9000000-0000-4000-8000-000000000001',
    'a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png',
    1024,
    'image/png'
  )),
  true, 'Pro account reserves a supported file for its own estimate'
);
select is(
  private.workcraft_can_upload_estimate_media(
    'a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png', null, 4096, 'image/png'
  ),
  true, 'Storage upload preflight accepts contentLength with multipart overhead'
);
select is(
  private.workcraft_can_upload_estimate_media(
    'a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png', null, null, 'image/png'
  ),
  true, 'Storage upload preflight without a declared length still requires a valid reservation'
);
select is(
  private.workcraft_can_upload_estimate_media(
    'a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png', null, 1050113, 'image/png'
  ),
  false, 'preflight rejects a declared request size more than 1 MiB above its reservation'
);
select is(
  private.workcraft_can_upload_estimate_media(
    'a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png', 1024, null, 'image/png'
  ),
  true, 'completed object must match the exact reserved byte count'
);
select is(
  private.workcraft_can_upload_estimate_media(
    'a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png', 1025, null, 'image/png'
  ),
  false, 'completed object cannot exceed its reserved byte count'
);
select is(
  private.workcraft_can_upload_estimate_media(
    'a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png', 15728641, null, 'image/png'
  ),
  false, 'completed object larger than the bucket limit is denied'
);

set local request.jwt.claim.sub = 'a9000000-0000-4000-8000-000000000002';
select is(
  private.workcraft_can_upload_estimate_media(
    'a9000000-0000-4000-8000-000000000002/b9000000-0000-4000-8000-000000000002/photo.png', 1024, null, 'image/png'
  ),
  false, 'Free users cannot upload estimate media'
);

select * from finish();
rollback;
