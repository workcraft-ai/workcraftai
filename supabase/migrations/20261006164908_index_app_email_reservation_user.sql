-- Keep auth-user deletion checks efficient for the private email reservation
-- table's nullable user foreign key.
create index if not exists tradeflow_app_email_reservations_user_id_idx
  on public.tradeflow_app_email_reservations(user_id);
