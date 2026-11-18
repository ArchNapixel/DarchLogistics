-- 2026-11-18 (later): finance loopholes found in the third audit.
-- Run once in the Supabase SQL Editor, AFTER 20261118000000 and
-- 20261118010000. Safe to re-run.

-- ---------------------------------------------------------------------------
-- #3a. A delivered trip repriced later: the change is its own dated line.
create table if not exists public.trip_price_changes (
  change_id integer generated always as identity primary key,
  itinerary_id integer not null references public.itineraries (itinerary_id),
  booking_id integer not null references public.bookings (booking_id),
  old_rate numeric(12,2) not null,
  new_rate numeric(12,2) not null,
  changed_by integer references public.employees (employee_id),
  changed_at timestamptz not null default now()
);
create index if not exists trip_price_changes_trip_idx on public.trip_price_changes (itinerary_id);
alter table public.trip_price_changes enable row level security;
drop policy if exists trip_price_changes_select_staff on public.trip_price_changes;
create policy trip_price_changes_select_staff on public.trip_price_changes
  for select to authenticated using (is_staff());
drop policy if exists trip_price_changes_select_own_client on public.trip_price_changes;
create policy trip_price_changes_select_own_client on public.trip_price_changes
  for select to authenticated using (
    exists (select 1 from public.bookings b join public.users u on u.client_id = b.client_id
             where b.booking_id = trip_price_changes.booking_id and u.auth_user_id = auth.uid()));

-- #3b. The km a delivered trip was costed with, kept when the distance is edited.
alter table public.itineraries add column if not exists costed_distance_km numeric;

-- #9. The commission % a trip line was paid at.
alter table public.payslip_line_items add column if not exists commission_rate numeric;

-- update_booking_details: same as before + #3a / #3b.
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

      -- Delivered already: keep the change as its own dated line, so the
      -- delivery month's revenue never changes (lib/tripPriceChanges.ts).
      if v_trip.itinerary_status = any (v_delivered_statuses) then
        insert into trip_price_changes (itinerary_id, booking_id, old_rate, new_rate, changed_by)
        values (v_trip.itinerary_id, p_booking_id, v_old_rate, v_rate, v_emp);
      end if;

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

  -- Delivered trips keep the km they were costed with (diesel of a closed
  -- month never changes): saved once, before the booking's distance moves.
  if p_changes ? 'estimated_distance_km' or p_changes ? 'return_distance_km' then
    update itineraries i
       set costed_distance_km = coalesce(b.estimated_distance_km, 0)
                                + case when i.return_container then coalesce(b.return_distance_km, 0) else 0 end
     where i.booking_id = p_booking_id
       and i.costed_distance_km is null
       and i.itinerary_status = any (v_delivered_statuses);
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

-- ---------------------------------------------------------------------------
-- #4. No new charges on a closed bill: cancelled, or every trip completed and
--     fully paid (same lock as update_booking_details / lib/bookingEdit.ts).
create or replace function public.booking_charge_allowed(p_booking_id integer)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  b bookings; v_delivered numeric; v_all_done boolean; v_extras numeric;
begin
  select * into b from bookings where booking_id = p_booking_id;
  if not found or b.booking_status = 'Cancelled' then return false; end if;
  select coalesce(sum(coalesce(trip_rate, b.rate_of_delivery_service, 0))
                    filter (where itinerary_status in ('Delivered', 'Unloading', 'ReturningContainer', 'ContainerReturned')), 0),
         coalesce(bool_and(itinerary_status in ('Delivered', 'ContainerReturned')), false)
    into v_delivered, v_all_done
    from itineraries where booking_id = p_booking_id and itinerary_status is distinct from 'Cancelled';
  select coalesce(sum(d.estimated_damage_cost), 0) into v_extras
    from delivery_damage_records d join itineraries i on i.itinerary_id = d.itinerary_id
   where i.booking_id = p_booking_id and d.damage_status = 'Approved' and d.charge_to = 'Client';
  v_extras := v_extras + coalesce((select sum(amount) from booking_charges where booking_id = p_booking_id and voided_at is null), 0);
  return not (v_all_done and coalesce(b.amount_paid, 0) >= v_delivered + v_extras);
end $function$;
revoke all on function public.booking_charge_allowed(integer) from public, anon;
grant execute on function public.booking_charge_allowed(integer) to authenticated;

drop policy if exists booking_charges_insert_admin on public.booking_charges;
create policy booking_charges_insert_admin on public.booking_charges
  for insert to authenticated with check (is_admin() and booking_charge_allowed(booking_id));

