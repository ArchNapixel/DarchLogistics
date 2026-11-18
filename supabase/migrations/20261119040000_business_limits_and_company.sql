-- Group 2: business limits and company details out of the code.
--
-- 1. Number limits -> app_settings rows (they show up on Settings by themselves).
insert into public.app_settings (setting_key, label, setting_value, unit) values
  ('quote_max_weight_tons', 'Quotes: heaviest load per trip', 45, 'tons'),
  ('quote_max_trips', 'Quotes: most trips one quote can ask for', 50, 'trips'),
  ('max_hours_per_trip', 'Review Quote: longest one trip can take', 72, 'hours'),
  ('offer_expiry_days', 'Offers expire this many days after the pickup date', 3, 'days'),
  ('availability_hours_per_trip', 'Client availability note: hours assumed per trip', 6, 'hours'),
  ('service_due_soon_days', 'Truck Monitoring: service "due soon" within', 14, 'days'),
  ('similar_quote_days', 'Review Quote: flag a similar quote with pickup within', 2, 'days'),
  ('odometer_home_gap_hours', 'Odometer: no drive back to base if the next trip starts within', 12, 'hours')
on conflict (setting_key) do nothing;

-- 2. The 45-ton CHECK on itineraries becomes a trigger that reads the setting,
--    so raising it on Settings doesn't make trip inserts fail.
alter table public.itineraries drop constraint if exists itineraries_weight_check;

create or replace function public.itineraries_weight_limit()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_max numeric := coalesce(
    (select setting_value from public.app_settings where setting_key = 'quote_max_weight_tons'), 45);
begin
  if new.weight is not null and (new.weight <= 0 or new.weight > v_max) then
    raise exception 'Weight must be more than 0 and at most % tons.', v_max;
  end if;
  return new;
end;
$function$;

drop trigger if exists itineraries_weight_limit on public.itineraries;
create trigger itineraries_weight_limit
  before insert or update of weight on public.itineraries
  for each row execute function public.itineraries_weight_limit();

-- 3. Company details (text, so not app_settings): ONE row, edited on Settings.
--    Shown on Billing, Statements and the public footer; the base barangay is
--    where every truck leaves from and returns to (odometer km).
create table if not exists public.company_profile (
  id integer primary key default 1 check (id = 1),
  company_name text not null,
  address text not null,
  phone_number text not null check (phone_number ~ '^09[0-9]{9}$'),
  email text,
  tin_number text,
  base_city text not null,
  base_barangay text not null,
  updated_at timestamptz not null default now()
);

alter table public.company_profile enable row level security;

-- Everyone can read it (the public footer), only Admin can change it. No insert / delete.
drop policy if exists company_profile_select_all on public.company_profile;
create policy company_profile_select_all on public.company_profile
  for select to anon, authenticated using (true);
drop policy if exists company_profile_update_admin on public.company_profile;
create policy company_profile_update_admin on public.company_profile
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.company_profile (id, company_name, address, phone_number, email, base_city, base_barangay)
values (1, 'Darch Logistics', 'Brgy. J.P. Laurel, Panabo City', '09660475467', 'colesarch48@gmail.com',
        'Panabo City', 'J.P. Laurel')
on conflict (id) do nothing;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261119040000', 'business_limits_and_company') on conflict (version) do nothing;
