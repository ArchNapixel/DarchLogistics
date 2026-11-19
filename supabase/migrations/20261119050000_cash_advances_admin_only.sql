-- Cash advances: only Admin issues, approves or rejects. Every employee
-- (Dispatcher included, since 2026-11-19) can only REQUEST one -- that's
-- cash_advances_insert_own_employee (own row, status 'Pending'), unchanged.
-- Before this, the staff policies used is_staff(), which includes
-- Dispatchers, so a Dispatcher could approve their own request or insert an
-- already-Approved advance straight through the API.

drop policy if exists cash_advances_insert_staff on public.cash_advances;
drop policy if exists cash_advances_insert_admin on public.cash_advances;
create policy cash_advances_insert_admin on public.cash_advances
  for insert to authenticated with check (public.is_admin());

drop policy if exists cash_advances_update_staff on public.cash_advances;
drop policy if exists cash_advances_update_admin on public.cash_advances;
create policy cash_advances_update_admin on public.cash_advances
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

insert into supabase_migrations.schema_migrations (version, name)
values ('20261119050000', 'cash_advances_admin_only') on conflict (version) do nothing;
