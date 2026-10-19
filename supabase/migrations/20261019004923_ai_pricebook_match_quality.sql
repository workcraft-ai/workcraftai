-- Private, account-scoped AI matching feedback. No prompt or generated line text is
-- kept in the metrics table; only aliases explicitly chosen twice are retained.
alter table public.price_book_items
  add column if not exists aliases text[] not null default '{}'::text[];

alter table public.price_book_items
  add constraint price_book_items_aliases_check
  check (cardinality(aliases) <= 20 and array_to_string(aliases, '') !~ '[[:cntrl:]]');

create table public.tradeflow_ai_match_lines (
  generation_id uuid not null references public.tradeflow_ai_generation_events(id) on delete cascade,
  line_index integer not null check (line_index between 0 and 39),
  user_id uuid not null references auth.users(id) on delete cascade,
  initial_source text not null check (initial_source in ('price_book', 'suggested', 'ai_price', 'contractor_price')),
  initial_item_id uuid references public.price_book_items(id) on delete set null,
  suggestion_count smallint not null default 0 check (suggestion_count between 0 and 3),
  final_source text check (final_source in ('price_book', 'ai_price', 'manual', 'removed')),
  final_item_id uuid references public.price_book_items(id) on delete set null,
  quantity_changed boolean,
  price_changed boolean,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (generation_id, line_index)
);
create index tradeflow_ai_match_lines_created_at_idx on public.tradeflow_ai_match_lines(created_at);
create index tradeflow_ai_match_lines_user_id_idx on public.tradeflow_ai_match_lines(user_id);
alter table public.tradeflow_ai_match_lines enable row level security;
revoke all on public.tradeflow_ai_match_lines from anon, authenticated;
grant all on public.tradeflow_ai_match_lines to service_role;

create table public.tradeflow_price_book_learned_aliases (
  user_id uuid not null references auth.users(id) on delete cascade,
  price_book_item_id uuid not null references public.price_book_items(id) on delete cascade,
  alias text not null check (char_length(alias) between 5 and 160),
  selections integer not null default 1 check (selections between 1 and 1000000),
  last_generation_id uuid references public.tradeflow_ai_generation_events(id) on delete set null,
  created_at timestamptz not null default now(),
  last_selected_at timestamptz not null default now(),
  primary key (user_id, price_book_item_id, alias)
);
create index tradeflow_price_book_learned_aliases_item_idx
  on public.tradeflow_price_book_learned_aliases(price_book_item_id);
alter table public.tradeflow_price_book_learned_aliases enable row level security;
revoke all on public.tradeflow_price_book_learned_aliases from anon, authenticated;
grant select, delete on public.tradeflow_price_book_learned_aliases to authenticated;
grant all on public.tradeflow_price_book_learned_aliases to service_role;
create policy "Contractors view private learned aliases"
  on public.tradeflow_price_book_learned_aliases for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Contractors remove private learned aliases"
  on public.tradeflow_price_book_learned_aliases for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.record_workcraft_price_book_selection(
  p_user_id uuid, p_item_id uuid, p_alias text, p_generation_id uuid
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_alias text := pg_catalog.lower(pg_catalog.btrim(p_alias));
begin
  if p_user_id is null or p_item_id is null or v_alias is null
     or pg_catalog.char_length(v_alias) < 5 or pg_catalog.char_length(v_alias) > 160
     or v_alias ~ '[[:cntrl:]]' then return false; end if;
  if not exists (select 1 from public.price_book_items
                 where id = p_item_id and user_id = p_user_id) then return false; end if;
  if not exists (select 1 from public.tradeflow_ai_generation_events
                 where id = p_generation_id and user_id = p_user_id and outcome = 'succeeded') then return false; end if;
  insert into public.tradeflow_price_book_learned_aliases
    (user_id, price_book_item_id, alias, selections, last_generation_id)
  values (p_user_id, p_item_id, v_alias, 1, p_generation_id)
  on conflict (user_id, price_book_item_id, alias) do update
    set selections = pg_catalog.least(1000000, tradeflow_price_book_learned_aliases.selections + 1),
        last_selected_at = pg_catalog.now(),
        last_generation_id = p_generation_id
    where tradeflow_price_book_learned_aliases.last_generation_id is distinct from p_generation_id;
  return true;
end;
$$;
revoke all on function public.record_workcraft_price_book_selection(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_workcraft_price_book_selection(uuid, uuid, text, uuid) to service_role;

create function public.get_workcraft_ai_match_metrics()
returns jsonb language sql security invoker set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'window_days', 30,
    'generated_lines', count(*),
    'auto_matched', count(*) filter (where initial_source = 'price_book'),
    'needs_choice', count(*) filter (where initial_source = 'suggested'),
    'ai_priced', count(*) filter (where initial_source = 'ai_price'),
    'contractor_priced', count(*) filter (where initial_source = 'contractor_price'),
    'saved_lines', count(*) filter (where finalized_at is not null),
    'auto_match_kept', count(*) filter (where initial_source = 'price_book' and final_source = 'price_book' and final_item_id = initial_item_id and price_changed = false),
    'auto_match_changed', count(*) filter (where initial_source = 'price_book' and finalized_at is not null and (final_source <> 'price_book' or final_item_id is distinct from initial_item_id or price_changed = true)),
    'suggestions_chosen', count(*) filter (where initial_source = 'suggested' and final_source = 'price_book'),
    'suggestions_ai_used', count(*) filter (where initial_source = 'suggested' and final_source = 'ai_price'),
    'lines_removed', count(*) filter (where final_source = 'removed'),
    'quantities_changed', count(*) filter (where quantity_changed = true),
    'rates_changed', count(*) filter (where price_changed = true and final_source <> 'price_book'),
    'active_learned_aliases', (select count(*) from public.tradeflow_price_book_learned_aliases where selections >= 2),
    'pending_learned_aliases', (select count(*) from public.tradeflow_price_book_learned_aliases where selections = 1)
  )
  from public.tradeflow_ai_match_lines
  where created_at >= pg_catalog.now() - interval '30 days';
$$;
revoke all on function public.get_workcraft_ai_match_metrics() from public, anon, authenticated;
grant execute on function public.get_workcraft_ai_match_metrics() to service_role;

comment on table public.tradeflow_ai_match_lines is 'Private, 90-day AI match provenance and contractor correction metrics; cascades with AI generation events.';
comment on table public.tradeflow_price_book_learned_aliases is 'Private per-contractor aliases activated after two saved selections of the same Price Book item.';
