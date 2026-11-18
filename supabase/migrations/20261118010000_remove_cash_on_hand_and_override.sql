-- 2026-11-18 (later): remove features the user dropped, with what they used.
-- Run once in the Supabase SQL Editor, AFTER 20261118000000_finance_fixes.sql.
-- Safe to re-run.

-- 1. Cash on hand (Financial Summary card) is gone -> its table too.
--    This deletes the saved monthly cash counts.
drop table if exists public.cash_on_hand_checks;

-- 2. The "amount to pay" override is gone. Two functions still read it.

-- The driver's "is this trip paid?" banner: owed = whole contract + extra
-- charges (approved client damage + added charges -- the added charges were
-- missing before, same rule as lib/bookingBalance.ts).
create or replace function public.get_trip_payment_status(p_itinerary_id integer)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_booking integer; v_rate numeric; v_paid numeric;
  v_terms text; v_waived timestamptz; v_contract numeric; v_extras numeric;
  v_dp numeric;
begin
  -- Only the trip's active crew may ask.
  if not exists (
    select 1 from itinerary_crews c join users u on u.employee_id = c.employee_id
    where c.itinerary_id = p_itinerary_id and c.is_active and u.auth_user_id = auth.uid()
  ) then
    return null;
  end if;

  select b.booking_id, b.rate_of_delivery_service, coalesce(b.amount_paid, 0), b.payment_terms, b.downpayment_waived_at
    into v_booking, v_rate, v_paid, v_terms, v_waived
  from itineraries i join bookings b on b.booking_id = i.booking_id
  where i.itinerary_id = p_itinerary_id;

  -- Whole contract = each live trip's own rate.
  select coalesce(sum(coalesce(trip_rate, v_rate, 0)), 0) into v_contract
    from itineraries
   where booking_id = v_booking and itinerary_status <> 'Cancelled';
  select coalesce(sum(d.estimated_damage_cost), 0) into v_extras
    from delivery_damage_records d join itineraries i on i.itinerary_id = d.itinerary_id
   where i.booking_id = v_booking and d.damage_status = 'Approved' and d.charge_to = 'Client';
  v_extras := v_extras + coalesce(
    (select sum(amount) from booking_charges where booking_id = v_booking and voided_at is null), 0);

  if v_paid >= v_contract + v_extras then return 'paid'; end if;

  -- Credit terms: fine to unload once the downpayment is settled (or waived / not required).
  v_dp := booking_downpayment(v_booking);
  if coalesce(v_terms, 'Cash') <> 'Cash'
     and (v_dp is null or v_paid >= v_dp or v_waived is not null) then
    return 'terms';
  end if;

  return 'unpaid';
end $function$;

-- Recording a payment: the "lock the amount to pay" option is removed.
drop function if exists public.record_booking_payment(integer, numeric, text, date, text, text, text, numeric);
create or replace function public.record_booking_payment(
  p_booking_id integer, p_amount numeric, p_method text, p_paid_on date default null,
  p_reference_no text default null, p_or_number text default null, p_note text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_emp integer; v_id integer;
begin
  if not exists (select 1 from public.users where auth_user_id = auth.uid() and user_role = 'Admin') then
    raise exception 'Admins only';
  end if;
  if p_amount is null or p_amount = 0 then raise exception 'Amount must not be zero'; end if;
  perform 1 from public.bookings where booking_id = p_booking_id for update;
  if not found then raise exception 'Booking % not found', p_booking_id; end if;

  select employee_id into v_emp from public.users where auth_user_id = auth.uid();

  insert into public.booking_payments
    (booking_id, amount, method, paid_on, reference_no, or_number, note, recorded_by)
  values
    (p_booking_id, p_amount, p_method,
     coalesce(p_paid_on, (now() at time zone 'Asia/Manila')::date),
     nullif(trim(p_reference_no), ''), nullif(trim(p_or_number), ''), nullif(trim(p_note), ''), v_emp)
  returning payment_id into v_id;
  return v_id;
end $function$;
revoke all on function public.record_booking_payment(integer, numeric, text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.record_booking_payment(integer, numeric, text, date, text, text, text) to authenticated;

-- Nothing reads or writes it any more.
alter table public.bookings drop column if exists amount_to_pay;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261118010000', 'remove_cash_on_hand_and_override') on conflict (version) do nothing;
