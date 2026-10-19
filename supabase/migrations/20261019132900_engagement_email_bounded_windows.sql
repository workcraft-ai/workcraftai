begin;

-- Keep onboarding tips near the intended milestones when the optional
-- scheduler is deferred by essential mail or provider capacity.
create or replace function public.workcraft_engagement_candidates(p_limit integer default 20)
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
        and p.onboarding_enabled and p.first_app_visit_at between now() - interval '7 days' and now() - interval '2 days'
        and e.id is null and not exists (
          select 1 from public.workcraft_engagement_messages m where m.user_id = u.id
            and m.campaign = 'first_estimate' and m.anchor_at = p.first_app_visit_at
        ) then 'first_estimate'
      when r.launched_at is not null and u.created_at >= r.launched_at
        and p.onboarding_enabled and p.first_app_visit_at between now() - interval '14 days' and now() - interval '7 days'
        and e.id is not null and o.previewed_at is null and o.shared_link_at is null
        and not exists (select 1 from public.estimate_email_events ee where ee.user_id = u.id and ee.event = 'sent')
        and not exists (select 1 from public.workcraft_engagement_messages m where m.user_id = u.id
          and m.campaign = 'preview_estimate' and m.anchor_at = p.first_app_visit_at)
        then 'preview_estimate'
      when r.launched_at is not null and u.created_at >= r.launched_at
        and p.onboarding_enabled and p.first_app_visit_at between now() - interval '14 days' and now() - interval '7 days'
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
      when p.tips_opted_in_at is not null and p.first_app_visit_at between now() - interval '45 days' and now() - interval '30 days'
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

commit;
