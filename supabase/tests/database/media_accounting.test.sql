begin;create extension if not exists pgtap with schema extensions;select plan(8);
insert into auth.users (id, email, raw_user_meta_data) values
  ('a9000000-0000-4000-8000-000000000001', 'media-preflight-pro@example.test', '{}'),
  ('a9000000-0000-4000-8000-000000000002', 'media-preflight-free@example.test', '{}');
insert into public.subscriptions (user_id, status)
values ('a9000000-0000-4000-8000-000000000001', 'active');
insert into public.estimates (id, user_id, client_name, client_email, status, tax_rate)
values
  ('b9000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'Media preflight Pro', 'fixture@example.test', 'pending', 0),
  ('b9000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000002', 'Media preflight Free', 'fixture@example.test', 'pending', 0);


set local role authenticated;
set local request.jwt.claim.sub='a9000000-0000-4000-8000-000000000001';
select is((select allowed from public.workcraft_reserve_estimate_media_upload('b9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png',1024,'image/png')),true,'upload is admitted');
reset role;
insert into storage.objects(bucket_id,name,metadata) values('estimate-media','a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png','{"size":1024,"mimetype":"image/png"}');
select is((select bytes_uploaded from public.tradeflow_media_monthly_usage where user_id='a9000000-0000-4000-8000-000000000001'),null::bigint,'successful object still awaits finalization');
set local role authenticated;
select is(private.workcraft_can_delete_estimate_media('a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png'),false,'pending upload cannot be deleted to erase accounting evidence');
reset role;
select set_config('test.reservation',(select id::text from public.tradeflow_media_upload_reservations where user_id='a9000000-0000-4000-8000-000000000001'),true);
set local role authenticated;
select is(public.workcraft_finish_estimate_media_upload(current_setting('test.reservation')::uuid,false),true,'browser false flag does not release a stored object');
select is(public.workcraft_finish_estimate_media_upload(current_setting('test.reservation')::uuid,true),true,'double finalization succeeds idempotently');
select is(private.workcraft_can_delete_estimate_media('a9000000-0000-4000-8000-000000000001/b9000000-0000-4000-8000-000000000001/photo.png'),true,'accounted object can be deleted');
set local request.jwt.claim.sub='a9000000-0000-4000-8000-000000000002';
select is(public.workcraft_finish_estimate_media_upload(current_setting('test.reservation')::uuid,true),false,'other account cannot finalize this upload');
reset role;
select is((select bytes_uploaded from public.tradeflow_media_monthly_usage where user_id='a9000000-0000-4000-8000-000000000001'),1024::bigint,'the actual bytes were charged exactly once');
select * from finish();rollback;
