begin;

-- Account-private preferences and first authenticated app visit. Older accounts
-- are not silently enrolled in a new engagement sequence.
create table public.workcraft_engagement_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_app_visit_at timestamptz not null default now(),
  onboarding_enabled boolean not null default true,
  tips_opted_in_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.workcraft_engagement_preferences enable row level security;
revoke all on public.workcraft_engagement_preferences from public, anon, authenticated;
grant all on public.workcraft_engagement_preferences to service_role;

-- Set on the first enabled send run, so accounts created while the feature is
-- paused for mailing-address setup are not enrolled retroactively.
create table public.workcraft_engagement_rollout (
  id integer primary key check (id = 1),
  launched_at timestamptz
);
insert into public.workcraft_engagement_rollout(id) values (1);
alter table public.workcraft_engagement_rollout enable row level security;
revoke all on public.workcraft_engagement_rollout from public, anon, authenticated;
grant all on public.workcraft_engagement_rollout to service_role;

create table public.workcraft_engagement_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign text not null check (campaign in ('first_estimate','preview_estimate','price_book','reactivation','monthly_tip')),
  anchor_at timestamptz not null,
  estimate_id uuid references public.estimates(id) on delete set null,
  unsubscribe_token text not null unique check (length(unsubscribe_token) between 32 and 100),
  outbox_id uuid references public.notification_outbox(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, campaign, anchor_at)
);
create index workcraft_engagement_messages_recent_idx on public.workcraft_engagement_messages(created_at desc);
create index workcraft_engagement_messages_user_idx on public.workcraft_engagement_messages(user_id, created_at desc);
alter table public.workcraft_engagement_messages enable row level security;
revoke all on public.workcraft_engagement_messages from public, anon, authenticated;
grant all on public.workcraft_engagement_messages to service_role;

alter table public.notification_outbox drop constraint notification_outbox_source_check;
alter table public.notification_outbox add constraint notification_outbox_source_check
  check (source in ('estimate','proposal_question','invoice','follow_up','billing','auth','welcome','engagement'));

-- The service-role worker fetches only due, confirmed accounts and always
-- rechecks activity before queuing. Four campaign choices are mutually exclusive
-- on one run; the seven-day tip is deliberately later than the day-two nudge.
create function public.workcraft_engagement_candidates(p_limit integer default 20)
returns table(user_id uuid, email text, language text, campaign text, anchor_at timestamptz, estimate_id uuid, trade text)
language sql security definer set search_path = '' as $$
  select u.id, u.email,
    case when u.raw_user_meta_data->>'app_language' = 'es' then 'es' else 'en' end,
    choice.campaign,
    case when choice.campaign = 'reactivation' then l.last_active_at else p.first_app_visit_at end,
    e.id, e.trade
  from public.workcraft_engagement_preferences p
  cross join public.workcraft_engagement_rollout r
  join auth.users u on u.id = p.user_id
  join public.tradeflow_account_lifecycle l on l.user_id = u.id and l.deletion_status = 'active'
  left join lateral (
    select id, trade from public.estimates where user_id = u.id
    order by created_at desc limit 1
  ) e on true
  left join public.workcraft_onboarding o on o.user_id = u.id
  cross join lateral (
    select case
      when r.launched_at is not null and u.created_at >= r.launched_at
        and p.onboarding_enabled and p.first_app_visit_at <= now() - interval '2 days'
        and e.id is null and not exists (
          select 1 from public.workcraft_engagement_messages m where m.user_id = u.id
            and m.campaign = 'first_estimate' and m.anchor_at = p.first_app_visit_at
        ) then 'first_estimate'
      when r.launched_at is not null and u.created_at >= r.launched_at
        and p.onboarding_enabled and p.first_app_visit_at <= now() - interval '7 days'
        and e.id is not null and o.previewed_at is null and o.shared_link_at is null
        and not exists (select 1 from public.estimate_email_events ee where ee.user_id = u.id and ee.event = 'sent')
        and not exists (select 1 from public.workcraft_engagement_messages m where m.user_id = u.id
          and m.campaign = 'preview_estimate' and m.anchor_at = p.first_app_visit_at)
        then 'preview_estimate'
      when r.launched_at is not null and u.created_at >= r.launched_at
        and p.onboarding_enabled and p.first_app_visit_at <= now() - interval '7 days'
        and e.id is not null and (o.shared_link_at is not null or exists
          (select 1 from public.estimate_email_events ee where ee.user_id = u.id and ee.event = 'sent'))
        and not exists (select 1 from public.price_book_items b where b.user_id = u.id)
        and not exists (select 1 from public.workcraft_engagement_messages m where m.user_id = u.id
          and m.campaign = 'price_book' and m.anchor_at = p.first_app_visit_at)
        then 'price_book'
      when r.launched_at is not null and u.created_at >= r.launched_at
        and p.onboarding_enabled and l.last_active_at <= now() - interval '14 days'
        and not exists (select 1 from public.workcraft_engagement_messages m where m.user_id = u.id
          and m.campaign = 'reactivation' and m.anchor_at = l.last_active_at)
        then 'reactivation'
      when p.tips_opted_in_at is not null and p.first_app_visit_at <= now() - interval '30 days'
        and l.last_active_at >= now() - interval '7 days'
        and not exists (select 1 from public.workcraft_engagement_messages m where m.user_id = u.id
          and m.campaign = 'monthly_tip' and m.anchor_at = p.first_app_visit_at)
        then 'monthly_tip'
    end as campaign
  ) choice
  where u.email_confirmed_at is not null and u.email is not null
    and choice.campaign is not null
    and not exists (
      select 1 from public.workcraft_engagement_messages m
      where m.user_id = u.id and m.campaign = choice.campaign
        and m.anchor_at = case when choice.campaign = 'reactivation' then l.last_active_at else p.first_app_visit_at end
    )
  order by p.first_app_visit_at, u.id
  limit greatest(1, least(p_limit, 25));
