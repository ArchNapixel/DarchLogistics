-- Company policy numbers moved out of the code into Settings (app_settings):
--   downpayment_percent        25  % of (contract - cost) asked up front
--   annual_paid_leave_days      5  paid leave days per employee per year
--   quote_low_margin_percent   50  Review Quote warns when costs reach this % of the rate
--   weekly_working_days         6  weekly salary / N = one paid attendance day
-- They show up on the Settings page by themselves.

insert into public.app_settings (setting_key, label, setting_value, unit) values
  ('downpayment_percent', 'Downpayment: % of the profit part asked up front (new bookings)', 25, '%'),
  ('annual_paid_leave_days', 'Paid leave days per year', 5, 'days'),
  ('quote_low_margin_percent', 'Review Quote: warn when costs reach this % of the rate', 50, '%'),
  ('weekly_working_days', 'Working days in a week (weekly salary / this = one day)', 6, 'days')
on conflict (setting_key) do nothing;

-- ---------------------------------------------------------------------------
-- The downpayment % is SAVED ON EACH BOOKING when it's created, like
-- cost_per_trip -- so changing the setting only affects new bookings. (A
-- live % would change every open booking's downpayment at once, and a
-- booking that had met 25% could suddenly be "short" with its trips blocked.)
alter table public.bookings add column if not exists downpayment_percent numeric(6,3);
update public.bookings set downpayment_percent = 25 where downpayment_percent is null;

-- Filled from Settings on insert, so create_booking_from_quote didn't need to change.
create or replace function public.bookings_downpayment_percent_default()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.downpayment_percent is null then
    new.downpayment_percent := coalesce(
      (select setting_value from public.app_settings where setting_key = 'downpayment_percent'),
      25);
  end if;
  return new;
end;
$function$;

drop trigger if exists bookings_downpayment_percent_default on public.bookings;
create trigger bookings_downpayment_percent_default
  before insert on public.bookings
  for each row execute function public.bookings_downpayment_percent_default();

-- Same as 20261118000000's version, with the booking's own % instead of 0.25.
-- Keep in step with downpaymentForContract() in src/lib/downpayment.ts.
create or replace function public.booking_downpayment(p_booking_id integer)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
           when b.downpayment_fixed is not null then b.downpayment_fixed
           when b.cost_per_trip is null or b.rate_of_delivery_service is null then null
           else round(
             t.n * b.cost_per_trip
             + coalesce(b.downpayment_percent, 25) / 100.0
               * greatest(t.contract - t.n * b.cost_per_trip, 0),
             2)
         end
  from bookings b
  cross join lateral (
    select count(*) as n,
           coalesce(sum(coalesce(i.trip_rate, b.rate_of_delivery_service)), 0) as contract
    from itineraries i
    where i.booking_id = b.booking_id and i.itinerary_status <> 'Cancelled'
  ) t
  where b.booking_id = p_booking_id
$function$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261119030000', 'policy_settings') on conflict (version) do nothing;
