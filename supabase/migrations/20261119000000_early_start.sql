-- 2026-11-19: trips can't start before their booking's start date
-- (the quote's preferred_pickup_date), unless an Admin allowed an early
-- start for the whole booking.
--
-- Found on booking #19: "Find a faster driver" re-timed both trips to the
-- next half hour (Nov 19) although the agreed start date was Nov 22, and
-- nothing stopped them from being dispatched that night.
--
-- 1. bookings.early_start_allowed_at / _by / early_start_reason: the Admin
--    approval (per booking, like the downpayment waiver).
-- 2. booking_start_date(booking_id): the quote's pickup date (null = no quote,
--    older bookings -- not gated).
-- 3. allow_early_start(booking_id, reason): Admin only, reason required.
-- 4. Trigger require_pickup_date (BEFORE UPDATE OF itinerary_status on
--    itineraries): Awaiting -> anything but Cancelled is refused while the
--    Manila date is before the start date and no early start was allowed.
--    Same shape as require_downpayment.
-- 5. get_my_trip_start_dates(): the driver app's "Starts Nov 22" -- crew
--    can't read bookings / quotes, so it returns only the start date of the
--    caller's own Awaiting trips that may not start yet.

alter table public.bookings
  add column if not exists early_start_allowed_at timestamptz,
  add column if not exists early_start_allowed_by integer,
  add column if not exists early_start_reason text;

create or replace function public.booking_start_date(p_booking_id integer)
 returns date
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select q.preferred_pickup_date
    from bookings b join quote_requests q on q.quote_request_id = b.quote_request_id
   where b.booking_id = p_booking_id
$function$;
revoke all on function public.booking_start_date(integer) from public, anon, authenticated;

create or replace function public.allow_early_start(p_booking_id integer, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_admin integer;
begin
  v_admin := current_admin_employee_id();   -- raises "Admins only"
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;
  update bookings
     set early_start_allowed_at = now(),
         early_start_allowed_by = v_admin,
         early_start_reason     = btrim(p_reason)
   where booking_id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;
end $function$;
revoke all on function public.allow_early_start(integer, text) from public, anon, authenticated;
grant execute on function public.allow_early_start(integer, text) to authenticated;

create or replace function public.require_pickup_date()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_start date; v_allowed timestamptz;
begin
  if old.itinerary_status is distinct from 'Awaiting'
     or new.itinerary_status in ('Awaiting', 'Cancelled') then
    return new;
  end if;
  select early_start_allowed_at into v_allowed from bookings where booking_id = new.booking_id;
  if v_allowed is not null then return new; end if;
  v_start := booking_start_date(new.booking_id);
  if v_start is not null and (now() at time zone 'Asia/Manila')::date < v_start then
    raise exception 'This trip can''t start before the booking''s start date (%). An Admin can allow an early start.',
      to_char(v_start, 'Mon FMDD, YYYY');
  end if;
  return new;
end $function$;

drop trigger if exists require_pickup_date on public.itineraries;
create trigger require_pickup_date before update of itinerary_status on public.itineraries
  for each row execute function require_pickup_date();

create or replace function public.get_my_trip_start_dates()
 returns table(itinerary_id integer, start_date date)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select i.itinerary_id, booking_start_date(i.booking_id)
    from itineraries i
    join bookings b on b.booking_id = i.booking_id
    join itinerary_crews c on c.itinerary_id = i.itinerary_id and c.is_active
    join users u on u.employee_id = c.employee_id and u.auth_user_id = auth.uid()
   where i.itinerary_status = 'Awaiting'
     and b.early_start_allowed_at is null
     and booking_start_date(i.booking_id) > (now() at time zone 'Asia/Manila')::date
$function$;
revoke all on function public.get_my_trip_start_dates() from public, anon, authenticated;
grant execute on function public.get_my_trip_start_dates() to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261119000000', 'early_start') on conflict (version) do nothing;