$$;
revoke all on function public.workcraft_engagement_candidates(integer) from public, anon, authenticated;
grant execute on function public.workcraft_engagement_candidates(integer) to service_role;

create function public.workcraft_engagement_send_allowed(p_outbox_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select coalesce((
    select u.email_confirmed_at is not null
      and case
        when m.campaign = 'monthly_tip' then p.tips_opted_in_at is not null
          and l.last_active_at >= now() - interval '7 days'
        when not p.onboarding_enabled then false
        when m.campaign = 'first_estimate' then not exists
          (select 1 from public.estimates e where e.user_id = m.user_id)
        when m.campaign = 'preview_estimate' then o.previewed_at is null and o.shared_link_at is null
          and exists (select 1 from public.estimates e where e.id = m.estimate_id and e.user_id = m.user_id)
          and not exists (select 1 from public.estimate_email_events ee
            where ee.user_id = m.user_id and ee.event = 'sent')
        when m.campaign = 'price_book' then not exists
          (select 1 from public.price_book_items b where b.user_id = m.user_id)
          and (o.shared_link_at is not null or exists
            (select 1 from public.estimate_email_events ee where ee.user_id = m.user_id and ee.event = 'sent'))
        when m.campaign = 'reactivation' then l.last_active_at = m.anchor_at
          and l.last_active_at <= now() - interval '14 days'
        else false
      end
    from public.workcraft_engagement_messages m
    join public.workcraft_engagement_preferences p on p.user_id = m.user_id
    join public.tradeflow_account_lifecycle l on l.user_id = m.user_id and l.deletion_status = 'active'
    join auth.users u on u.id = m.user_id
    left join public.workcraft_onboarding o on o.user_id = m.user_id
    where m.outbox_id = p_outbox_id
  ), false);
$$;
revoke all on function public.workcraft_engagement_send_allowed(uuid) from public, anon, authenticated;
grant execute on function public.workcraft_engagement_send_allowed(uuid) to service_role;

create function public.workcraft_engagement_admin_snapshot()
returns jsonb language sql security definer set search_path = '' as $$
  with activity as (
    select m.id, m.user_id, u.email, m.campaign, m.created_at, o.status, o.sent_at,
      o.last_error, o.provider_email_id,
      case when o.provider_email_id is null then null else (
        select ev.event from public.transactional_email_events ev
        where ev.provider_email_id = o.provider_email_id
        order by ev.created_at desc limit 1
      ) end as delivery,
      case when o.sent_at is null then false
        when m.campaign = 'first_estimate' then exists (
          select 1 from public.estimates e where e.user_id = m.user_id
            and e.created_at > o.sent_at and e.created_at <= o.sent_at + interval '7 days')
        when m.campaign = 'preview_estimate' then exists (
          select 1 from public.workcraft_onboarding p where p.user_id = m.user_id
            and (p.previewed_at between o.sent_at and o.sent_at + interval '7 days'
              or p.shared_link_at between o.sent_at and o.sent_at + interval '7 days'))
          or exists (select 1 from public.estimate_email_events ee where ee.user_id = m.user_id
            and ee.event = 'sent' and ee.created_at between o.sent_at and o.sent_at + interval '7 days')
        when m.campaign = 'price_book' then exists (
          select 1 from public.price_book_items b where b.user_id = m.user_id
            and b.created_at between o.sent_at and o.sent_at + interval '7 days')
        else exists (
          select 1 from public.tradeflow_account_lifecycle l where l.user_id = m.user_id
            and l.last_active_at > o.sent_at and l.last_active_at <= o.sent_at + interval '7 days')
      end as action_within_7d
    from public.workcraft_engagement_messages m
    join auth.users u on u.id = m.user_id
    left join public.notification_outbox o on o.id = m.outbox_id
    where m.created_at >= now() - interval '90 days'
  )
  select jsonb_build_object(
    'opted_in_to_monthly_tips', (select count(*) from public.workcraft_engagement_preferences where tips_opted_in_at is not null),
    'summary', coalesce((select jsonb_agg(to_jsonb(s)) from (
      select campaign, count(*) as queued,
        count(*) filter (where status = 'sent') as sent,
        count(*) filter (where status = 'failed') as failed,
        count(*) filter (where delivery = 'delivered') as delivered,
        count(*) filter (where delivery in ('bounced','complained')) as delivery_issues,
        count(*) filter (where status = 'sent' and sent_at <= now() - interval '7 days') as seven_day_cohort,
        count(*) filter (where status = 'sent' and sent_at <= now() - interval '7 days' and action_within_7d) as seven_day_actions
      from activity group by campaign order by campaign
    ) s), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(r)) from (
      select email, campaign, created_at, status, sent_at, delivery, action_within_7d,
        case when last_error in ('superseded_or_unsubscribed','quota_lookup','idempotency_window_expired')
          then last_error else null end as reason
      from activity order by created_at desc limit 40
    ) r), '[]'::jsonb)
  );
$$;
revoke all on function public.workcraft_engagement_admin_snapshot() from public, anon, authenticated;
grant execute on function public.workcraft_engagement_admin_snapshot() to service_role;

commit;
