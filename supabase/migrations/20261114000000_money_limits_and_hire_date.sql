-- 2026-11-14: money limits + hire date range (validation plan, Phase 2).
-- Run by hand in the SQL Editor the same day. Data fix run first (not
-- schema, so not repeated here): employee #25's 10^54 weekly salary set
-- to 5000 and its draft payslip #250 discarded -- it didn't fit numeric(12,2).

begin;

-- Business limits, editable on the Settings page (no "_rate" key endings:
-- the Settings page caps those at 100).
insert into public.app_settings (setting_key, label, setting_value, unit) values
  ('weekly_salary_warn',        'Weekly salary: ask "unusual?" above',                  20000,  'PHP'),
  ('weekly_salary_max',         'Weekly salary: maximum',                               100000, 'PHP'),
  ('cash_advance_max',          'Cash advance: maximum per advance',                    50000,  'PHP'),
  ('cash_advance_confirm_above','Cash advance: ask to confirm again above',             10000,  'PHP'),
  ('cash_advance_max_weeks',    'Cash advance: total owed may not pass N weeks of pay', 2,      'weeks'),
  ('duplicate_advance_minutes', 'Cash advance: warn on same amount within',             10,     'minutes'),
  ('min_net_pay',               'Payroll: lowest net pay allowed',                      0,      'PHP')
on conflict (setting_key) do nothing;

-- Hard ceilings (the Settings limits sit below these). NOT VALID: test
-- advances #13-16 (74M / 999B) are kept for now; VALIDATE after cleanup.
alter table public.employees
  add constraint employees_weekly_salary_range
  check (weekly_salary is null or (weekly_salary > 0 and weekly_salary <= 1000000)) not valid;

alter table public.cash_advances
  add constraint cash_advances_amount_range
  check (amount > 0 and amount <= 1000000) not valid;

-- Hire date between 1990-01-01 and 30 days from today (Manila). A trigger
-- because a CHECK can't use today's date.
create or replace function public.employees_check_hire_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.hire_date < date '1990-01-01'
     or new.hire_date > (now() at time zone 'Asia/Manila')::date + 30 then
    raise exception 'Hire date must be between 1990-01-01 and 30 days from today.';
  end if;
  return new;
end;
$$;

create trigger employees_hire_date_range
  before insert or update of hire_date on public.employees
  for each row execute function public.employees_check_hire_date();

-- Money to 2 decimals. cash_advances.amount waits for the cleanup (the
-- 999,999,999,999 test advances don't fit).
alter table public.employees
  alter column weekly_salary type numeric(12,2);

alter table public.payroll_payslips
  alter column gross_pay             type numeric(12,2),
  alter column base_pay              type numeric(12,2),
  alter column allowance_amount      type numeric(12,2),
  alter column cash_advance_deducted type numeric(12,2),
  alter column net_pay               type numeric(12,2),
  alter column sss_msc               type numeric(12,2),
  alter column sss_ee                type numeric(12,2),
  alter column sss_er                type numeric(12,2),
  alter column sss_ec                type numeric(12,2),
  alter column philhealth_ee         type numeric(12,2),
  alter column philhealth_er         type numeric(12,2),
  alter column pagibig_ee            type numeric(12,2),
  alter column pagibig_er            type numeric(12,2),
  alter column withholding_tax       type numeric(12,2);

alter table public.payslip_line_items
  alter column amount type numeric(12,2);

commit;
