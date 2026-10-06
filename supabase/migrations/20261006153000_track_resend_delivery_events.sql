-- Record signed Resend delivery events and make event ingestion backend-only.
alter table public.estimate_email_events
  add column if not exists provider_event_id text;

create unique index if not exists estimate_email_events_provider_event_id_uidx
  on public.estimate_email_events(provider_event_id)
  where provider_event_id is not null;

drop policy if exists "Users record their estimate email events" on public.estimate_email_events;
revoke insert on public.estimate_email_events from anon, authenticated;
grant select on public.estimate_email_events to authenticated;

comment on column public.estimate_email_events.provider_event_id is
  'Verified Resend/Svix event ID used to deduplicate delivery status updates.';
