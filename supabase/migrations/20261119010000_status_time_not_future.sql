-- A status change can't be logged later than the server's clock.
-- The app's "When did it happen?" picker checks "not in the future" against
-- the BROWSER's clock, so a computer with its date/time set ahead saved trip
-- #33's moves 7 hours into the future (and then nothing could be logged after
-- them). The server's now() is the only clock we trust.
--
-- Clamp, don't refuse: the app updates itineraries first and inserts the log
-- second, so a refused insert would leave the status changed with no log row
-- (= no delivery date for payroll / Payments Due).

create or replace function public.dispatch_status_logs_not_future()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.status_changed_at is null or new.status_changed_at > now() then
    new.status_changed_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists dispatch_status_logs_not_future on public.dispatch_status_logs;
create trigger dispatch_status_logs_not_future
  before insert or update of status_changed_at on public.dispatch_status_logs
  for each row execute function public.dispatch_status_logs_not_future();

-- Rows already in the future (from a wrong clock): shift each trip's future
-- rows back by the same amount, so its latest one lands a minute before now and
-- the order / gaps between its moves are kept (clamping them all to now() would
-- give six moves the same time).
-- ponytail: assumes the whole session was off by one amount; a shifted row
-- could land before that trip's last correct row -- check the trip if so.
with off as (
  select itinerary_id, max(status_changed_at) - now() + interval '1 minute' as d
  from public.dispatch_status_logs
  where status_changed_at > now()
  group by itinerary_id
)
update public.dispatch_status_logs l
   set status_changed_at = l.status_changed_at - off.d
  from off
 where l.itinerary_id = off.itinerary_id
   and l.status_changed_at > now();

insert into supabase_migrations.schema_migrations (version, name)
values ('20261119010000', 'status_time_not_future') on conflict (version) do nothing;
