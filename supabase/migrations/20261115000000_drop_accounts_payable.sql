-- Drop Accounts Payable (creditors / bills / bill_payments).
-- Its page (Bills Payable) was deleted in commit 1581936; nothing in the app
-- writes these tables any more. Money Summary's bills read was removed too.

drop function if exists public.create_bill(text, text, numeric, integer, date, date, text, text, boolean, text);
drop function if exists public.record_bill_payment(integer, numeric, text, date, text, text);
drop function if exists public.void_bill_payment(integer, text);
drop function if exists public.void_bill(integer, text);

-- bill_payments -> bills -> creditors (FK order). Drops the
-- bill_payments_sync trigger and the tables' policies with them.
drop table if exists public.bill_payments;
drop table if exists public.bills;
drop table if exists public.creditors;

drop function if exists public.sync_bill_amount_paid();

insert into supabase_migrations.schema_migrations (version, name)
values ('20261115000000', 'drop_accounts_payable') on conflict (version) do nothing;
