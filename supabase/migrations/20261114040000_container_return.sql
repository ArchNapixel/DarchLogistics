-- 2026-11-14: empty-container return, step B (needs step A,
-- 20261114030000_trip_return_statuses.sql, run first).
-- A quote can tick "Return the empty container" + one return place. On
-- Approve, its Container trips get itineraries.return_container = true and go
--   ... InTransit -> (Delivered, logged) -> Unloading -> ReturningContainer -> ContainerReturned.
-- A return trip never RESTS at Delivered: the app writes the Delivered log row
-- (billing / payroll date) and sets the status straight to Unloading. So
-- "finished" depends on the status alone (src/lib/tripStatusFlow.ts -- the two
-- helpers below repeat it; change both together).
-- Functions below are the live definitions of 2026-11-14 with only the status
-- lists changed (and the return place in create_booking_from_quote).

-- Quote: the checkbox and the return place (like pickup / delivery).
alter table public.quote_requests
  add column return_container boolean not null default false,
  add column return_city character varying,
  add column return_barangay character varying,
  add column return_location_text character varying(255),
  add column return_landmark text,
  add column return_lat double precision,
  add column return_lng double precision,
  -- Delivery -> return place, worked out in Review Quote (diesel / profit).
  add column return_distance_km numeric;
alter table public.quote_requests add constraint quote_requests_return_place_check
  check (not return_container or (return_city is not null and return_barangay is not null));

-- Booking: a set place_of_return_id = the booking returns its containers.
alter table public.bookings
  add column place_of_return_id integer references public.places (place_id),
  add column return_address_detail text,
  add column return_landmark text,
  add column return_lat double precision,
  add column return_lng double precision,
  add column return_distance_km numeric;

-- Trip: does THIS trip bring the empty container back?
alter table public.itineraries
  add column return_container boolean not null default false;
-- A return trip never rests at Delivered; a normal trip never gets the return steps.
alter table public.itineraries add constraint itineraries_return_status_check check (
  case when return_container then itinerary_status is distinct from 'Delivered'
       else itinerary_status is null
            or itinerary_status not in ('Unloading', 'ReturningContainer', 'ContainerReturned') end);

-- Same rules as src/lib/tripStatusFlow.ts (null status = Awaiting).
create or replace function public.trip_is_finished(p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_status, 'Awaiting') in ('Delivered', 'ContainerReturned', 'Cancelled')
$$;
create or replace function public.trip_on_road(p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_status, 'Awaiting') in ('Dispatched', 'PickedUp', 'InTransit', 'Unloading', 'ReturningContainer')
$$;

CREATE OR REPLACE FUNCTION public.free_vehicles_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Finished (not Cancelled): Delivered, or Container Returned on a trip that
  -- brings the empty container back (that one never rests at Delivered).
  if new.itinerary_status in ('Delivered', 'ContainerReturned')
     and old.itinerary_status is distinct from new.itinerary_status then
    -- only free a vehicle that is still marked In Transit (don't clobber
    -- Under Maintenance) and isn't out on another active trip
    if new.plate_number is not null then
      update truck_profiles set current_status = 'Available'
      where plate_number = new.plate_number
        and current_status = 'In Transit'
        and not exists (
          select 1 from itineraries i
          where i.plate_number = new.plate_number
            and i.itinerary_id <> new.itinerary_id
            and public.trip_on_road(i.itinerary_status::text));
    end if;
    if new.trailer_id is not null then
      update trailers set current_status = 'Available'
      where trailer_id = new.trailer_id
        and current_status = 'In Transit'
        and not exists (
          select 1 from itineraries i
          where i.trailer_id = new.trailer_id
            and i.itinerary_id <> new.itinerary_id
            and public.trip_on_road(i.itinerary_status::text));
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_booking_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_booking integer := coalesce(new.booking_id, old.booking_id);
  live_trips integer;
  delivered_trips integer;
  moving_trips integer;
