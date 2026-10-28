-- Queue one internal alert for each account created through the app signup.
alter table public.notification_outbox drop constraint if exists notification_outbox_source_check;
alter table public.notification_outbox add constraint notification_outbox_source_check
  check (source in ('estimate','proposal_question','invoice','follow_up','billing','auth','welcome','engagement','signup_alert'));

create or replace function private.workcraft_enqueue_signup_alert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and new.raw_user_meta_data ->> 'workcraft_terms_accepted' = 'true' then
    insert into public.notification_outbox(user_id, source, send_key)
    values(new.id, 'signup_alert', 'signup-alert-' || new.id::text)
    on conflict (send_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.workcraft_enqueue_signup_alert() from public, anon, authenticated;
drop trigger if exists workcraft_queue_signup_alert on auth.users;
create trigger workcraft_queue_signup_alert after insert on auth.users
  for each row execute function private.workcraft_enqueue_signup_alert();
