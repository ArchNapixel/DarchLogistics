-- 2026-11-17: a vehicle in the shop is unavailable "until solved", plus the
-- Re-plan waiting trips save.
--
-- 1. get_capacity_inputs (Capacity Check, re-timing): a truck / trailer stays
--    busy from the moment it's in the shop until the END of the window being
--    checked -- it no longer turns free at 11:59 PM today:
--      - work order In Progress / On Hold: from now on
--      - work order Created / Scheduled WITH a date: from that date on
--      - status Under Maintenance: from now on (Out of Service already was)
--    Created work orders with no date (the auto PMS) still don't block.
--    It frees up when the work order is completed / cancelled and the vehicle
--    is set back to Available (releaseVehicleFromShop does both).
--    Only the shop CTE and the two "In the shop" lines changed (v_today_end -> p_to).
--
-- 2. replan_booking_trips(p_booking_id, p_trips): saves a Re-plan (Booking
--    Detail -> Re-plan waiting trips) in ONE transaction: new time, truck,
--    trailer and driver for some Awaiting trips of one booking. Staff only.
--    Any refusal (a trip started meanwhile, an overlap) rolls back everything.

CREATE OR REPLACE FUNCTION public.get_capacity_inputs(p_from timestamp with time zone, p_to timestamp with time zone, p_exclude_quote bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff boolean := coalesce(public.is_staff(), false);
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
  -- In the shop until solved: from now (or the job's date) to the end of the window.
  shop as (
    select w.plate_number, w.trailer_id,
           case when w.work_order_status in ('In Progress', 'On Hold') then p_from
                else w.scheduled_start_date::date::timestamp at time zone 'Asia/Manila' end as s,
           p_to as e
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
            select public._cap_ms(p_from), public._cap_ms(p_to), 'In the shop', null::bigint
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
            select public._cap_ms(p_from), public._cap_ms(p_to), 'In the shop', null::bigint
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

-- Re-plan waiting trips (Booking Detail). p_trips = [{itinerary_id, start,
-- end, driver_id, plate_number, trailer_id}], all Awaiting trips of
-- p_booking_id. Three passes so the overlap triggers (vehicle, crew) only see
-- the final slots, never a half-moved state:
--   1. check each trip, take a changed driver off, and "park" it (no time,
--      no truck, no trailer -- parked trips are ignored by the overlap checks);
--   2. give every trip its new time, truck and trailer;
--   3. put the new drivers on.
-- Drivers get the usual notifications (rescheduled / removed / assigned).
-- ponytail: parking writes a second itinerary_schedule_logs row per trip
-- (old -> none, then none -> new); merge them if the log ever matters.
create or replace function public.replan_booking_trips(p_booking_id integer, p_trips jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v jsonb;
  v_id integer;
  v_booking integer;
  v_status text;
  v_driver integer;
  v_count integer := 0;
begin
  if not coalesce(public.is_staff(), false) then
    raise exception 'Staff only';
  end if;
  if jsonb_typeof(p_trips) is distinct from 'array' or jsonb_array_length(p_trips) = 0 then
    raise exception 'Nothing to re-plan.';
  end if;

  -- 1. Check and park.
  for v in select * from jsonb_array_elements(p_trips) loop
    v_id := (v->>'itinerary_id')::int;
    select booking_id, coalesce(itinerary_status::text, 'Awaiting') into v_booking, v_status
      from itineraries where itinerary_id = v_id for update;
    if not found or v_booking is distinct from p_booking_id then
      raise exception 'Trip #% is not on booking #%.', v_id, p_booking_id;
    end if;
    if v_status <> 'Awaiting' then
      raise exception 'Trip #% has already started -- re-plan again.', v_id;
    end if;
    if (v->>'start') is null or (v->>'end') is null or (v->>'end')::timestamptz <= (v->>'start')::timestamptz then
      raise exception 'Trip #% has no valid new time.', v_id;
    end if;
    select employee_id into v_driver from itinerary_crews
     where itinerary_id = v_id and crew_role = 'Driver' and is_active limit 1;
    if v_driver is distinct from (v->>'driver_id')::int then
      update itinerary_crews set is_active = false, completed_at = now()
       where itinerary_id = v_id and crew_role = 'Driver' and is_active;
    end if;
    update itineraries set trip_start_at = null, plate_number = null, trailer_id = null
     where itinerary_id = v_id;
  end loop;

  -- 2. New time, truck, trailer.
  for v in select * from jsonb_array_elements(p_trips) loop
    update itineraries
       set trip_start_at = (v->>'start')::timestamptz,
           trip_end_at   = (v->>'end')::timestamptz,
           plate_number  = nullif(v->>'plate_number', ''),
           trailer_id    = (v->>'trailer_id')::int
     where itinerary_id = (v->>'itinerary_id')::int;
  end loop;

  -- 3. New drivers (a kept driver is still active from pass 1).
  for v in select * from jsonb_array_elements(p_trips) loop
    v_id := (v->>'itinerary_id')::int;
    if (v->>'driver_id') is not null and not exists (
      select 1 from itinerary_crews where itinerary_id = v_id and crew_role = 'Driver' and is_active
    ) then
      insert into itinerary_crews (itinerary_id, employee_id, crew_role)
      values (v_id, (v->>'driver_id')::int, 'Driver');
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.replan_booking_trips(integer, jsonb) from public, anon, authenticated;
grant execute on function public.replan_booking_trips(integer, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261117000000', 'shop_until_solved_and_replan') on conflict (version) do nothing;