begin
  select
    count(*),
    count(*) filter (where itinerary_status in ('Delivered', 'ContainerReturned')),
    count(*) filter (where coalesce(itinerary_status, 'Awaiting') <> 'Awaiting')
  into live_trips, delivered_trips, moving_trips
  from itineraries
  where booking_id = target_booking
    and itinerary_status is distinct from 'Cancelled';

  -- Every trip cancelled: leave the booking's status alone.
  if live_trips = 0 then
    return null;
  end if;

  update bookings
  set booking_status = case
      when delivered_trips = live_trips then 'Delivered'
      when moving_trips > 0 then 'InProgress'
      else 'Confirmed'
    end
  where booking_id = target_booking
    and booking_status is distinct from 'Cancelled';

  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_vehicle_slot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  clash record;
  v_end timestamptz;
begin
  if public.trip_is_finished(new.itinerary_status::text)
     or new.trip_start_at is null or new.trip_end_at is null
     or (new.plate_number is null and new.trailer_id is null) then
    return new;
  end if;
  -- A trip on the road is busy until it's delivered, even past its end.
  v_end := case when coalesce(new.itinerary_status, 'Awaiting') <> 'Awaiting'
                then greatest(new.trip_end_at, now()) else new.trip_end_at end;

  select i.itinerary_id, i.plate_number, i.trailer_id
    into clash
    from itineraries i
   where i.itinerary_id <> new.itinerary_id
     and not public.trip_is_finished(i.itinerary_status::text)
     and i.trip_start_at is not null and i.trip_end_at is not null
     and ((new.plate_number is not null and i.plate_number = new.plate_number)
       or (new.trailer_id is not null and i.trailer_id = new.trailer_id))
     -- Overlap; back to back (one ends 12 NN, next starts 12 NN) is fine.
     and i.trip_start_at < v_end
     and new.trip_start_at < case when coalesce(i.itinerary_status, 'Awaiting') <> 'Awaiting'
                                  then greatest(i.trip_end_at, now()) else i.trip_end_at end
   limit 1;

  if found then
    raise exception '% is already on trip #% at that time.',
      case when new.plate_number is not null and clash.plate_number = new.plate_number
           then 'Truck ' || new.plate_number else 'That trailer' end,
      clash.itinerary_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crew_slot_conflict(p_employee_id integer, p_itinerary_id integer)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select other.itinerary_id
  from itineraries me
  join itinerary_crews c
    on c.employee_id = p_employee_id
   and c.is_active
   and c.crew_role in ('Driver', 'Helper')
   and c.itinerary_id <> me.itinerary_id
  join itineraries other on other.itinerary_id = c.itinerary_id
  where me.itinerary_id = p_itinerary_id
    and me.trip_start_at is not null
    and other.trip_start_at is not null
    and not public.trip_is_finished(other.itinerary_status::text)
    and other.trip_start_at < me.trip_end_at
    and (case when other.itinerary_status <> 'Awaiting'
              then greatest(other.trip_end_at, now())
              else other.trip_end_at end) > me.trip_start_at
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.require_crew_free_of_road()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  busy record;
begin
  if old.itinerary_status = 'Awaiting'
     and new.itinerary_status not in ('Awaiting', 'Cancelled') then
    select e.full_name, other.itinerary_id
      into busy
      from itinerary_crews mine
      join itinerary_crews other
        on other.employee_id = mine.employee_id
       and other.is_active
       and other.crew_role in ('Driver', 'Helper')
       and other.itinerary_id <> new.itinerary_id
      join itineraries i
        on i.itinerary_id = other.itinerary_id
       and public.trip_on_road(i.itinerary_status::text)
      join employees e on e.employee_id = other.employee_id
     where mine.itinerary_id = new.itinerary_id
       and mine.is_active
       and mine.crew_role in ('Driver', 'Helper')
     limit 1;

    if found then
      raise exception '% is still on trip #%. Finish that trip first.',
        busy.full_name, busy.itinerary_id;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_trip_km(p_itinerary_id integer, p_out_km numeric, p_trip_km numeric, p_back_km numeric, p_note text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plate text; v_status text; v_delivered timestamptz; v_last_real timestamptz;
  v_current numeric; v_km numeric; v_new numeric;
begin
  if not is_staff() then raise exception 'Only Admin or Dispatcher can record trip km.'; end if;
  if p_out_km is null or p_trip_km is null or p_back_km is null
     or p_out_km < 0 or p_trip_km < 0 or p_back_km < 0 then
    raise exception 'Trip km must be zero or more.';
  end if;
  v_km := round(p_out_km + p_trip_km + p_back_km, 2);
  if v_km > 3000 then
    raise exception 'Trip #% would add % km, too much for one trip. Enter a real reading instead.', p_itinerary_id, v_km;
  end if;

  select plate_number, itinerary_status::text into v_plate, v_status
  from itineraries where itinerary_id = p_itinerary_id;
  if v_plate is null then raise exception 'Trip #% has no truck.', p_itinerary_id; end if;
  -- A container-return trip is counted once the container is back (its drive
  -- back to base starts at the return place).
  if v_status not in ('Delivered', 'ContainerReturned') then
    raise exception 'Trip #% is not finished yet.', p_itinerary_id;
  end if;

  -- One truck at a time.
  select current_odometer into v_current from truck_profiles where plate_number = v_plate for update;

  if exists (select 1 from truck_odometer_log where itinerary_id = p_itinerary_id and source = 'trip') then
    raise exception 'Trip #% is already counted on the odometer.', p_itinerary_id;
  end if;

  select max(status_changed_at) into v_delivered
  from dispatch_status_logs where itinerary_id = p_itinerary_id and new_status = 'Delivered';
  select max(recorded_at) into v_last_real
  from truck_odometer_log where plate_number = v_plate and source <> 'trip';
  if v_last_real is not null and coalesce(v_delivered, now()) <= v_last_real then
    raise exception 'Trip #% was delivered before %''s last real reading, which already includes it.', p_itinerary_id, v_plate;
  end if;

  v_new := coalesce(v_current, 0) + v_km;
  perform set_config('darch.odometer_write', 'on', true);
  update truck_profiles set current_odometer = v_new, updated_at = now() where plate_number = v_plate;
  perform set_config('darch.odometer_write', 'off', true);

  insert into truck_odometer_log
    (plate_number, source, reading, km_added, itinerary_id, out_km, trip_km, back_km, note, recorded_by)
  values (v_plate, 'trip', v_new, v_km, p_itinerary_id, p_out_km, p_trip_km, p_back_km,
          nullif(trim(p_note), ''), _my_employee_id());
  return v_new;
end $function$;

CREATE OR REPLACE FUNCTION public.get_capacity_inputs(p_from timestamp with time zone, p_to timestamp with time zone, p_exclude_quote bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff boolean := coalesce(public.is_staff(), false);
  v_today_end timestamptz :=
    (((now() at time zone 'Asia/Manila')::date + 1)::timestamp at time zone 'Asia/Manila');
  -- Sunday 12 MN (Manila) of p_from's week: trips from then count toward
  -- each driver's earnings that week (planTrips fairness).
  v_week_from timestamptz :=
    (((p_from at time zone 'Asia/Manila')::date
      - extract(dow from (p_from at time zone 'Asia/Manila'))::int)::timestamp at time zone 'Asia/Manila');
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  with raw_trips as (
    select i.itinerary_id, i.plate_number, i.trailer_id, i.trailer_type, i.cargo_type, i.trip_start_at as s,
           case when coalesce(i.itinerary_status, 'Awaiting') <> 'Awaiting'
                then greatest(i.trip_end_at, now()) else i.trip_end_at end as e
      from itineraries i
     where not public.trip_is_finished(i.itinerary_status::text)
       and i.trip_start_at is not null and i.trip_end_at is not null
  ),
  trips as (
    select * from raw_trips where e > p_from and s < p_to
  ),
  driver_trips as (
    select c.employee_id, t.itinerary_id, t.s, t.e
      from trips t
      join itinerary_crews c
        on c.itinerary_id = t.itinerary_id and c.is_active and c.crew_role = 'Driver'
  ),
  shop as (
    select w.plate_number, w.trailer_id,
           case when w.work_order_status in ('In Progress', 'On Hold') then p_from
                else w.scheduled_start_date::date::timestamp at time zone 'Asia/Manila' end as s,
           case when w.work_order_status in ('In Progress', 'On Hold') then v_today_end
                else (w.scheduled_start_date::date + 1)::timestamp at time zone 'Asia/Manila' end as e
      from work_orders w
     where w.work_order_status not in ('Completed', 'Cancelled')
       and (w.work_order_status in ('In Progress', 'On Hold') or w.scheduled_start_date is not null)
  )
  select jsonb_build_object(
    'default_start_minutes', coalesce((
      select nullif(a.setting_value::text, '')::numeric
        from app_settings a where a.setting_key = 'default_trip_start_time' limit 1
    ), 480),

    'drivers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.employee_id,
        'label', case when v_staff then e.full_name end,
        'truck', e.assigned_plate_number,
        'busy', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'start', b.s, 'end', b.e, 'reason', case when v_staff then b.r end, 'trip_id', b.tid)), '[]'::jsonb)
          from (
            select public._cap_ms(d.s) s, public._cap_ms(d.e) e, 'Trip #' || d.itinerary_id r, d.itinerary_id::bigint tid
              from driver_trips d where d.employee_id = e.employee_id
            union all
            select public._cap_ms(l.start_date::timestamp at time zone 'Asia/Manila'),
                   public._cap_ms((l.end_date + 1)::timestamp at time zone 'Asia/Manila'),
                   'On leave', null::bigint
              from leave_requests l
             where l.employee_id = e.employee_id and l.status = 'Approved'
               and l.end_date >= (p_from at time zone 'Asia/Manila')::date
               and l.start_date <= (p_to at time zone 'Asia/Manila')::date
            union all
            select public._cap_ms((e.driver_license_expiry_date + 1)::timestamp at time zone 'Asia/Manila'),
                   public._cap_ms(p_to), 'Licence expired', null::bigint
             where e.driver_license_expiry_date is not null
               and (e.driver_license_expiry_date + 1)::timestamp at time zone 'Asia/Manila' < p_to
          ) b
        )
      ) order by e.full_name), '[]'::jsonb)
      from employees e
      left join employment_status es on es.status_id = e.employment_status_id
     where e.position = 'Driver'
       and coalesce(es.status_name, '') not in ('Deactivated', 'Terminated')
    ),

    'trucks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', tp.plate_number,
        'label', case when v_staff then tp.plate_number end,
        'busy', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'start', b.s, 'end', b.e, 'reason', case when v_staff then b.r end, 'trip_id', b.tid)), '[]'::jsonb)
          from (
            select public._cap_ms(t.s) s, public._cap_ms(t.e) e, 'Trip #' || t.itinerary_id r, t.itinerary_id::bigint tid
              from trips t where t.plate_number = tp.plate_number
            union all
            select public._cap_ms(p_from), public._cap_ms(p_to), 'Out of service', null::bigint
             where tp.current_status = 'Out of Service'
            union all
            select public._cap_ms(p_from), public._cap_ms(v_today_end), 'In the shop', null::bigint
             where tp.current_status = 'Under Maintenance'
            union all
            select public._cap_ms(w.s), public._cap_ms(w.e), 'Work order', null::bigint
              from shop w where w.plate_number = tp.plate_number
            union all
            select public._cap_ms(m.due_date::timestamp at time zone 'Asia/Manila'),
                   public._cap_ms((m.due_date + 1)::timestamp at time zone 'Asia/Manila'),
                   'Service due', null::bigint
              from maintenance_schedules m
             where m.plate_number = tp.plate_number and m.status = 'Pending'
          ) b
        )
      ) order by tp.plate_number), '[]'::jsonb)
      from truck_profiles tp
    ),

    'trailers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', tr.trailer_id,
        'label', case when v_staff then coalesce(tr.plate_number, 'Trailer #' || tr.trailer_id) end,
        'trailer_type', tr.trailer_type,
        'trailer_size', tr.trailer_size,
        'busy', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'start', b.s, 'end', b.e, 'reason', case when v_staff then b.r end, 'trip_id', b.tid)), '[]'::jsonb)
          from (
            select public._cap_ms(t.s) s, public._cap_ms(t.e) e, 'Trip #' || t.itinerary_id r, t.itinerary_id::bigint tid
              from trips t where t.trailer_id = tr.trailer_id
            union all
            select public._cap_ms(p_from), public._cap_ms(p_to), 'Out of service', null::bigint
             where tr.current_status = 'Out of Service'
            union all
            select public._cap_ms(p_from), public._cap_ms(v_today_end), 'In the shop', null::bigint
             where tr.current_status = 'Under Maintenance'
            union all
            select public._cap_ms(w.s), public._cap_ms(w.e), 'Work order', null::bigint
              from shop w where w.trailer_id = tr.trailer_id
            union all
            select public._cap_ms(m.due_date::timestamp at time zone 'Asia/Manila'),
                   public._cap_ms((m.due_date + 1)::timestamp at time zone 'Asia/Manila'),
                   'Service due', null::bigint
              from maintenance_schedules m
             where m.trailer_id = tr.trailer_id and m.status = 'Pending'
          ) b
        )
      ) order by tr.trailer_id), '[]'::jsonb)
      from trailers tr
    ),

    'unassigned', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'itinerary_id', t.itinerary_id,
        'start', public._cap_ms(t.s),
        'end', public._cap_ms(t.e),
        'trailer_type', t.trailer_type,
        'cargo_type', t.cargo_type,
        'needs', to_jsonb(array_remove(array[
          case when not exists (select 1 from driver_trips d where d.itinerary_id = t.itinerary_id) then 'Driver' end,
          case when t.plate_number is null then 'Truck' end,
          case when t.trailer_id is null then 'Trailer' end
        ], null))
      )), '[]'::jsonb)
      from trips t
     where not exists (select 1 from driver_trips d where d.itinerary_id = t.itinerary_id)
        or t.plate_number is null
        or t.trailer_id is null
    ),

    -- Every trip not Cancelled from the start of p_from's payroll week, delivered
    -- ones too (earnings). A trip on the road is busy until now even past its end.
    -- container_type / exact_trailer_size: the size the trip asked for and
    -- "only a 20 ft trailer" (lib/trailerRules.ts).
    'trips', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'itinerary_id', i.itinerary_id,
        'status', coalesce(i.itinerary_status, 'Awaiting'),
        'start', public._cap_ms(i.trip_start_at),
        'end', public._cap_ms(case when public.trip_on_road(i.itinerary_status::text)
                                   then greatest(i.trip_end_at, now()) else i.trip_end_at end),
        'driver_id', c.employee_id,
        'truck', i.plate_number,
        'trailer_id', i.trailer_id,
        'trailer_type', i.trailer_type,
        'container_type', i.container_type,
        'exact_trailer_size', i.exact_trailer_size,
        'cargo_type', i.cargo_type,
        'rate', case when v_staff then i.trip_rate end
      ) order by i.trip_start_at), '[]'::jsonb)
      from itineraries i
      left join itinerary_crews c
        on c.itinerary_id = i.itinerary_id and c.is_active and c.crew_role = 'Driver'
     where coalesce(i.itinerary_status, 'Awaiting') <> 'Cancelled'
       and i.trip_start_at is not null and i.trip_end_at is not null
       and i.trip_start_at < p_to
       and (i.trip_end_at > v_week_from
            or public.trip_on_road(i.itinerary_status::text))
    ),

    -- Staff only: what a driver earns per trip (payslip.ts formula), for fairness.
    'pay', case when v_staff then jsonb_build_object(
      'commission_rate', (select nullif(a.setting_value::text, '')::numeric
                            from app_settings a where a.setting_key = 'driver_commission_rate' limit 1),
      'per_trip_fee',    (select nullif(a.setting_value::text, '')::numeric
                            from app_settings a where a.setting_key = 'driver_per_trip_fee' limit 1)
    ) end,

    'offers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quote_id', q.quote_request_id,
        'label', case when v_staff then 'Quote #' || q.quote_request_id else 'another quote' end,
        'pickup_date', q.preferred_pickup_date,
        'hours', q.hours_per_trip,
        'storage', coalesce(q.is_last_day_of_port_storage, false),
        'cargo_lines', q.cargo_lines
      ) order by q.created_at), '[]'::jsonb)
      from quote_requests q
     where q.request_status = 'Offered'
       and q.quote_request_id is distinct from p_exclude_quote
       and q.hours_per_trip is not null
       and q.preferred_pickup_date is not null
    )
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_booking_from_quote(p_quote_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q             public.quote_requests;
  v_client_id   integer;
  v_pickup_id   integer;
  v_delivery_id integer;
  v_return_id   integer;
  v_booking_id  integer;
  v_trips       integer;
  v_start_min   numeric;
  v_first       timestamptz;
  v_urgent      boolean;
  v_rates       jsonb;
  v_avg         numeric;
  v_plan        jsonb;
  v_shift       interval := interval '0';
  v_trip        record;
  v_slot        jsonb;
  v_start       timestamptz;
  v_end         timestamptz;
  v_itin        integer;
  v_swap        jsonb;
  v_status      text;
begin
  select * into q from public.quote_requests where quote_request_id = p_quote_id for update;
  if not found then raise exception 'Quote not found.'; end if;

  if q.estimated_distance_km is null or q.hours_per_trip is null or q.cost_per_trip is null then
    raise exception 'This quote has not been priced yet (distance, hours per trip, cost).';
  end if;
  if q.preferred_pickup_date is null then raise exception 'This quote has no pickup date.'; end if;
  if q.pickup_city is null or q.pickup_barangay is null or q.delivery_city is null or q.delivery_barangay is null then
    raise exception 'This quote is missing a city/barangay.';
  end if;
  if q.cargo_lines is null or jsonb_array_length(q.cargo_lines) = 0 then
    raise exception 'This quote has no cargo lines.';
  end if;

  v_rates := q.line_rates;
  if v_rates is null and q.proposed_rate is not null then
    select jsonb_agg(q.proposed_rate) into v_rates from jsonb_array_elements(q.cargo_lines);
  end if;
  v_avg := public.quote_average_rate(q.cargo_lines, v_rates);

  select coalesce(sum(greatest(coalesce((l->>'quantity')::int, 1), 1)), 0) into v_trips
  from jsonb_array_elements(q.cargo_lines) l;
  if v_trips > 50 then raise exception 'This quote has % trips (max 50).', v_trips; end if;

  v_client_id := q.client_id;
  if v_client_id is null and nullif(trim(q.contact_email), '') is not null then
    select client_id into v_client_id from public.clients
    where lower(email) = lower(trim(q.contact_email))
    order by client_id limit 1;
  end if;
  if v_client_id is null then
    insert into public.clients (client_name, email, phone_number)
    values (q.client_name, nullif(lower(trim(q.contact_email)), ''), q.contact_number)
    returning client_id into v_client_id;
  end if;

  select place_id into v_pickup_id from public.places
  where lower(trim(city)) = lower(trim(q.pickup_city)) and lower(trim(barangay)) = lower(trim(q.pickup_barangay))
  limit 1;
  if v_pickup_id is null then
    insert into public.places (place_name, city, barangay)
    values ('Brgy. ' || trim(q.pickup_barangay) || ', ' || trim(q.pickup_city), trim(q.pickup_city), trim(q.pickup_barangay))
    returning place_id into v_pickup_id;
  end if;
  select place_id into v_delivery_id from public.places
  where lower(trim(city)) = lower(trim(q.delivery_city)) and lower(trim(barangay)) = lower(trim(q.delivery_barangay))
  limit 1;
  if v_delivery_id is null then
    insert into public.places (place_name, city, barangay)
    values ('Brgy. ' || trim(q.delivery_barangay) || ', ' || trim(q.delivery_city), trim(q.delivery_city), trim(q.delivery_barangay))
    returning place_id into v_delivery_id;
  end if;

  -- "Return the empty container": the place it goes back to (often the port).
  if q.return_container then
    if q.return_city is null or q.return_barangay is null then
      raise exception 'This quote is missing the container return city/barangay.';
    end if;
    select place_id into v_return_id from public.places
    where lower(trim(city)) = lower(trim(q.return_city)) and lower(trim(barangay)) = lower(trim(q.return_barangay))
    limit 1;
    if v_return_id is null then
      insert into public.places (place_name, city, barangay)
      values ('Brgy. ' || trim(q.return_barangay) || ', ' || trim(q.return_city), trim(q.return_city), trim(q.return_barangay))
      returning place_id into v_return_id;
    end if;
  end if;

  insert into public.route_cache (place_id_a, place_id_b, distance_km)
  values (least(v_pickup_id, v_delivery_id), greatest(v_pickup_id, v_delivery_id), q.estimated_distance_km)
  on conflict (place_id_a, place_id_b) do update set distance_km = excluded.distance_km;

  update public.quote_requests set
    request_status       = 'Approved',
    client_id            = v_client_id,
    place_of_pickup_id   = v_pickup_id,
    place_of_delivery_id = v_delivery_id
  where quote_request_id = p_quote_id;

  v_urgent := coalesce(q.is_last_day_of_port_storage, false);

  insert into public.bookings (
    quote_request_id, client_id, place_of_pickup_id, place_of_delivery_id,
    pickup_address_detail, delivery_address_detail, pickup_landmark, delivery_landmark,
    pickup_lat, pickup_lng, delivery_lat, delivery_lng,
    payment_terms, booking_status, booking_date, estimated_distance_km,
    rate_of_delivery_service, hours_per_trip, cost_per_trip, storage_deadline, is_last_day_of_port_storage,
    place_of_return_id, return_address_detail, return_landmark, return_lat, return_lng, return_distance_km
  ) values (
    p_quote_id, v_client_id, v_pickup_id, v_delivery_id,
    nullif(q.pickup_location_text, ''), nullif(q.delivery_location_text, ''), q.pickup_landmark, q.delivery_landmark,
    q.pickup_lat, q.pickup_lng, q.delivery_lat, q.delivery_lng,
    q.payment_terms, 'Confirmed', q.preferred_pickup_date, q.estimated_distance_km,
    v_avg, q.hours_per_trip, q.cost_per_trip,
    case when v_urgent then q.preferred_pickup_date end, v_urgent,
    v_return_id,
    case when q.return_container then nullif(q.return_location_text, '') end,
    case when q.return_container then q.return_landmark end,
    case when q.return_container then q.return_lat end,
    case when q.return_container then q.return_lng end,
    case when q.return_container then q.return_distance_km end
  ) returning booking_id into v_booking_id;

  -- No plan: the old way -- back to back from pickup date + default start
  -- (storage-deadline: all at once), no driver / truck / trailer.
  select coalesce(
    (select setting_value::text::numeric from public.app_settings where setting_key = 'default_trip_start_time'),
    480) into v_start_min;
  v_first := (q.preferred_pickup_date::timestamp + make_interval(mins => v_start_min::int)) at time zone 'Asia/Manila';
  if v_first < now() then
    v_first := to_timestamp(ceil(extract(epoch from now()) / 1800) * 1800);
  end if;

  -- The plan from the Capacity card (send_quote_offer / accept_quote_counter).
  -- One that doesn't match the trips any more is ignored.
  v_plan := q.trip_plan;
  if v_plan is not null and jsonb_array_length(coalesce(v_plan->'trips', '[]'::jsonb)) <> v_trips then
    v_plan := null;
  end if;
  if v_plan is not null then
    -- Accepted after the planned first start: the whole plan moves to the next half hour.
    select min((t->>'start')::timestamptz) into v_start from jsonb_array_elements(v_plan->'trips') t;
    if v_start < now() then
      v_shift := to_timestamp(ceil(extract(epoch from now()) / 1800) * 1800) - v_start;
    end if;
  end if;

  begin
    -- Driver changes on booked trips the plan needs (approved by staff when
    -- the offer was sent). Only on trips still Awaiting.
    if v_plan is not null then
      for v_swap in select * from jsonb_array_elements(coalesce(v_plan->'swaps', '[]'::jsonb)) loop
        select coalesce(itinerary_status, 'Awaiting') into v_status
          from public.itineraries where itinerary_id = (v_swap->>'itinerary_id')::int for update;
        if v_status is distinct from 'Awaiting' then
          raise exception 'trip #% has already started', v_swap->>'itinerary_id';
        end if;
        update public.itinerary_crews set is_active = false, completed_at = now()
         where itinerary_id = (v_swap->>'itinerary_id')::int and crew_role = 'Driver' and is_active;
        insert into public.itinerary_crews (itinerary_id, employee_id, crew_role)
        values ((v_swap->>'itinerary_id')::int, (v_swap->>'driver_id')::int, 'Driver');
        update public.itineraries set plate_number = v_swap->>'plate_number'
         where itinerary_id = (v_swap->>'itinerary_id')::int;
      end loop;
    end if;

    for v_trip in
      select l.line, l.line_no, s.i, row_number() over (order by l.line_no, s.i) as n
      from jsonb_array_elements(q.cargo_lines) with ordinality as l(line, line_no)
      cross join lateral generate_series(1, greatest(coalesce((l.line->>'quantity')::int, 1), 1)) as s(i)
      order by n
    loop
      if v_plan is not null then
        v_slot  := v_plan->'trips'->((v_trip.n - 1)::int);
        v_start := (v_slot->>'start')::timestamptz + v_shift;
        v_end   := (v_slot->>'end')::timestamptz + v_shift;
      else
        v_slot  := null;
        v_start := v_first + (case when v_urgent then 0 else v_trip.n - 1 end) * q.hours_per_trip * interval '1 hour';
        v_end   := v_start + q.hours_per_trip * interval '1 hour';
      end if;

      insert into public.itineraries (
        booking_id, place_of_pickup_id, place_of_delivery_id, trip_date_from,
        trip_start_at, trip_end_at, itinerary_status,
        cargo_type, container_type, exact_trailer_size, trailer_type, weight, cargo_description, trip_rate,
        plate_number, trailer_id, return_container
      ) values (
        v_booking_id, v_pickup_id, v_delivery_id, (v_start at time zone 'Asia/Manila')::date,
        v_start, v_end, 'Awaiting',
        v_trip.line->>'cargo_type', v_trip.line->>'container_type',
        -- "Only a 20 ft trailer" (cargo_lines[].exact_size); 20ft lines only,
        -- missing on older quotes = false.
        coalesce(v_trip.line->>'exact_size' = 'true', false) and v_trip.line->>'container_type' = '20ft',
        case when v_trip.line->>'cargo_type' = 'Loose' then 'Flatbed' else v_trip.line->>'trailer_type' end,
        (v_trip.line->>'weight')::numeric,
        coalesce(v_trip.line->'cargo_descriptions'->>(v_trip.i - 1), v_trip.line->>'cargo_description', ''),
        (v_rates->>((v_trip.line_no - 1)::int))::numeric,
        v_slot->>'plate_number',
        (v_slot->>'trailer_id')::int,
        -- Only Container trips bring an empty container back.
        coalesce(q.return_container, false) and v_trip.line->>'cargo_type' = 'Container'
      ) returning itinerary_id into v_itin;

      if v_plan is not null then
        insert into public.itinerary_crews (itinerary_id, employee_id, crew_role)
        values (v_itin, (v_slot->>'driver_id')::int, 'Driver');
      end if;
    end loop;
  exception when others then
    -- A driver / truck / trailer in the plan was given to another trip since
    -- the offer went out (the overlap triggers refuse it): nothing is saved.
    if v_plan is not null then
      raise exception 'This date was just taken (%). We''ll send you a new offer.', sqlerrm;
    end if;
    raise;
  end;

  return v_booking_id;
end;
$function$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261114040000', 'container_return') on conflict (version) do nothing;
