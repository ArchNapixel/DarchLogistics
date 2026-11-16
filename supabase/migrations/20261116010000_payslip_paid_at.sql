-- 2026-11-16: when a payslip was actually paid (Financial Summary's
-- Money in / Money out counts salaries in the month they were paid).
-- Stamped by the database when payslip_status becomes 'Paid' (server time,
-- markPayslipPaid in payslip.ts needs no change); cleared if it ever moves
-- off 'Paid'. Payslips marked Paid before this stay null -- the app falls
-- back to their payroll_period_end.

alter table public.payroll_payslips add column paid_at timestamptz;

create or replace function public.payroll_payslips_stamp_paid_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payslip_status = 'Paid' and old.payslip_status is distinct from 'Paid' then
    new.paid_at := now();
  elsif new.payslip_status is distinct from 'Paid' then
    new.paid_at := null;
  end if;
  return new;
end;
$$;

create trigger payroll_payslips_paid_at
  before update of payslip_status on public.payroll_payslips
  for each row execute function public.payroll_payslips_stamp_paid_at();

insert into supabase_migrations.schema_migrations (version, name)
values ('20261116010000', 'payslip_paid_at') on conflict (version) do nothing;
