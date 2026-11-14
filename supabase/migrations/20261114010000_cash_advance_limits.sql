-- 2026-11-14: cash advance limits (validation plan, Phase 3).
-- Runs whenever an advance becomes Approved: Admin's direct issue
-- (IssueCashAdvanceModal inserts with the 'Approved' default) and Admin
-- approving an employee's request (decideCashAdvanceRequest). Pending
-- requests and rejections are never checked. Limits come from app_settings:
--   cash_advance_max        -- most one advance can be
--   cash_advance_max_weeks  -- still owed + new advance <= N weeks of pay
-- Weekly pay: Drivers (Commission Per Trip) = average gross of their last 4
-- FINALIZED payslips; everyone else = their rate as a week (daily x 6,
-- monthly / 30 x 6, hourly x 8 x 6). No pay known yet = only the max applies.
-- "Still owed" = Approved advances - every payslip's cash_advance_deducted,
-- the same pooled balance as getOutstandingCashAdvance() in payslip.ts.

create or replace function public.cash_advances_check_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max numeric;
  v_weeks numeric;
  v_weekly numeric;
  v_owed numeric;
  v_room numeric;
  v_emp employees%rowtype;
begin
  if new.status <> 'Approved' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'Approved' and old.amount = new.amount then
    return new;
  end if;

  -- Two advances for the same person at the same moment can't both slip in.
  perform pg_advisory_xact_lock(hashtext('cash_advance:' || new.employee_id));

  select setting_value into v_max from app_settings where setting_key = 'cash_advance_max';
  if v_max is not null and new.amount > v_max then
    raise exception 'A cash advance can be at most ₱% (see Settings).', to_char(v_max, 'FM999,999,999,990.00');
  end if;

  select setting_value into v_weeks from app_settings where setting_key = 'cash_advance_max_weeks';
  if v_weeks is null then
    return new;
  end if;

  select * into v_emp from employees where employee_id = new.employee_id;
  if v_emp.rate_type = 'Commission Per Trip' then
    select avg(gross_pay) into v_weekly
    from (
      select gross_pay from payroll_payslips
      where employee_id = new.employee_id and finalized_at is not null
      order by payroll_period_end desc
      limit 4
    ) last_four;
  else
    v_weekly := coalesce(v_emp.weekly_salary, v_emp.daily_rate * 6, v_emp.monthly_salary / 30 * 6, v_emp.hourly_rate * 48);
  end if;
  if v_weekly is null or v_weekly <= 0 then
    return new;
  end if;

  v_owed := greatest(0,
    coalesce((select sum(amount) from cash_advances
              where employee_id = new.employee_id and status = 'Approved'
                and cash_advance_id <> new.cash_advance_id), 0)
    - coalesce((select sum(cash_advance_deducted) from payroll_payslips
                where employee_id = new.employee_id), 0));
  v_room := round(v_weeks * v_weekly - v_owed, 2);

  if new.amount > v_room then
    raise exception '% still owes ₱%. With this advance the total would pass % weeks of pay (₱%). Most you can give now: ₱%.',
      v_emp.full_name,
      to_char(v_owed, 'FM999,999,999,999,990.00'),
      v_weeks,
      to_char(round(v_weeks * v_weekly, 2), 'FM999,999,999,990.00'),
      to_char(greatest(v_room, 0), 'FM999,999,999,990.00');
  end if;
  return new;
end;
$$;

create trigger cash_advances_limits
  before insert or update of status, amount on public.cash_advances
  for each row execute function public.cash_advances_check_limits();
