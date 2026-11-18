-- 2026-11-18: finance fixes + editable bookings (CLAUDE.md "2026-11-18").
-- Run once in the Supabase SQL Editor. Safe to re-run, and safe whether or
-- not an earlier draft of this file was run.

-- ---------------------------------------------------------------------------
-- 1. Added charges stay positive (the Discount line was dropped -- prices are
--    edited on the booking instead). Undoes the earlier draft's "amount <> 0".
alter table public.booking_charges drop constraint if exists booking_charges_amount_check;
alter table public.booking_charges add constraint booking_charges_amount_check check (amount > 0);

-- 2. Insurance money never passes through us, so no claim-paid date is kept.
--    (Removes what the earlier draft added, if it was run.)
drop trigger if exists delivery_damage_records_claim_paid_at on public.delivery_damage_records;
drop function if exists public.delivery_damage_stamp_claim_paid_at();
alter table public.delivery_damage_records drop column if exists claim_paid_at;

-- 3. A cash advance's date is the Manila date (CURRENT_DATE is UTC).
alter table public.cash_advances
  alter column issued_at set default ((now() at time zone 'Asia/Manila'))::date;

-- 4. Diesel estimate: km a truck drives on 1 litre (1 = the old estimate).
insert into public.app_settings (setting_key, label, setting_value, unit) values
  ('diesel_km_per_liter', 'Diesel: km per litre (truck fuel economy)', 1, 'km/L')
on conflict (setting_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Downpayment stays as it was once paid. When a booking is repriced AFTER
--    its downpayment was met, update_booking_details() saves the amount here
--    and booking_downpayment() (used by the require_downpayment trigger and
--    get_trip_payment_status) returns it instead of re-working it out.
alter table public.bookings add column if not exists downpayment_fixed numeric(12,2);

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
             + 0.25 * greatest(t.contract - t.n * b.cost_per_trip, 0),
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

-- ---------------------------------------------------------------------------
-- 6. Who changed a booking, and when (Booking Detail -> Change history).
create table if not exists public.booking_change_logs (
  log_id integer generated always as identity primary key,
  booking_id integer not null references public.bookings (booking_id),
  changed_by integer references public.employees (employee_id),
  changed_at timestamptz not null default now(),
  changes text[] not null
);
create index if not exists booking_change_logs_booking_idx on public.booking_change_logs (booking_id);
alter table public.booking_change_logs enable row level security;
drop policy if exists booking_change_logs_select_staff on public.booking_change_logs;
create policy booking_change_logs_select_staff on public.booking_change_logs
  for select to authenticated using (is_staff());

-- 7. Website notifications for clients (the bell in their portal).
create table if not exists public.client_notifications (
  notification_id integer generated always as identity primary key,
  client_id integer not null references public.clients (client_id),
  booking_id integer references public.bookings (booking_id),
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists client_notifications_client_idx on public.client_notifications (client_id, created_at desc);
alter table public.client_notifications enable row level security;
drop policy if exists client_notifications_select_own on public.client_notifications;
create policy client_notifications_select_own on public.client_notifications
  for select to authenticated using (
    exists (select 1 from public.users u
             where u.client_id = client_notifications.client_id and u.auth_user_id = auth.uid()));
drop policy if exists client_notifications_update_own on public.client_notifications;
create policy client_notifications_update_own on public.client_notifications
  for update to authenticated
  using (exists (select 1 from public.users u
                  where u.client_id = client_notifications.client_id and u.auth_user_id = auth.uid()))
  with check (exists (select 1 from public.users u
                       where u.client_id = client_notifications.client_id and u.auth_user_id = auth.uid()));

-- 8. A delivered trip repriced after its driver's commission is on a payslip.
--    Payroll (lib/payslip.ts applyPayrollAdjustments, on every Payroll open)
--    applies each one: on a DRAFT payslip the trip line is corrected in
--    place; on a FINALIZED one the difference (+ or -) goes onto the
--    driver's draft for the current week. status:
--    pending -> in_place | added | noop.
create table if not exists public.payroll_adjustments (
  adjustment_id integer generated always as identity primary key,
  employee_id integer not null references public.employees (employee_id),
  itinerary_id integer not null references public.itineraries (itinerary_id),
  old_rate numeric(12,2) not null,
  new_rate numeric(12,2) not null,
  created_by integer references public.employees (employee_id),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'in_place', 'added', 'noop')),
  applied_payroll_id integer references public.payroll_payslips (payroll_id) on delete set null,
  applied_at timestamptz
);
create index if not exists payroll_adjustments_open_idx on public.payroll_adjustments (status);
alter table public.payroll_adjustments enable row level security;
drop policy if exists payroll_adjustments_select_admin on public.payroll_adjustments;
create policy payroll_adjustments_select_admin on public.payroll_adjustments
  for select to authenticated using (is_admin());