-- ---------------------------------------------------------------------------
-- #5. A charge / a remittance can only be VOIDED (with a reason), never
--     edited in place -- a wrong one is voided and added again.
create or replace function public.booking_charges_guard()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.booking_id is distinct from old.booking_id or new.amount is distinct from old.amount
     or new.description is distinct from old.description or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'A charge can''t be edited -- void it and add a new one.';
  end if;
  if old.voided_at is not null then raise exception 'This charge is already voided.'; end if;
  if new.voided_at is not null and coalesce(trim(new.void_reason), '') = '' then
    raise exception 'A reason is needed to void a charge.';
  end if;
  return new;
end $function$;
drop trigger if exists booking_charges_guard on public.booking_charges;
create trigger booking_charges_guard before update on public.booking_charges
  for each row execute function public.booking_charges_guard();

create or replace function public.government_remittances_guard()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.period_month is distinct from old.period_month or new.agency is distinct from old.agency
     or new.amount is distinct from old.amount or new.paid_on is distinct from old.paid_on
     or new.reference_no is distinct from old.reference_no or new.note is distinct from old.note
     or new.recorded_by is distinct from old.recorded_by or new.created_at is distinct from old.created_at then
    raise exception 'A remittance can''t be edited -- void it and record it again.';
  end if;
  if old.voided_at is not null then raise exception 'This remittance is already voided.'; end if;
  if new.voided_at is not null and coalesce(trim(new.void_reason), '') = '' then
    raise exception 'A reason is needed to void a remittance.';
  end if;
  return new;
end $function$;
drop trigger if exists government_remittances_guard on public.government_remittances;
create trigger government_remittances_guard before update on public.government_remittances
  for each row execute function public.government_remittances_guard();

-- ---------------------------------------------------------------------------
-- #6. The database caps payments too (the form did; two admins at once or a
--     direct call could go past it):
--       payment  <= the whole contract + extra charges - what's paid
--       refund   <= what's paid
--       date received not in the future, not before the booking was made
create or replace function public.record_booking_payment(
  p_booking_id integer, p_amount numeric, p_method text, p_paid_on date default null,
  p_reference_no text default null, p_or_number text default null, p_note text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_emp integer; v_id integer; b bookings; v_contract numeric; v_extras numeric;
  v_paid numeric; v_room numeric; v_paid_on date;
begin
  if not exists (select 1 from public.users where auth_user_id = auth.uid() and user_role = 'Admin') then
    raise exception 'Admins only';
  end if;
  if p_amount is null or p_amount = 0 then raise exception 'Amount must not be zero'; end if;
  select * into b from public.bookings where booking_id = p_booking_id for update;
  if not found then raise exception 'Booking % not found', p_booking_id; end if;

  v_paid_on := coalesce(p_paid_on, (now() at time zone 'Asia/Manila')::date);
  if v_paid_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Date received can''t be in the future.';
  end if;
  if b.created_at is not null and v_paid_on < (b.created_at at time zone 'Asia/Manila')::date then
    raise exception 'Date received can''t be before the booking was made.';
  end if;

  select coalesce(sum(coalesce(trip_rate, b.rate_of_delivery_service, 0)), 0) into v_contract
    from public.itineraries where booking_id = p_booking_id and itinerary_status is distinct from 'Cancelled';
  select coalesce(sum(d.estimated_damage_cost), 0) into v_extras
    from public.delivery_damage_records d join public.itineraries i on i.itinerary_id = d.itinerary_id
   where i.booking_id = p_booking_id and d.damage_status = 'Approved' and d.charge_to = 'Client';
  v_extras := v_extras + coalesce(
    (select sum(amount) from public.booking_charges where booking_id = p_booking_id and voided_at is null), 0);
  v_paid := coalesce(b.amount_paid, 0);

  if p_amount > 0 then
    v_room := round(v_contract + v_extras - v_paid, 2);
    if p_amount > v_room + 0.005 then
      raise exception 'That is more than what''s left on this booking (₱%).', greatest(v_room, 0);
    end if;
  elsif -p_amount > v_paid + 0.005 then
    raise exception 'A refund can''t be more than what was paid (₱%).', v_paid;
  end if;

  select employee_id into v_emp from public.users where auth_user_id = auth.uid();
  insert into public.booking_payments
    (booking_id, amount, method, paid_on, reference_no, or_number, note, recorded_by)
  values
    (p_booking_id, p_amount, p_method, v_paid_on,
     nullif(trim(p_reference_no), ''), nullif(trim(p_or_number), ''), nullif(trim(p_note), ''), v_emp)
  returning payment_id into v_id;
  return v_id;
end $function$;
revoke all on function public.record_booking_payment(integer, numeric, text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.record_booking_payment(integer, numeric, text, date, text, text, text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261118020000', 'finance_loopholes') on conflict (version) do nothing;
