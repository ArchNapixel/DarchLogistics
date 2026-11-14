-- 2026-11-14: empty-container return, step A. Three new trip statuses after
-- Delivered, used only by Container trips of a quote with "Return the empty
-- container" ticked: Unloading -> ReturningContainer -> ContainerReturned.
-- On its own file: Postgres can't USE a new enum value in the transaction that
-- added it. The app's filters name ContainerReturned, so run this BEFORE
-- deploying the app change that comes with it (src/lib/tripStatusFlow.ts).

alter type public.itinerary_status_enum add value if not exists 'Unloading' after 'Delivered';
alter type public.itinerary_status_enum add value if not exists 'ReturningContainer' after 'Unloading';
alter type public.itinerary_status_enum add value if not exists 'ContainerReturned' after 'ReturningContainer';

insert into supabase_migrations.schema_migrations (version, name)
values ('20261114030000', 'trip_return_statuses') on conflict (version) do nothing;