drop policy if exists payroll_adjustments_update_admin on public.payroll_adjustments;
create policy payroll_adjustments_update_admin on public.payroll_adjustments
  for update to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- 9. Find (or add) the places row for a city + barangay -- same rule as
--    create_booking_from_quote. Internal helper.
create or replace function public._find_or_create_place(p_city text, p_barangay text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_id integer;
begin
  select place_id into v_id from places
   where lower(trim(city)) = lower(trim(p_city)) and lower(trim(barangay)) = lower(trim(p_barangay))
   limit 1;
  if v_id is null then
    insert into places (place_name, city, barangay)
    values ('Brgy. ' || trim(p_barangay) || ', ' || trim(p_city), trim(p_city), trim(p_barangay))
    returning place_id into v_id;
  end if;
  return v_id;
end $function$;
revoke all on function public._find_or_create_place(text, text) from public, anon, authenticated;

-- 10. Booking Detail -> Edit -> Save: every change in ONE transaction.
--     p_changes keys (all optional):
--       pickup / delivery / return_place: {city, barangay, detail, landmark, lat, lng}
--       estimated_distance_km, return_distance_km, hours_per_trip (numbers)
--       pickup_date, deadline_date (YYYY-MM-DD), storage_deadline (date or null)
--       payment_terms ('Cash' | '7Days' | '14Days' | '30Days')
--       trip_rates: [{itinerary_id, rate}]
--     p_summary = the change lines for the log; p_client_message = what the
--     client's bell says (null = no notification).
--     Rules (same as lib/bookingEdit.ts -- change both together):
--       - Admin / Dispatcher only; never a Cancelled booking, never one that
--         is completed and fully paid
--       - prices: > 0, 2 decimals; locked once the whole contract (+ extra
--         charges) is paid; a delivered trip's price is locked once
--         everything delivered so far is paid
--       - a downpayment already met is kept as it was (downpayment_fixed)
--       - a repriced trip already on a payslip -> payroll_adjustments row
create or replace function public.update_booking_details(
  p_booking_id integer,
  p_changes jsonb,
  p_summary text[],
  p_client_message text
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  b           bookings;
  v_emp       integer;
  v_contract  numeric;
  v_delivered numeric;
  v_all_done  boolean;
  v_extras    numeric;
  v_paid      numeric;
  v_dp        numeric;
  v_item      jsonb;
  v_trip      itineraries;
  v_old_rate  numeric;
  v_rate      numeric;
  v_repriced  boolean := false;
  v_place     jsonb;
  v_num       numeric;
  v_pickup    date;
  v_deadline  date;
  v_delivered_statuses text[] := array['Delivered', 'Unloading', 'ReturningContainer', 'ContainerReturned'];
  v_completed_statuses text[] := array['Delivered', 'ContainerReturned'];
begin
  if not is_staff() then raise exception 'Only Admin or Dispatcher can edit a booking.'; end if;
  select employee_id into v_emp from users where auth_user_id = auth.uid();

  select * into b from bookings where booking_id = p_booking_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if b.booking_status = 'Cancelled' then raise exception 'This booking is cancelled -- it can''t be edited.'; end if;

  -- The money right now (same rule as lib/bookingBalance.ts).
  select coalesce(sum(coalesce(trip_rate, b.rate_of_delivery_service, 0)), 0),
         coalesce(sum(coalesce(trip_rate, b.rate_of_delivery_service, 0))
                    filter (where itinerary_status = any (v_delivered_statuses)), 0),
         coalesce(bool_and(itinerary_status = any (v_completed_statuses)), false)
    into v_contract, v_delivered, v_all_done
    from itineraries
   where booking_id = p_booking_id and itinerary_status is distinct from 'Cancelled';
  select coalesce(sum(d.estimated_damage_cost), 0) into v_extras
    from delivery_damage_records d join itineraries i on i.itinerary_id = d.itinerary_id
   where i.booking_id = p_booking_id and d.damage_status = 'Approved' and d.charge_to = 'Client';
  v_extras := v_extras + coalesce(
    (select sum(amount) from booking_charges where booking_id = p_booking_id and voided_at is null), 0);
  v_paid := coalesce(b.amount_paid, 0);

  if v_all_done and v_paid >= v_delivered + v_extras then
    raise exception 'This booking is delivered and fully paid -- it can''t be edited any more.';
  end if;

  -- ---- Trip prices ----
  if jsonb_typeof(p_changes -> 'trip_rates') = 'array' and jsonb_array_length(p_changes -> 'trip_rates') > 0 then
    if v_paid >= v_contract + v_extras then
      raise exception 'This booking is fully paid -- its prices are locked.';
    end if;
    -- Downpayment already paid: keep it as it was before the new prices.
    if b.downpayment_fixed is null and b.downpayment_waived_at is null then
      v_dp := booking_downpayment(p_booking_id);
      if v_dp is not null and v_paid >= v_dp then
        update bookings set downpayment_fixed = v_dp where booking_id = p_booking_id;
      end if;
    end if;

    for v_item in select * from jsonb_array_elements(p_changes -> 'trip_rates') loop
      v_rate := (v_item ->> 'rate')::numeric;
      if v_rate is null or v_rate <= 0 or v_rate > 10000000 or v_rate <> round(v_rate, 2) then
        raise exception 'Each trip price must be more than 0, with at most 2 decimals.';
      end if;
      select * into v_trip from itineraries
       where itinerary_id = (v_item ->> 'itinerary_id')::integer and booking_id = p_booking_id
       for update;
      if not found then raise exception 'Trip % is not on this booking.', v_item ->> 'itinerary_id'; end if;
      if v_trip.itinerary_status = 'Cancelled' then
        raise exception 'Trip #% is cancelled -- its price can''t change.', v_trip.itinerary_id;
      end if;
      v_old_rate := coalesce(v_trip.trip_rate, b.rate_of_delivery_service, 0);
      if v_old_rate = v_rate then continue; end if;
      if v_trip.itinerary_status = any (v_delivered_statuses) and v_paid >= v_delivered + v_extras then
        raise exception 'Trip #% is delivered and already paid -- its price is locked.', v_trip.itinerary_id;
      end if;

      -- Commission already on a driver's payslip: Payroll corrects it.
      insert into payroll_adjustments (employee_id, itinerary_id, old_rate, new_rate, created_by)
      select distinct p.employee_id, v_trip.itinerary_id, v_old_rate, v_rate, v_emp
        from payslip_line_items li
        join payroll_payslips p on p.payroll_id = li.payroll_id
       where li.itinerary_id = v_trip.itinerary_id;

      update itineraries set trip_rate = v_rate where itinerary_id = v_trip.itinerary_id;
      v_repriced := true;
    end loop;

    if v_repriced then
      update bookings
         set rate_of_delivery_service = (
               select round(avg(trip_rate), 2) from itineraries
                where booking_id = p_booking_id and itinerary_status is distinct from 'Cancelled')
       where booking_id = p_booking_id;
    end if;
  end if;

  -- ---- Route ----
  if p_changes ? 'pickup' then
    v_place := p_changes -> 'pickup';
    if coalesce(trim(v_place ->> 'city'), '') = '' or coalesce(trim(v_place ->> 'barangay'), '') = '' then
      raise exception 'Pick the pickup city and barangay.';
    end if;
    update bookings
       set place_of_pickup_id    = _find_or_create_place(v_place ->> 'city', v_place ->> 'barangay'),
           pickup_address_detail = nullif(trim(v_place ->> 'detail'), ''),
           pickup_landmark       = nullif(trim(v_place ->> 'landmark'), ''),
           pickup_lat            = (v_place ->> 'lat')::double precision,
           pickup_lng            = (v_place ->> 'lng')::double precision
     where booking_id = p_booking_id;
  end if;
  if p_changes ? 'delivery' then
    v_place := p_changes -> 'delivery';
    if coalesce(trim(v_place ->> 'city'), '') = '' or coalesce(trim(v_place ->> 'barangay'), '') = '' then
      raise exception 'Pick the delivery city and barangay.';
    end if;
    update bookings
       set place_of_delivery_id    = _find_or_create_place(v_place ->> 'city', v_place ->> 'barangay'),
           delivery_address_detail = nullif(trim(v_place ->> 'detail'), ''),
           delivery_landmark       = nullif(trim(v_place ->> 'landmark'), ''),
           delivery_lat            = (v_place ->> 'lat')::double precision,
           delivery_lng            = (v_place ->> 'lng')::double precision
     where booking_id = p_booking_id;
  end if;
  if p_changes ? 'return_place' then
    if b.place_of_return_id is null then raise exception 'This booking doesn''t return its containers.'; end if;
    v_place := p_changes -> 'return_place';
    if coalesce(trim(v_place ->> 'city'), '') = '' or coalesce(trim(v_place ->> 'barangay'), '') = '' then
      raise exception 'Pick the container return city and barangay.';
    end if;
    update bookings
       set place_of_return_id    = _find_or_create_place(v_place ->> 'city', v_place ->> 'barangay'),
           return_address_detail = nullif(trim(v_place ->> 'detail'), ''),
           return_landmark       = nullif(trim(v_place ->> 'landmark'), ''),
           return_lat            = (v_place ->> 'lat')::double precision,
           return_lng            = (v_place ->> 'lng')::double precision
     where booking_id = p_booking_id;
  end if;
  -- Trips that haven't left follow the new route.
  if p_changes ? 'pickup' or p_changes ? 'delivery' then
    update itineraries i
       set place_of_pickup_id = bk.place_of_pickup_id, place_of_delivery_id = bk.place_of_delivery_id
      from bookings bk
     where bk.booking_id = p_booking_id and i.booking_id = bk.booking_id and i.itinerary_status = 'Awaiting';
  end if;

  if p_changes ? 'estimated_distance_km' then
    v_num := (p_changes ->> 'estimated_distance_km')::numeric;
    if v_num is null or v_num <= 0 or v_num > 5000 then raise exception 'Enter a distance between 0 and 5,000 km.'; end if;
    update bookings set estimated_distance_km = round(v_num, 2) where booking_id = p_booking_id;
    -- Same as approval: remember the pair's distance for the next quote.
    insert into route_cache (place_id_a, place_id_b, distance_km)
    select least(place_of_pickup_id, place_of_delivery_id), greatest(place_of_pickup_id, place_of_delivery_id), round(v_num, 2)
      from bookings where booking_id = p_booking_id and place_of_pickup_id <> place_of_delivery_id
    on conflict (place_id_a, place_id_b) do update set distance_km = excluded.distance_km;
  end if;
  if p_changes ? 'return_distance_km' then
    v_num := (p_changes ->> 'return_distance_km')::numeric;
    if v_num is null or v_num < 0 or v_num > 5000 then raise exception 'Enter a return distance between 0 and 5,000 km.'; end if;
    update bookings set return_distance_km = round(v_num, 2) where booking_id = p_booking_id;
  end if;

  -- ---- Schedule & terms ----
  if p_changes ? 'hours_per_trip' then
    v_num := (p_changes ->> 'hours_per_trip')::numeric;
    if v_num is null or v_num <= 0 or v_num > 72 then raise exception 'Hours per trip must be more than 0 and up to 72.'; end if;
    update bookings set hours_per_trip = v_num where booking_id = p_booking_id;
  end if;
  if p_changes ? 'payment_terms' then
    if (p_changes ->> 'payment_terms') not in ('Cash', '7Days', '14Days', '30Days') then
      raise exception 'Pick valid payment terms.';
    end if;
    update bookings set payment_terms = p_changes ->> 'payment_terms' where booking_id = p_booking_id;
  end if;
  if p_changes ? 'pickup_date' or p_changes ? 'deadline_date' then
    select coalesce((p_changes ->> 'pickup_date')::date, q.preferred_pickup_date, b.booking_date),
           case when p_changes ? 'deadline_date' then (p_changes ->> 'deadline_date')::date else q.preferred_delivery_date end
      into v_pickup, v_deadline
      from (select 1) x left join quote_requests q on q.quote_request_id = b.quote_request_id;
    if v_deadline is not null and v_deadline < v_pickup then
      raise exception 'The deadline is before the pickup date.';
    end if;
    if p_changes ? 'pickup_date' then
      update bookings set booking_date = v_pickup where booking_id = p_booking_id;
    end if;
    -- The trip planner reads both dates from the quote.
    if b.quote_request_id is not null then
      update quote_requests
         set preferred_pickup_date = v_pickup, preferred_delivery_date = v_deadline
       where quote_request_id = b.quote_request_id;
    end if;
  end if;
  if p_changes ? 'storage_deadline' then
    update bookings set storage_deadline = (p_changes ->> 'storage_deadline')::date where booking_id = p_booking_id;
  end if;

  -- ---- Log + tell the client ----
  if coalesce(array_length(p_summary, 1), 0) > 0 then
    insert into booking_change_logs (booking_id, changed_by, changes) values (p_booking_id, v_emp, p_summary);
  end if;
  if nullif(trim(p_client_message), '') is not null then
    insert into client_notifications (client_id, booking_id, message)
    values (b.client_id, p_booking_id, trim(p_client_message));
  end if;

  return jsonb_build_object('repriced', v_repriced);
end $function$;
revoke all on function public.update_booking_details(integer, jsonb, text[], text) from public, anon;
grant execute on function public.update_booking_details(integer, jsonb, text[], text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261118000000', 'finance_fixes') on conflict (version) do nothing;
