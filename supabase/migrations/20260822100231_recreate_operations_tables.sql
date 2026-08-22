-- Recreates the operational tables that support bookings, dispatch,
-- and delivery tracking, after most of the original schema was deleted
-- on 2026-08-22 to start the backend cleanly.
--
-- This file documents SQL that was already run directly in the
-- Supabase Dashboard SQL Editor (not through this migration) -- it's
-- added here after the fact purely so this history is recorded in the
-- repo, then marked as already-applied via `supabase migration repair`
-- rather than being pushed again.
--
-- USER-DEFINED enum types from the original schema (e.g.
-- itinerary_status_enum, booking_status_enum) were replaced with plain
-- `text` columns, since the original CREATE TYPE ... AS ENUM
-- definitions and their full allowed-value lists were never provided --
-- only some default values and a few values referenced in frontend
-- code. Guessing the rest would violate this project's "never guess
-- schema" rule. These can be upgraded to real enums later once the
-- full value lists are confirmed.
--
-- Left out on purpose: `work_orders` (needed for Mechanic Tasks) --
-- the original schema required a NOT NULL foreign key to a
-- `maintenance_requests` table, which itself links to
-- `inspection_reports`. Neither exists yet; adding `work_orders` needs
-- a decision on whether to rebuild that full chain or simplify it.

CREATE TABLE public.places (
  place_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  place_name character varying NOT NULL,
  city character varying,
  province character varying,
  country character varying DEFAULT 'Philippines',
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT places_pkey PRIMARY KEY (place_id)
);

CREATE TABLE public.truck_profiles (
  plate_number character varying NOT NULL,
  truck_code character varying UNIQUE,
  make character varying,
  model character varying,
  year integer,
  registration_date date,
  registration_expiry_date date,
  engine_number character varying,
  chassis_number character varying,
  insurance_provider character varying,
  insurance_policy_number character varying,
  insurance_expiry_date date,
  trailer_type_compatible text DEFAULT 'Both',
  current_status text DEFAULT 'Available',
  current_odometer numeric DEFAULT 0,
  last_service_date date,
  next_service_date date,
  acquisition_date date,
  acquisition_cost numeric,
  current_value numeric,
  total_trips_done integer DEFAULT 0,
  total_kilometers_driven numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT truck_profiles_pkey PRIMARY KEY (plate_number)
);

CREATE TABLE public.trailers (
  trailer_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  trailer_code character varying NOT NULL UNIQUE,
  trailer_type text NOT NULL,
  registration_number character varying,
  registration_expiry_date date,
  current_status text DEFAULT 'Available',
  current_place_id integer,
  acquisition_date date,
  acquisition_cost numeric,
  current_value numeric,
  last_maintenance_date date,
  next_maintenance_date date,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT trailers_pkey PRIMARY KEY (trailer_id),
  CONSTRAINT trailers_current_place_id_fkey FOREIGN KEY (current_place_id) REFERENCES public.places(place_id)
);

CREATE TABLE public.bookings (
  booking_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  quote_request_id integer,
  client_id integer NOT NULL,
  booking_date date NOT NULL,
  place_of_pickup_id integer NOT NULL,
  place_of_delivery_id integer NOT NULL,
  cargo_type text NOT NULL,
  container_type text,
  weight numeric,
  weight_unit text,
  cargo_description text,
  payment_terms text NOT NULL,
  is_last_day_of_port_storage boolean DEFAULT false,
  estimated_distance_km numeric NOT NULL,
  rate_of_delivery_service numeric,
  estimated_fuel_cost numeric,
  booking_status text DEFAULT 'Draft',
  amount_to_pay numeric,
  amount_paid numeric DEFAULT 0,
  balance_due numeric,
  initial_payment_received numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  confirmed_at timestamp with time zone,
  notes text,
  CONSTRAINT bookings_pkey PRIMARY KEY (booking_id),
  CONSTRAINT bookings_quote_request_id_fkey FOREIGN KEY (quote_request_id) REFERENCES public.quote_requests(quote_request_id),
  CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id),
  CONSTRAINT bookings_place_of_pickup_id_fkey FOREIGN KEY (place_of_pickup_id) REFERENCES public.places(place_id),
  CONSTRAINT bookings_place_of_delivery_id_fkey FOREIGN KEY (place_of_delivery_id) REFERENCES public.places(place_id)
);

CREATE TABLE public.itineraries (
  itinerary_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  booking_id integer NOT NULL,
  trip_date_from date NOT NULL,
  trip_date_to date,
  place_of_pickup_id integer NOT NULL,
  place_of_delivery_id integer NOT NULL,
  estimated_pickup_time time without time zone,
  estimated_delivery_time time without time zone,
  actual_pickup_time timestamp with time zone,
  actual_delivery_time timestamp with time zone,
  itinerary_status text DEFAULT 'Awaiting',
  trip_distance numeric,
  estimated_fuel_cost numeric,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT itineraries_pkey PRIMARY KEY (itinerary_id),
  CONSTRAINT itineraries_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(booking_id),
  CONSTRAINT itineraries_place_of_pickup_id_fkey FOREIGN KEY (place_of_pickup_id) REFERENCES public.places(place_id),
  CONSTRAINT itineraries_place_of_delivery_id_fkey FOREIGN KEY (place_of_delivery_id) REFERENCES public.places(place_id)
);

CREATE TABLE public.dispatch_status_logs (
  log_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  status_changed_at timestamp with time zone DEFAULT now(),
  changed_by integer,
  location character varying,
  additional_notes text,
  CONSTRAINT dispatch_status_logs_pkey PRIMARY KEY (log_id),
  CONSTRAINT dispatch_status_logs_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES public.itineraries(itinerary_id)
);

CREATE TABLE public.delivery_receipts (
  delivery_receipt_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL UNIQUE,
  receiver_name character varying NOT NULL,
  receiver_contact character varying,
  delivery_condition text DEFAULT 'Good',
  delivery_notes text,
  proof_of_delivery_photo character varying,
  received_at timestamp with time zone NOT NULL,
  recorded_at timestamp with time zone DEFAULT now(),
  recorded_by integer,
  CONSTRAINT delivery_receipts_pkey PRIMARY KEY (delivery_receipt_id),
  CONSTRAINT delivery_receipts_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES public.itineraries(itinerary_id)
);

CREATE TABLE public.delivery_damage_records (
  damage_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  delivery_receipt_id integer NOT NULL,
  damage_description text NOT NULL,
  estimated_damage_cost numeric,
  photos_of_damage character varying,
  charge_to text DEFAULT 'Client',
  damage_status text DEFAULT 'Reported',
  approved_at timestamp with time zone,
  approved_by integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT delivery_damage_records_pkey PRIMARY KEY (damage_id),
  CONSTRAINT delivery_damage_records_delivery_receipt_id_fkey FOREIGN KEY (delivery_receipt_id) REFERENCES public.delivery_receipts(delivery_receipt_id)
);

CREATE TABLE public.itinerary_crews (
  itinerary_crew_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  employee_id integer NOT NULL,
  crew_role text NOT NULL,
  assigned_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  completed_at timestamp with time zone,
  CONSTRAINT itinerary_crews_pkey PRIMARY KEY (itinerary_crew_id),
  CONSTRAINT itinerary_crews_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES public.itineraries(itinerary_id)
);
