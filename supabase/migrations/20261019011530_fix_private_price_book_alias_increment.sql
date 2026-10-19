-- LEAST is a PostgreSQL special expression, not pg_catalog.least().
-- Keep this function invoker-scoped and callable only by service_role.
create or replace function public.record_workcraft_price_book_selection(
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
    set selections = least(1000000, tradeflow_price_book_learned_aliases.selections + 1),
        last_selected_at = pg_catalog.now(),
        last_generation_id = p_generation_id
    where tradeflow_price_book_learned_aliases.last_generation_id is distinct from p_generation_id;
  return true;
end;
$$;
