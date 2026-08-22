-- Reference copy of the Supabase database schema, pasted by the project
-- owner on 2026-08-22, after deleting most of the previous tables to
-- start the backend cleanly. NOT run against the database -- for
-- lookup only, so future work can confirm exact table/column names
-- without re-asking.
-- Source of truth is always the live Supabase project, not this file.
--
-- This REPLACES the much larger schema pasted on 2026-08-20 (43
-- tables covering bookings, dispatch, invoicing, maintenance, payroll,
-- etc.) -- all of those tables have been deleted except the 4 below.
-- Any old frontend code that queries a table not listed here (places,
-- bookings, itineraries, work_orders, itinerary_crews,
-- delivery_receipts, dispatch_status_logs, incident_logs,
-- itinerary_expenses, trip_profitability, and others) will now fail,
-- since those tables no longer exist.

-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.clients (
  client_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  client_name character varying NOT NULL,
  contact_person character varying,
  email character varying UNIQUE,
  phone_number character varying,
  address text,
  payment_terms_preference USER-DEFINED DEFAULT 'Cash'::payment_terms_enum,
  credit_limit numeric,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  notes text,
  CONSTRAINT clients_pkey PRIMARY KEY (client_id)
);
CREATE TABLE public.quote_requests (
  quote_request_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  client_id integer,
  place_of_pickup_id integer,
  place_of_delivery_id integer,
  cargo_type USER-DEFINED NOT NULL,
  container_type USER-DEFINED DEFAULT '20ft'::container_type_enum,
  weight numeric,
  cargo_description text NOT NULL,
  payment_terms USER-DEFINED NOT NULL,
  is_last_day_of_port_storage boolean DEFAULT false,
  proposed_rate numeric,
  quotation_date date,
  request_status USER-DEFINED DEFAULT 'Pending'::request_status_enum,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  expiry_date date,
  created_by integer,
  client_name character varying NOT NULL DEFAULT ''::character varying,
  contact_number character varying,
  contact_email character varying,
  pickup_location_text character varying NOT NULL DEFAULT ''::character varying,
  delivery_location_text character varying NOT NULL DEFAULT ''::character varying,
  preferred_pickup_date date,
  CONSTRAINT quote_requests_pkey PRIMARY KEY (quote_request_id),
  CONSTRAINT quote_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id)
);
CREATE TABLE public.employees (
  employee_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_code character varying NOT NULL UNIQUE,
  first_name character varying NOT NULL,
  middle_name character varying,
  last_name character varying NOT NULL,
  full_name character varying NOT NULL,
  date_of_birth date,
  gender USER-DEFINED,
  civil_status USER-DEFINED,
  tin_number character varying,
  position USER-DEFINED NOT NULL,
  rate_type USER-DEFINED NOT NULL,
  daily_rate numeric,
  commission_per_trip numeric,
  monthly_salary numeric,
  hourly_rate numeric,
  phone_number character varying,
  email character varying,
  address text,
  city character varying,
  province character varying,
  zip_code character varying,
  emergency_contact_name character varying,
  emergency_contact_number character varying,
  employment_status_id integer DEFAULT 1,
  hire_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UID uuid,
  CONSTRAINT employees_pkey PRIMARY KEY (employee_id),
  CONSTRAINT employees_UID_fkey FOREIGN KEY (UID) REFERENCES auth.users(id)
);
CREATE TABLE public.users (
  user_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  username character varying NOT NULL UNIQUE,
  email character varying NOT NULL UNIQUE,
  password_hash character varying NOT NULL,
  employee_id integer UNIQUE,
  user_role USER-DEFINED NOT NULL,
  is_active boolean DEFAULT true,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  auth_user_id uuid UNIQUE,
  client_id integer UNIQUE,
  CONSTRAINT users_pkey PRIMARY KEY (user_id),
  CONSTRAINT users_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id),
  CONSTRAINT users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id),
  CONSTRAINT users_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(client_id)
);
