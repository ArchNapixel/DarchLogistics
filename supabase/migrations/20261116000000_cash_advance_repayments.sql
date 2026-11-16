-- 2026-11-16: cash advance repayments (Finance -> Cash Advance Ledger).
-- Money an employee pays back OUTSIDE payroll (cash, GCash, bank...).
-- Payslip deductions stay in payroll_payslips.cash_advance_deducted -- they
-- are NOT copied here. Balance still owed, everywhere:
--   Approved cash_advances - every payslip's cash_advance_deducted
--   - non-voided cash_advance_repayments
-- (payslip.ts getOutstandingCashAdvance / loadOutstandingCashAdvances and
-- the cash_advances_limits trigger below -- change them together).
-- Writes only through record_cash_advance_repayment / void_cash_advance_repayment.

create table public.cash_advance_repayments (
  repayment_id integer generated always as identity primary key,
  employee_id integer not null references public.employees(employee_id),
  amount numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  paid_on date not null,
  method text not null check (method in ('Cash', 'GCash', 'Bank Transfer', 'Check', 'Other')),
  reference_no text,
  note text,
  recorded_by integer references public.employees(employee_id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by integer references public.employees(employee_id),
  void_reason text,
  constraint cash_advance_repayments_reference_required
    check (method not in ('GCash', 'Bank Transfer', 'Check') or nullif(trim(reference_no), '') is not null)
);

create index cash_advance_repayments_employee_idx on public.cash_advance_repayments (employee_id);

alter table public.cash_advance_repayments enable row level security;

-- Admin sees all; an employee sees their own (their balance on My Payslips).
-- No INSERT / UPDATE / DELETE policies: the functions below do the writes.
create policy cash_advance_repayments_select_admin on public.cash_advance_repayments
  for select to authenticated using (is_admin());

create policy cash_advance_repayments_select_own_employee on public.cash_advance_repayments
  for select to authenticated
  using (employee_id = (select users.employee_id from users where users.auth_user_id = auth.uid()));

-- Record a repayment. Refuses more than is still owed (drafts' deductions
-- count as taken, same as payroll does). Returns the new repayment_id.
create or replace function public.record_cash_advance_repayment(
  p_employee_id integer,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_reference_no text default null,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin integer := current_admin_employee_id();  -- raises "Admins only"
  v_owed numeric;
  v_id integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount above ₱0.';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'The date paid can''t be in the future.';
  end if;

  -- Same lock as cash_advances_limits: no advance / repayment races.
  perform pg_advisory_xact_lock(hashtext('cash_advance:' || p_employee_id));

  v_owed := coalesce((select sum(amount) from cash_advances
                      where employee_id = p_employee_id and status = 'Approved'), 0)
          - coalesce((select sum(cash_advance_deducted) from payroll_payslips
                      where employee_id = p_employee_id), 0)
          - coalesce((select sum(amount) from cash_advance_repayments
                      where employee_id = p_employee_id and voided_at is null), 0);

  if round(p_amount, 2) > round(v_owed, 2) then
    raise exception 'Only ₱% is still owed (deductions on draft payslips count as taken).',
      to_char(greatest(v_owed, 0), 'FM999,999,999,990.00');
  end if;

  insert into cash_advance_repayments (employee_id, amount, paid_on, method, reference_no, note, recorded_by)
  values (p_employee_id, round(p_amount, 2), p_paid_on, p_method,
          nullif(trim(p_reference_no), ''), nullif(trim(p_note), ''), v_admin)
  returning repayment_id into v_id;
  return v_id;
end;
$$;

-- Void a repayment (the row stays, it just stops counting).
create or replace function public.void_cash_advance_repayment(p_repayment_id integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin integer := current_admin_employee_id();
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Give a reason for voiding.';
  end if;
  update cash_advance_repayments
     set voided_at = now(), voided_by = v_admin, void_reason = trim(p_reason)
   where repayment_id = p_repayment_id and voided_at is null;
  if not found then
    raise exception 'That repayment was not found or is already voided.';
  end if;
end;
$$;

revoke all on function public.record_cash_advance_repayment(integer, numeric, date, text, text, text) from public, anon;
grant execute on function public.record_cash_advance_repayment(integer, numeric, date, text, text, text) to authenticated;
revoke all on function public.void_cash_advance_repayment(integer, text) from public, anon;
grant execute on function public.void_cash_advance_repayment(integer, text) to authenticated;

-- cash_advances_limits: "still owed" now also subtracts repayments.
-- Same as 20261114010000 otherwise (the trigger itself is unchanged).
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
                where employee_id = new.employee_id), 0)
    - coalesce((select sum(amount) from cash_advance_repayments
                where employee_id = new.employee_id and voided_at is null), 0));
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

insert into supabase_migrations.schema_migrations (version, name)
values ('20261116000000', 'cash_advance_repayments') on conflict (version) do nothing;
