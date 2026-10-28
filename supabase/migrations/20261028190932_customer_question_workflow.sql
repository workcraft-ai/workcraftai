-- A question can be read, responded to, and archived independently.
alter table public.proposal_questions
  add column if not exists responded_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Owners may change only the workflow fields, and may delete only their rows.
revoke update on public.proposal_questions from authenticated;
grant update (read_at, responded_at, archived_at) on public.proposal_questions to authenticated;
grant delete on public.proposal_questions to authenticated;
create policy "Contractors delete their proposal questions"
  on public.proposal_questions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Give a bell notification a direct link to its question. Deleting a question
-- also removes its corresponding bell notification.
alter table public.contractor_notifications
  add column if not exists question_id uuid references public.proposal_questions(id) on delete cascade;
grant select (question_id) on public.contractor_notifications to authenticated;

update public.contractor_notifications n
set question_id = q.id
from public.proposal_questions q
where n.event_type = 'customer_question'
  and n.question_id is null
  and n.source_key = 'question:' || q.id::text
  and n.user_id = q.user_id
  and n.estimate_id::text = q.estimate_id;

create or replace function private.workcraft_notify_proposal_question()
returns trigger language plpgsql set search_path = '' as $$
declare v_estimate public.estimates%rowtype;
begin
  select e.* into v_estimate from public.estimates e
  where e.id::text = new.estimate_id and e.user_id = new.user_id;
  if not found then return new; end if;

  insert into public.contractor_notifications(
    user_id, estimate_id, event_type, customer_name, estimate_reference, source_key, question_id
  ) values (
    v_estimate.user_id, v_estimate.id, 'customer_question',
    pg_catalog.left(coalesce(nullif(pg_catalog.btrim(new.customer_name), ''), 'Customer'), 120),
    v_estimate.reference_number, 'question:' || new.id::text, new.id
  ) on conflict (source_key) do nothing;

  delete from public.contractor_notifications n
  where n.user_id = v_estimate.user_id and n.read_at is not null
    and n.created_at < pg_catalog.now() - interval '90 days';
  return new;
end;
$$;
revoke all on function private.workcraft_notify_proposal_question() from public, anon, authenticated;
