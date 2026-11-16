-- 2026-11-16: Financial Summary -- cash on hand and government remittances.
--
-- cash_on_hand_checks: the company's cash + bank balance COUNTED at the start
-- of a month (one per month). Financial Summary carries the latest count
-- forward: opening cash of a month = the last count on or before it + each
-- month's net money movement since. Enter a new count any time to re-anchor.
--
-- government_remittances: money actually paid to SSS / PhilHealth / Pag-IBIG /
-- BIR, and which payroll month it was for. Financial Summary compares it with
-- what that month's finalized payslips say is due. A wrong entry is voided
-- (stays on record, stops counting).
--
-- Both are Admin only (Financial Summary is an Admin page); plain writes, no
-- delete -- same pattern as creditors.

create table public.cash_on_hand_checks (
  check_id integer generated always as identity primary key,
  as_of_month date not null unique check (extract(day from as_of_month) = 1),
  amount numeric(14,2) not null check (amount between -100000000 and 100000000),
  note text,
  recorded_by integer references public.employees(employee_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cash_on_hand_checks enable row level security;

create policy cash_on_hand_checks_select_admin on public.cash_on_hand_checks
  for select to authenticated using (is_admin());
create policy cash_on_hand_checks_insert_admin on public.cash_on_hand_checks
  for insert to authenticated with check (is_admin());
create policy cash_on_hand_checks_update_admin on public.cash_on_hand_checks
  for update to authenticated using (is_admin()) with check (is_admin());

create table public.government_remittances (
  remittance_id integer generated always as identity primary key,
  period_month date not null check (extract(day from period_month) = 1),
  agency text not null check (agency in ('SSS', 'PhilHealth', 'Pag-IBIG', 'BIR')),
  amount numeric(12,2) not null check (amount > 0 and amount <= 100000000),
  paid_on date not null,
  reference_no text,
  note text,
  recorded_by integer references public.employees(employee_id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by integer references public.employees(employee_id),
  void_reason text
);

create index government_remittances_period_idx on public.government_remittances (period_month);

alter table public.government_remittances enable row level security;

create policy government_remittances_select_admin on public.government_remittances
  for select to authenticated using (is_admin());
create policy government_remittances_insert_admin on public.government_remittances
  for insert to authenticated with check (is_admin());
create policy government_remittances_update_admin on public.government_remittances
  for update to authenticated using (is_admin()) with check (is_admin());

insert into supabase_migrations.schema_migrations (version, name)
values ('20261116020000', 'cash_on_hand_and_remittances') on conflict (version) do nothing;
