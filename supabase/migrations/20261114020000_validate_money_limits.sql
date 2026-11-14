-- 2026-11-14: test data wiped (data only, run by hand, not repeated here:
-- every record table truncated with restart identity incl. route_cache, all
-- logins / employees / clients / trucks deleted except the admin, whose email
-- became aanpcoles@addu.edu.ph). With the bad rows gone, the Phase 2 checks
-- are validated and cash_advances.amount gets 2 decimals. The trigger watches
-- "amount", so it's dropped and re-created around the type change.

alter table public.employees validate constraint employees_weekly_salary_range;
alter table public.cash_advances validate constraint cash_advances_amount_range;

drop trigger cash_advances_limits on public.cash_advances;
alter table public.cash_advances alter column amount type numeric(12,2);
create trigger cash_advances_limits
  before insert or update of status, amount on public.cash_advances
  for each row execute function public.cash_advances_check_limits();
