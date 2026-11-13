-- Reference copy of the live Supabase database schema, 2026-11-13.
-- For looking up exact table / column names, NOT for running.
-- Source of truth is the live Supabase project. The full schema (functions,
-- triggers, RLS policies, grants, storage) is in
-- supabase/migrations/20261113000000_baseline_live_schema.sql.
-- 53 tables, 65 enum types, 77 functions, 173 RLS policies.

-- ===== Tables (alphabetical) =====

CREATE TABLE public.app_settings (
  setting_key text NOT NULL,
  label text NOT NULL,
  setting_value numeric NOT NULL,
  unit text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (setting_key);

CREATE TABLE public.bill_payments (
  bill_payment_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  bill_id integer NOT NULL,
  amount numeric NOT NULL,
  paid_on date DEFAULT ((now() AT TIME ZONE 'Asia/Manila'::text))::date NOT NULL,
  method text DEFAULT 'Cash'::text NOT NULL,
  reference_no text,
  note text,
  recorded_by integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  voided_at timestamp with time zone,
  voided_by integer,
  void_reason text
);
ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_check CHECK (((voided_at IS NULL) OR (void_reason IS NOT NULL)));
ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_method_check CHECK ((method = ANY (ARRAY['Cash'::text, 'Bank Transfer'::text, 'GCash'::text, 'Check'::text, 'Other'::text])));
ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_pkey PRIMARY KEY (bill_payment_id);
ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES bills(bill_id);
CREATE INDEX bill_payments_bill_idx ON public.bill_payments USING btree (bill_id);

CREATE TABLE public.bills (
  bill_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  creditor_id integer,
  category text NOT NULL,
  description text NOT NULL,
  bill_date date DEFAULT ((now() AT TIME ZONE 'Asia/Manila'::text))::date NOT NULL,
  due_date date,
  amount numeric NOT NULL,
  amount_paid numeric DEFAULT 0 NOT NULL,
  reference_no text,
  note text,
  created_by integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  voided_at timestamp with time zone,
  voided_by integer,
  void_reason text
);
ALTER TABLE public.bills ADD CONSTRAINT bills_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE public.bills ADD CONSTRAINT bills_category_check CHECK ((category = ANY (ARRAY['Fuel'::text, 'Parts'::text, 'Utilities'::text, 'Rent'::text, 'Permits & Registration'::text, 'Insurance'::text, 'Tolls'::text, 'Office'::text, 'Other'::text])));
ALTER TABLE public.bills ADD CONSTRAINT bills_check CHECK (((due_date IS NULL) OR (due_date >= bill_date)));
ALTER TABLE public.bills ADD CONSTRAINT bills_check1 CHECK (((voided_at IS NULL) OR (void_reason IS NOT NULL)));
ALTER TABLE public.bills ADD CONSTRAINT bills_description_check CHECK ((TRIM(BOTH FROM description) <> ''::text));
ALTER TABLE public.bills ADD CONSTRAINT bills_pkey PRIMARY KEY (bill_id);
ALTER TABLE public.bills ADD CONSTRAINT bills_creditor_id_fkey FOREIGN KEY (creditor_id) REFERENCES creditors(creditor_id);
CREATE INDEX bills_bill_date_idx ON public.bills USING btree (bill_date);

CREATE TABLE public.booking_charges (
  charge_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  booking_id integer NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  created_by integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  voided_at timestamp with time zone,
  voided_by integer,
  void_reason text
);
ALTER TABLE public.booking_charges ADD CONSTRAINT booking_charges_amount_check CHECK ((amount > (0)::numeric));
ALTER TABLE public.booking_charges ADD CONSTRAINT booking_charges_description_check CHECK ((length(TRIM(BOTH FROM description)) > 0));
ALTER TABLE public.booking_charges ADD CONSTRAINT booking_charges_pkey PRIMARY KEY (charge_id);
ALTER TABLE public.booking_charges ADD CONSTRAINT booking_charges_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(booking_id);
CREATE INDEX booking_charges_booking_idx ON public.booking_charges USING btree (booking_id);

CREATE TABLE public.booking_payments (
  payment_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  booking_id integer NOT NULL,
  amount numeric NOT NULL,
  paid_on date DEFAULT ((now() AT TIME ZONE 'Asia/Manila'::text))::date NOT NULL,
  method text DEFAULT 'Cash'::text NOT NULL,
  reference_no text,
  or_number text,
  note text,
  recorded_by integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  voided_at timestamp with time zone,
  voided_by integer,
  void_reason text,
  proof_path text
);
ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_amount_check CHECK ((amount <> (0)::numeric));
ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_check CHECK (((method = 'Refund'::text) = (amount < (0)::numeric)));
ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_check1 CHECK (((voided_at IS NULL) OR (void_reason IS NOT NULL)));
ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_method_check CHECK ((method = ANY (ARRAY['Cash'::text, 'Bank Transfer'::text, 'GCash'::text, 'Check'::text, 'Other'::text, 'Refund'::text])));
ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_reference_required CHECK (((method <> ALL (ARRAY['GCash'::text, 'Bank Transfer'::text, 'Check'::text])) OR (NULLIF(btrim(reference_no), ''::text) IS NOT NULL))) NOT VALID;
ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_pkey PRIMARY KEY (payment_id);
ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(booking_id);
CREATE INDEX booking_payments_booking_idx ON public.booking_payments USING btree (booking_id);
CREATE INDEX booking_payments_paid_on_idx ON public.booking_payments USING btree (paid_on);

CREATE TABLE public.bookings (
  booking_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  quote_request_id integer,
  client_id integer NOT NULL,
  booking_date date NOT NULL,
  place_of_pickup_id integer NOT NULL,
  place_of_delivery_id integer NOT NULL,
  cargo_type text,
  container_type text,
  weight numeric,
  weight_unit text,
  cargo_description text,
  payment_terms text NOT NULL,
  is_last_day_of_port_storage boolean DEFAULT false,
  estimated_distance_km numeric NOT NULL,
  rate_of_delivery_service numeric,
  estimated_fuel_cost numeric,
  booking_status text DEFAULT 'Draft'::text,
  amount_to_pay numeric,
  amount_paid numeric DEFAULT 0,
  balance_due numeric,
  initial_payment_received numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  confirmed_at timestamp with time zone,
  notes text,
  pickup_address_detail text,
  delivery_address_detail text,
  pickup_lat double precision,
  pickup_lng double precision,
  delivery_lat double precision,
  delivery_lng double precision,
  cancellation_reason text,
  cancelled_at timestamp with time zone,
  trailer_type text,
  invoice_number text,
  hours_per_trip numeric,
  cost_per_trip numeric,
  downpayment_waived_at timestamp with time zone,
  downpayment_waived_by integer,
  downpayment_waive_reason text,
  storage_deadline date,
  pickup_landmark text,
  delivery_landmark text
);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_cost_per_trip_check CHECK ((cost_per_trip >= (0)::numeric));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_delivery_pin_pair CHECK (((delivery_lat IS NULL) = (delivery_lng IS NULL)));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_hours_per_trip_check CHECK (((hours_per_trip > (0)::numeric) AND (hours_per_trip <= (72)::numeric)));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pickup_pin_pair CHECK (((pickup_lat IS NULL) = (pickup_lng IS NULL)));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_trailer_type_check CHECK ((trailer_type = ANY (ARRAY['Flatbed'::text, 'Skeletal'::text])));
ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (booking_id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_place_of_delivery_id_fkey FOREIGN KEY (place_of_delivery_id) REFERENCES places(place_id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_place_of_pickup_id_fkey FOREIGN KEY (place_of_pickup_id) REFERENCES places(place_id);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_quote_request_id_fkey FOREIGN KEY (quote_request_id) REFERENCES quote_requests(quote_request_id);

CREATE TABLE public.cash_advances (
  cash_advance_id integer DEFAULT nextval('cash_advances_cash_advance_id_seq'::regclass) NOT NULL,
  employee_id integer NOT NULL,
  amount numeric NOT NULL,
  issued_at date DEFAULT CURRENT_DATE NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  status text DEFAULT 'Approved'::text NOT NULL,
  approved_by integer,
  approved_at timestamp with time zone,
  rejection_reason text
);
ALTER TABLE public.cash_advances ADD CONSTRAINT cash_advances_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])));
ALTER TABLE public.cash_advances ADD CONSTRAINT cash_advances_pkey PRIMARY KEY (cash_advance_id);
ALTER TABLE public.cash_advances ADD CONSTRAINT cash_advances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

CREATE TABLE public.client_delinquency_log (
  log_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  client_id integer NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  changed_by_employee_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.client_delinquency_log ADD CONSTRAINT client_delinquency_log_action_check CHECK ((action = ANY (ARRAY['Marked'::text, 'Unmarked'::text])));
ALTER TABLE public.client_delinquency_log ADD CONSTRAINT client_delinquency_log_pkey PRIMARY KEY (log_id);
ALTER TABLE public.client_delinquency_log ADD CONSTRAINT client_delinquency_log_changed_by_employee_id_fkey FOREIGN KEY (changed_by_employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.client_delinquency_log ADD CONSTRAINT client_delinquency_log_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);

CREATE TABLE public.client_reviews (
  review_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  client_id integer NOT NULL,
  rating integer NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_featured boolean DEFAULT false NOT NULL
);
ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_pkey PRIMARY KEY (review_id);
ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_client_id_key UNIQUE (client_id);
ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);

CREATE TABLE public.client_status_requests (
  request_id integer DEFAULT nextval('client_status_requests_request_id_seq'::regclass) NOT NULL,
  client_id integer NOT NULL,
  booking_id integer NOT NULL,
  itinerary_id integer,
  message text NOT NULL,
  status text DEFAULT 'Pending'::text NOT NULL,
  staff_response text,
  responded_by integer,
  responded_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Responded'::text])));
ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_pkey PRIMARY KEY (request_id);
ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(booking_id);
ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);
ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);
ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES employees(employee_id);

CREATE TABLE public.clients (
  client_id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  client_name character varying(255) NOT NULL,
  contact_person character varying(255),
  email character varying(255),
  phone_number character varying(20),
  address text,
  payment_terms_preference payment_terms_enum DEFAULT 'Cash'::payment_terms_enum,
  credit_limit numeric(10,2),
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  notes text,
  deactivated_at timestamp with time zone,
  deactivated_by integer,
  deactivation_reason text
);
ALTER TABLE public.clients ADD CONSTRAINT clients_phone_ph CHECK (((phone_number)::text ~ '^09[0-9]{9}$'::text)) NOT VALID;
ALTER TABLE public.clients ADD CONSTRAINT clients_pkey PRIMARY KEY (client_id);
ALTER TABLE public.clients ADD CONSTRAINT clients_email_key UNIQUE (email);
CREATE INDEX idx_clients_client_name ON public.clients USING btree (client_name);
CREATE INDEX idx_clients_is_active ON public.clients USING btree (is_active);

CREATE TABLE public.creditors (
  creditor_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  creditor_name text NOT NULL,
  contact_person text,
  phone text,
  tin_number text,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.creditors ADD CONSTRAINT creditors_creditor_name_check CHECK ((TRIM(BOTH FROM creditor_name) <> ''::text));
ALTER TABLE public.creditors ADD CONSTRAINT creditors_pkey PRIMARY KEY (creditor_id);
CREATE UNIQUE INDEX creditors_name_key ON public.creditors USING btree (lower(TRIM(BOTH FROM creditor_name)));

CREATE TABLE public.delivery_damage_records (
  damage_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  damage_description text NOT NULL,
  estimated_damage_cost numeric,
  photos_of_damage character varying,
  charge_to text DEFAULT 'Client'::text,
  damage_status text DEFAULT 'Reported'::text,
  approved_at timestamp with time zone,
  approved_by integer,
  created_at timestamp with time zone DEFAULT now(),
  itinerary_id integer NOT NULL,
  insurance_company_id bigint,
  insurance_covered_amount numeric(12,2),
  claim_status text,
  claim_reference text
);
ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_charge_to_check CHECK ((charge_to = ANY (ARRAY['Client'::text, 'Company'::text, 'Insurance'::text]))) NOT VALID;
ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_claim_status_check CHECK (((claim_status IS NULL) OR (claim_status = ANY (ARRAY['Filed'::text, 'Paid'::text, 'Denied'::text]))));
ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_covered_check CHECK (((insurance_covered_amount IS NULL) OR ((insurance_covered_amount >= (0)::numeric) AND (insurance_covered_amount <= estimated_damage_cost))));
ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_insurance_complete CHECK (((charge_to IS DISTINCT FROM 'Insurance'::text) OR ((insurance_company_id IS NOT NULL) AND (insurance_covered_amount IS NOT NULL) AND (claim_status IS NOT NULL))));
ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_pkey PRIMARY KEY (damage_id);
ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_insurance_company_id_fkey FOREIGN KEY (insurance_company_id) REFERENCES insurance_companies(insurance_company_id) ON DELETE RESTRICT;
ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

CREATE TABLE public.dispatch_status_logs (
  log_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  previous_status text,
  new_status text NOT NULL,
  status_changed_at timestamp with time zone DEFAULT now(),
  changed_by integer,
  location character varying,
  additional_notes text
);
ALTER TABLE public.dispatch_status_logs ADD CONSTRAINT dispatch_status_logs_pkey PRIMARY KEY (log_id);
ALTER TABLE public.dispatch_status_logs ADD CONSTRAINT dispatch_status_logs_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);
CREATE INDEX dispatch_status_logs_itinerary_id_idx ON public.dispatch_status_logs USING btree (itinerary_id);
CREATE INDEX dispatch_status_logs_status_time_idx ON public.dispatch_status_logs USING btree (new_status, status_changed_at);

CREATE TABLE public.employee_attendance (
  attendance_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_id integer NOT NULL,
  attendance_date date NOT NULL,
  attendance_status text DEFAULT 'Present'::text NOT NULL,
  hours_worked numeric,
  notes text,
  recorded_by integer,
  created_at timestamp with time zone DEFAULT now(),
  paid_payroll_id integer,
  time_in time without time zone,
  time_out time without time zone
);
ALTER TABLE public.employee_attendance ADD CONSTRAINT employee_attendance_status_check CHECK ((attendance_status = ANY (ARRAY['Present'::text, 'Leave'::text, 'Unpaid Leave'::text, 'Absent'::text])));
ALTER TABLE public.employee_attendance ADD CONSTRAINT employee_attendance_pkey PRIMARY KEY (attendance_id);
ALTER TABLE public.employee_attendance ADD CONSTRAINT employee_attendance_employee_date_key UNIQUE (employee_id, attendance_date);
ALTER TABLE public.employee_attendance ADD CONSTRAINT employee_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
CREATE INDEX employee_attendance_date_idx ON public.employee_attendance USING btree (attendance_date);

CREATE TABLE public.employees (
  employee_id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  first_name character varying(100) NOT NULL,
  middle_name character varying(100),
  last_name character varying(100) NOT NULL,
  full_name character varying(255) NOT NULL,
  date_of_birth date,
  gender employee_gender_enum,
  civil_status employee_civil_status_enum,
  tin_number character varying(20),
  "position" employee_position_enum NOT NULL,
  rate_type employee_rate_type_enum NOT NULL,
  daily_rate numeric(10,2),
  commission_per_trip numeric(10,2),
  monthly_salary numeric(10,2),
  hourly_rate numeric(10,2),
  phone_number character varying(20),
  email character varying(255),
  address text,
  city character varying(100),
  province character varying(100),
  zip_code character varying(10),
  emergency_contact_name character varying(255),
  emergency_contact_number character varying(20),
  employment_status_id integer DEFAULT 1,
  hire_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  "UID" uuid,
  driver_license_number character varying,
  driver_license_expiry_date date,
  commission_basis text,
  weekly_salary numeric,
  is_minimum_wage_earner boolean DEFAULT false NOT NULL,
  sss_number character varying,
  philhealth_number character varying,
  pagibig_number character varying,
  assigned_plate_number character varying
);
ALTER TABLE public.employees ADD CONSTRAINT employees_commission_basis_check CHECK ((commission_basis = ANY (ARRAY['Flat Fee'::text, 'Percentage'::text])));
ALTER TABLE public.employees ADD CONSTRAINT employees_phone_ph CHECK (((phone_number)::text ~ '^09[0-9]{9}$'::text)) NOT VALID;
ALTER TABLE public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (employee_id);
ALTER TABLE public.employees ADD CONSTRAINT employees_assigned_plate_number_key UNIQUE (assigned_plate_number);
ALTER TABLE public.employees ADD CONSTRAINT "employees_UID_fkey" FOREIGN KEY ("UID") REFERENCES auth.users(id);
ALTER TABLE public.employees ADD CONSTRAINT employees_assigned_plate_number_fkey FOREIGN KEY (assigned_plate_number) REFERENCES truck_profiles(plate_number) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX idx_employees_employment_status_id ON public.employees USING btree (employment_status_id);
CREATE INDEX idx_employees_full_name ON public.employees USING btree (full_name);
CREATE INDEX idx_employees_position ON public.employees USING btree ("position");

CREATE TABLE public.employment_status (
  status_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  status_name text NOT NULL,
  description text
);
ALTER TABLE public.employment_status ADD CONSTRAINT employment_status_pkey PRIMARY KEY (status_id);
ALTER TABLE public.employment_status ADD CONSTRAINT employment_status_status_name_key UNIQUE (status_name);

CREATE TABLE public.insurance_companies (
  insurance_company_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  company_name text NOT NULL,
  policy_number text NOT NULL,
  amount_insured numeric(14,2) NOT NULL,
  limit_type text DEFAULT 'Total'::text NOT NULL,
  valid_from date DEFAULT CURRENT_DATE NOT NULL,
  valid_until date DEFAULT ((CURRENT_DATE + '1 year'::interval))::date NOT NULL,
  note text,
  archived_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_amount_insured_check CHECK ((amount_insured > (0)::numeric));
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_company_name_check CHECK ((btrim(company_name) <> ''::text));
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_dates CHECK ((valid_until >= valid_from));
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_limit_type_check CHECK ((limit_type = ANY (ARRAY['Total'::text, 'PerClaim'::text])));
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_policy_number_check CHECK ((btrim(policy_number) <> ''::text));
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_pkey PRIMARY KEY (insurance_company_id);
CREATE UNIQUE INDEX insurance_companies_policy_unique ON public.insurance_companies USING btree (lower(btrim(company_name)), lower(btrim(policy_number)));

CREATE TABLE public.inventory_items (
  item_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  name character varying NOT NULL,
  item_type text DEFAULT 'Tools'::text NOT NULL,
  quantity numeric(12,2) DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  unit_cost numeric(12,2),
  unit text DEFAULT 'pcs'::text NOT NULL,
  reorder_level numeric(12,2),
  archived_at timestamp with time zone,
  needs_price boolean DEFAULT false NOT NULL
);
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_quantity_check CHECK ((quantity >= (0)::numeric));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_reorder_level_check CHECK ((reorder_level >= (0)::numeric));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_unit_check CHECK ((unit = ANY (ARRAY['pcs'::text, 'L'::text, 'kg'::text, 'm'::text, 'set'::text])));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_unit_cost_check CHECK ((unit_cost >= (0)::numeric));
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (item_id);
CREATE UNIQUE INDEX inventory_items_name_unique ON public.inventory_items USING btree (lower(regexp_replace(btrim((name)::text), '\s+'::text, ' '::text, 'g'::text)));

CREATE TABLE public.inventory_lots (
  lot_id integer DEFAULT nextval('inventory_lots_lot_id_seq'::regclass) NOT NULL,
  item_id integer NOT NULL,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  unit_cost numeric(12,2),
  qty_received numeric(12,2) NOT NULL,
  qty_remaining numeric(12,2) NOT NULL,
  note text,
  employee_id integer,
  created_by uuid DEFAULT auth.uid()
);
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_check CHECK (((qty_remaining >= (0)::numeric) AND (qty_remaining <= qty_received)));
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_qty_received_check CHECK ((qty_received > (0)::numeric));
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_unit_cost_check CHECK ((unit_cost >= (0)::numeric));
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_pkey PRIMARY KEY (lot_id);
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);
CREATE INDEX inventory_lots_open_idx ON public.inventory_lots USING btree (item_id, received_at, lot_id) WHERE (qty_remaining > (0)::numeric);

CREATE TABLE public.inventory_movements (
  movement_id integer DEFAULT nextval('inventory_movements_movement_id_seq'::regclass) NOT NULL,
  item_id integer NOT NULL,
  lot_id integer,
  qty_change numeric(12,2) NOT NULL,
  reason text NOT NULL,
  unit_cost numeric(12,2),
  work_order_id integer,
  log_id integer,
  completion_id integer,
  note text,
  employee_id integer,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_qty_change_check CHECK ((qty_change <> (0)::numeric));
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_reason_check CHECK ((reason = ANY (ARRAY['opening'::text, 'receive'::text, 'use'::text, 'return'::text, 'adjust'::text, 'write_off'::text, 'count'::text])));
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (movement_id);
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_completion_id_fkey FOREIGN KEY (completion_id) REFERENCES work_order_completions(completion_id);
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_log_id_fkey FOREIGN KEY (log_id) REFERENCES work_order_parts_log(log_id) ON DELETE SET NULL;
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lots(lot_id);
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);
CREATE INDEX inventory_movements_item_idx ON public.inventory_movements USING btree (item_id, created_at);
CREATE INDEX inventory_movements_log_idx ON public.inventory_movements USING btree (log_id);
CREATE INDEX inventory_movements_lot_idx ON public.inventory_movements USING btree (lot_id);
CREATE INDEX inventory_movements_work_order_idx ON public.inventory_movements USING btree (work_order_id);

CREATE TABLE public.issue_reports (
  issue_report_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_id integer NOT NULL,
  itinerary_id integer,
  description text NOT NULL,
  severity text DEFAULT 'Minor'::text NOT NULL,
  notes text,
  reported_at timestamp with time zone DEFAULT now(),
  worked_on boolean,
  plate_number text,
  trailer_id integer
);
ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_pkey PRIMARY KEY (issue_report_id);
ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

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
  itinerary_status text DEFAULT 'Awaiting'::text,
  trip_distance numeric,
  estimated_fuel_cost numeric,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  plate_number character varying,
  trailer_id integer,
  trip_start_at timestamp with time zone,
  trip_end_at timestamp with time zone,
  cargo_type text,
  cargo_description text,
  weight numeric,
  container_type text,
  trailer_type text,
  trip_rate numeric(12,2),
  exact_trailer_size boolean DEFAULT false NOT NULL
);
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_cargo_type_check CHECK (((cargo_type IS NULL) OR (cargo_type = ANY (ARRAY['Container'::text, 'Loose'::text])))) NOT VALID;
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_container_type_check CHECK (((container_type IS NULL) OR (container_type = ANY (ARRAY['20ft'::text, '40ft'::text])))) NOT VALID;
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_loose_on_flatbed CHECK (((cargo_type IS DISTINCT FROM 'Loose'::text) OR (trailer_type = 'Flatbed'::text))) NOT VALID;
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_trailer_type_check CHECK (((trailer_type IS NULL) OR (trailer_type = ANY (ARRAY['Flatbed'::text, 'Skeletal'::text])))) NOT VALID;
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_weight_check CHECK (((weight IS NULL) OR ((weight > (0)::numeric) AND (weight <= (45)::numeric)))) NOT VALID;
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_pkey PRIMARY KEY (itinerary_id);
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(booking_id);
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_place_of_delivery_id_fkey FOREIGN KEY (place_of_delivery_id) REFERENCES places(place_id);
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_place_of_pickup_id_fkey FOREIGN KEY (place_of_pickup_id) REFERENCES places(place_id);
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number);
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_trailer_id_fkey FOREIGN KEY (trailer_id) REFERENCES trailers(trailer_id);

CREATE TABLE public.itinerary_crews (
  itinerary_crew_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  employee_id integer NOT NULL,
  crew_role text NOT NULL,
  assigned_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  completed_at timestamp with time zone
);
ALTER TABLE public.itinerary_crews ADD CONSTRAINT itinerary_crews_pkey PRIMARY KEY (itinerary_crew_id);
ALTER TABLE public.itinerary_crews ADD CONSTRAINT itinerary_crews_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);
CREATE INDEX itinerary_crews_employee_id_idx ON public.itinerary_crews USING btree (employee_id);
CREATE INDEX itinerary_crews_itinerary_id_idx ON public.itinerary_crews USING btree (itinerary_id);

CREATE TABLE public.itinerary_documents (
  document_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  uploaded_by integer,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.itinerary_documents ADD CONSTRAINT itinerary_documents_pkey PRIMARY KEY (document_id);
ALTER TABLE public.itinerary_documents ADD CONSTRAINT itinerary_documents_file_path_key UNIQUE (file_path);
ALTER TABLE public.itinerary_documents ADD CONSTRAINT itinerary_documents_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id) ON DELETE CASCADE;
CREATE INDEX itinerary_documents_itinerary_id_idx ON public.itinerary_documents USING btree (itinerary_id);

CREATE TABLE public.itinerary_expenses (
  expense_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  employee_id integer NOT NULL,
  amount numeric NOT NULL,
  description text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  category text DEFAULT 'Other'::text NOT NULL
);
ALTER TABLE public.itinerary_expenses ADD CONSTRAINT itinerary_expenses_category_check CHECK ((category = ANY (ARRAY['Fuel'::text, 'Toll'::text, 'Parking'::text, 'Other'::text])));
ALTER TABLE public.itinerary_expenses ADD CONSTRAINT itinerary_expenses_pkey PRIMARY KEY (expense_id);
ALTER TABLE public.itinerary_expenses ADD CONSTRAINT itinerary_expenses_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.itinerary_expenses ADD CONSTRAINT itinerary_expenses_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

CREATE TABLE public.itinerary_schedule_logs (
  log_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  old_start timestamp with time zone,
  old_end timestamp with time zone,
  new_start timestamp with time zone,
  new_end timestamp with time zone,
  changed_by integer,
  changed_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.itinerary_schedule_logs ADD CONSTRAINT itinerary_schedule_logs_pkey PRIMARY KEY (log_id);
ALTER TABLE public.itinerary_schedule_logs ADD CONSTRAINT itinerary_schedule_logs_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

CREATE TABLE public.leave_requests (
  leave_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_id integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  leave_type text DEFAULT 'Vacation'::text NOT NULL,
  reason text,
  status text DEFAULT 'Pending'::text NOT NULL,
  decided_by integer,
  decided_at timestamp with time zone,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_check CHECK ((end_date >= start_date));
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_leave_type_check CHECK ((leave_type = ANY (ARRAY['Vacation'::text, 'Sick'::text, 'Emergency'::text, 'Other'::text])));
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])));
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (leave_id);
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES employees(employee_id);
ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
CREATE INDEX leave_requests_employee_idx ON public.leave_requests USING btree (employee_id, status);

CREATE TABLE public.location_reference (
  location_ref_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  province character varying,
  city character varying NOT NULL,
  barangay character varying NOT NULL
);
ALTER TABLE public.location_reference ADD CONSTRAINT location_reference_pkey PRIMARY KEY (location_ref_id);
ALTER TABLE public.location_reference ADD CONSTRAINT location_reference_city_barangay_key UNIQUE (city, barangay);

CREATE TABLE public.maintenance_requests (
  request_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  plate_number character varying,
  trailer_id integer,
  requested_by_employee_id integer NOT NULL,
  maintenance_type text NOT NULL,
  description text NOT NULL,
  status text DEFAULT 'Pending'::text NOT NULL,
  resolved_by_employee_id integer,
  rejection_reason text,
  resolved_at timestamp with time zone,
  work_order_id integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_one_vehicle CHECK ((((plate_number IS NOT NULL) AND (trailer_id IS NULL)) OR ((plate_number IS NULL) AND (trailer_id IS NOT NULL))));
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])));
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_pkey PRIMARY KEY (request_id);
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number);
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_requested_by_employee_id_fkey FOREIGN KEY (requested_by_employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_resolved_by_employee_id_fkey FOREIGN KEY (resolved_by_employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_trailer_id_fkey FOREIGN KEY (trailer_id) REFERENCES trailers(trailer_id);
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

CREATE TABLE public.maintenance_schedules (
  schedule_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  plate_number character varying,
  trailer_id integer,
  reported_by_employee_id integer NOT NULL,
  maintenance_type text NOT NULL,
  notes text,
  due_date date NOT NULL,
  status text DEFAULT 'Pending'::text NOT NULL,
  completed_by_employee_id integer,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_one_vehicle CHECK ((((plate_number IS NOT NULL) AND (trailer_id IS NULL)) OR ((plate_number IS NULL) AND (trailer_id IS NOT NULL))));
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Completed'::text])));
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_pkey PRIMARY KEY (schedule_id);
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_completed_by_employee_id_fkey FOREIGN KEY (completed_by_employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number);
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_reported_by_employee_id_fkey FOREIGN KEY (reported_by_employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_trailer_id_fkey FOREIGN KEY (trailer_id) REFERENCES trailers(trailer_id);

CREATE TABLE public.named_locations (
  named_location_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  abbreviation character varying NOT NULL,
  full_name character varying NOT NULL,
  city character varying NOT NULL,
  barangay character varying NOT NULL,
  landmark_detail text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.named_locations ADD CONSTRAINT named_locations_pkey PRIMARY KEY (named_location_id);
ALTER TABLE public.named_locations ADD CONSTRAINT named_locations_abbreviation_key UNIQUE (abbreviation);
ALTER TABLE public.named_locations ADD CONSTRAINT named_locations_city_barangay_fkey FOREIGN KEY (city, barangay) REFERENCES location_reference(city, barangay);

CREATE TABLE public.notifications (
  notification_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_id integer NOT NULL,
  kind text NOT NULL,
  itinerary_id integer,
  created_at timestamp with time zone DEFAULT now(),
  read_at timestamp with time zone
);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK ((kind = ANY (ARRAY['assigned'::text, 'removed'::text, 'rescheduled'::text])));
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (notification_id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);
CREATE INDEX notifications_employee_created_idx ON public.notifications USING btree (employee_id, created_at DESC);

CREATE TABLE public.parts_requests (
  request_id integer DEFAULT nextval('parts_requests_request_id_seq'::regclass) NOT NULL,
  item_id integer NOT NULL,
  work_order_id integer,
  employee_id integer NOT NULL,
  note text,
  status text DEFAULT 'Open'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  resolved_by integer,
  resolution_note text
);
ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_status_check CHECK ((status = ANY (ARRAY['Open'::text, 'Done'::text])));
ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_pkey PRIMARY KEY (request_id);
ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);
ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES employees(employee_id);
ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);
CREATE UNIQUE INDEX parts_requests_one_open_per_item ON public.parts_requests USING btree (item_id) WHERE (status = 'Open'::text);

CREATE TABLE public.payroll_payslips (
  payroll_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_id integer NOT NULL,
  payroll_period_start date NOT NULL,
  payroll_period_end date NOT NULL,
  gross_pay numeric NOT NULL,
  payslip_status text DEFAULT 'Pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  base_pay numeric DEFAULT 0 NOT NULL,
  allowance_amount numeric DEFAULT 0 NOT NULL,
  cash_advance_deducted numeric DEFAULT 0 NOT NULL,
  net_pay numeric DEFAULT 0 NOT NULL,
  sss_msc numeric DEFAULT 0 NOT NULL,
  sss_ee numeric DEFAULT 0 NOT NULL,
  sss_er numeric DEFAULT 0 NOT NULL,
  sss_ec numeric DEFAULT 0 NOT NULL,
  philhealth_ee numeric DEFAULT 0 NOT NULL,
  philhealth_er numeric DEFAULT 0 NOT NULL,
  pagibig_ee numeric DEFAULT 0 NOT NULL,
  pagibig_er numeric DEFAULT 0 NOT NULL,
  withholding_tax numeric DEFAULT 0 NOT NULL,
  deductions_note text,
  finalized_at timestamp with time zone,
  on_hold boolean DEFAULT false NOT NULL
);
ALTER TABLE public.payroll_payslips ADD CONSTRAINT payroll_payslips_pkey PRIMARY KEY (payroll_id);
ALTER TABLE public.payroll_payslips ADD CONSTRAINT payroll_payslips_employee_period_key UNIQUE (employee_id, payroll_period_start, payroll_period_end);
ALTER TABLE public.payroll_payslips ADD CONSTRAINT payroll_payslips_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
CREATE INDEX payroll_payslips_period_idx ON public.payroll_payslips USING btree (payroll_period_start DESC, payroll_id DESC);

CREATE TABLE public.payslip_issue_reports (
  report_id integer DEFAULT nextval('payslip_issue_reports_report_id_seq'::regclass) NOT NULL,
  payroll_id integer NOT NULL,
  employee_id integer NOT NULL,
  description text NOT NULL,
  status text DEFAULT 'Pending'::text NOT NULL,
  resolution_note text,
  resolved_by integer,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Resolved'::text])));
ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_pkey PRIMARY KEY (report_id);
ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_payroll_id_fkey FOREIGN KEY (payroll_id) REFERENCES payroll_payslips(payroll_id);
ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES employees(employee_id);

CREATE TABLE public.payslip_line_items (
  payslip_line_item_id integer DEFAULT nextval('payslip_line_items_payslip_line_item_id_seq'::regclass) NOT NULL,
  payroll_id integer NOT NULL,
  itinerary_id integer,
  description text NOT NULL,
  amount numeric NOT NULL
);
ALTER TABLE public.payslip_line_items ADD CONSTRAINT payslip_line_items_pkey PRIMARY KEY (payslip_line_item_id);
ALTER TABLE public.payslip_line_items ADD CONSTRAINT payslip_line_items_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);
ALTER TABLE public.payslip_line_items ADD CONSTRAINT payslip_line_items_payroll_id_fkey FOREIGN KEY (payroll_id) REFERENCES payroll_payslips(payroll_id) ON DELETE CASCADE;
CREATE INDEX payslip_line_items_itinerary_id_idx ON public.payslip_line_items USING btree (itinerary_id);
CREATE INDEX payslip_line_items_payroll_id_idx ON public.payslip_line_items USING btree (payroll_id);

CREATE TABLE public.places (
  place_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  place_name character varying NOT NULL,
  city character varying,
  province character varying,
  country character varying DEFAULT 'Philippines'::character varying,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  barangay character varying
);
ALTER TABLE public.places ADD CONSTRAINT places_pkey PRIMARY KEY (place_id);
CREATE UNIQUE INDEX places_city_barangay_unique_idx ON public.places USING btree (lower(TRIM(BOTH FROM city)), lower(TRIM(BOTH FROM barangay))) WHERE ((city IS NOT NULL) AND (barangay IS NOT NULL));

CREATE TABLE public.quote_rate_offers (
  offer_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  quote_request_id bigint NOT NULL,
  party text NOT NULL,
  action text NOT NULL,
  rate numeric,
  pickup_date date,
  deadline_date date,
  note text,
  entered_by_staff boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  line_rates jsonb
);
ALTER TABLE public.quote_rate_offers ADD CONSTRAINT quote_rate_offers_action_check CHECK ((action = ANY (ARRAY['Offer'::text, 'Counter'::text, 'Accept'::text, 'Decline'::text])));
ALTER TABLE public.quote_rate_offers ADD CONSTRAINT quote_rate_offers_party_check CHECK ((party = ANY (ARRAY['Business'::text, 'Client'::text])));
ALTER TABLE public.quote_rate_offers ADD CONSTRAINT quote_rate_offers_pkey PRIMARY KEY (offer_id);
ALTER TABLE public.quote_rate_offers ADD CONSTRAINT quote_rate_offers_quote_request_id_fkey FOREIGN KEY (quote_request_id) REFERENCES quote_requests(quote_request_id);
CREATE INDEX quote_rate_offers_quote_idx ON public.quote_rate_offers USING btree (quote_request_id, offer_id);

CREATE TABLE public.quote_requests (
  quote_request_id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  client_id integer,
  place_of_pickup_id integer,
  place_of_delivery_id integer,
  cargo_type cargo_type_enum,
  container_type container_type_enum DEFAULT '20ft'::container_type_enum,
  weight numeric(10,2),
  cargo_description text,
  payment_terms payment_terms_enum NOT NULL,
  is_last_day_of_port_storage boolean DEFAULT false,
  proposed_rate numeric(10,2),
  quotation_date date,
  request_status request_status_enum DEFAULT 'Pending'::request_status_enum,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  expiry_date date,
  created_by integer,
  client_name character varying(255) DEFAULT ''::character varying NOT NULL,
  contact_number character varying(20),
  contact_email character varying(255),
  pickup_location_text character varying(255) DEFAULT ''::character varying NOT NULL,
  delivery_location_text character varying(255) DEFAULT ''::character varying NOT NULL,
  preferred_pickup_date date,
  preferred_delivery_date date,
  delivery_order_count integer,
  pickup_city character varying,
  pickup_barangay character varying,
  delivery_city character varying,
  delivery_barangay character varying,
  pickup_lat double precision,
  pickup_lng double precision,
  delivery_lat double precision,
  delivery_lng double precision,
  reference_code text,
  trailer_type text,
  resubmit_count integer DEFAULT 0 NOT NULL,
  previous_rejection_reason text,
  rejection_tag text,
  pickup_landmark text,
  delivery_landmark text,
  cargo_lines jsonb,
  estimated_distance_km numeric,
  hours_per_trip numeric,
  cost_per_trip numeric,
  decline_reason text,
  line_rates jsonb,
  trip_plan jsonb
);
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_cargo_lines_check CHECK (((cargo_lines IS NULL) OR ((jsonb_typeof(cargo_lines) = 'array'::text) AND ((jsonb_array_length(cargo_lines) >= 1) AND (jsonb_array_length(cargo_lines) <= 50)))));
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_delivery_pin_pair CHECK (((delivery_lat IS NULL) = (delivery_lng IS NULL)));
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_phone_ph CHECK (((contact_number)::text ~ '^09[0-9]{9}$'::text)) NOT VALID;
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_pickup_pin_pair CHECK (((pickup_lat IS NULL) = (pickup_lng IS NULL)));
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_rejected_needs_tag CHECK (((request_status <> 'Rejected'::request_status_enum) OR (rejection_tag IS NOT NULL))) NOT VALID;
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_rejection_tag_check CHECK ((rejection_tag = ANY (ARRAY['Rate'::text, 'Weight'::text, 'Schedule'::text, 'Terms'::text, 'Other'::text])));
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_trailer_type_check CHECK ((trailer_type = ANY (ARRAY['Flatbed'::text, 'Skeletal'::text])));
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_pkey PRIMARY KEY (quote_request_id);
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_reference_code_key UNIQUE (reference_code);
ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);
CREATE INDEX idx_quote_requests_client_id ON public.quote_requests USING btree (client_id);
CREATE INDEX idx_quote_requests_quotation_date ON public.quote_requests USING btree (quotation_date);
CREATE INDEX idx_quote_requests_request_status ON public.quote_requests USING btree (request_status);

CREATE TABLE public.route_cache (
  route_cache_id integer DEFAULT nextval('route_cache_route_cache_id_seq'::regclass) NOT NULL,
  place_id_a integer NOT NULL,
  place_id_b integer NOT NULL,
  distance_km numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_ordered_pair CHECK ((place_id_a < place_id_b));
ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_pkey PRIMARY KEY (route_cache_id);
ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_pair_unique UNIQUE (place_id_a, place_id_b);
ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_place_id_a_fkey FOREIGN KEY (place_id_a) REFERENCES places(place_id);
ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_place_id_b_fkey FOREIGN KEY (place_id_b) REFERENCES places(place_id);

CREATE TABLE public.status_relog_requests (
  request_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer,
  work_order_id integer,
  requested_by_employee_id integer NOT NULL,
  current_status text NOT NULL,
  requested_status text NOT NULL,
  reason text NOT NULL,
  status text DEFAULT 'Pending'::text NOT NULL,
  resolved_by_employee_id integer,
  resolution_note text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_one_target CHECK ((((itinerary_id IS NOT NULL) AND (work_order_id IS NULL)) OR ((itinerary_id IS NULL) AND (work_order_id IS NOT NULL))));
ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])));
ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_pkey PRIMARY KEY (request_id);
ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);
ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_requested_by_employee_id_fkey FOREIGN KEY (requested_by_employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_resolved_by_employee_id_fkey FOREIGN KEY (resolved_by_employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

CREATE TABLE public.trailers (
  trailer_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  trailer_type text NOT NULL,
  registration_number character varying,
  registration_expiry_date date,
  current_status text DEFAULT 'Available'::text,
  current_place_id integer,
  last_maintenance_date date,
  next_maintenance_date date,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  plate_number character varying,
  is_active boolean DEFAULT true NOT NULL,
  trailer_size text
);
ALTER TABLE public.trailers ADD CONSTRAINT trailers_trailer_size_check CHECK ((trailer_size = ANY (ARRAY['20ft'::text, '40ft'::text])));
ALTER TABLE public.trailers ADD CONSTRAINT trailers_pkey PRIMARY KEY (trailer_id);
ALTER TABLE public.trailers ADD CONSTRAINT trailers_plate_number_key UNIQUE (plate_number);

CREATE TABLE public.truck_odometer_log (
  log_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  plate_number text NOT NULL,
  source text NOT NULL,
  reading numeric(12,2) NOT NULL,
  km_added numeric(12,2),
  itinerary_id integer,
  out_km numeric(10,2),
  trip_km numeric(10,2),
  back_km numeric(10,2),
  note text,
  recorded_by integer,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_back_km_check CHECK ((back_km >= (0)::numeric));
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_out_km_check CHECK ((out_km >= (0)::numeric));
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_reading_check CHECK ((reading >= (0)::numeric));
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_source_check CHECK ((source = ANY (ARRAY['opening'::text, 'trip'::text, 'reading'::text, 'edit'::text])));
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_trip_km_check CHECK ((trip_km >= (0)::numeric));
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_pkey PRIMARY KEY (log_id);
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES employees(employee_id);
CREATE UNIQUE INDEX truck_odometer_log_one_per_trip ON public.truck_odometer_log USING btree (itinerary_id) WHERE (source = 'trip'::text);
CREATE INDEX truck_odometer_log_plate ON public.truck_odometer_log USING btree (plate_number, recorded_at DESC);

CREATE TABLE public.truck_profiles (
  plate_number character varying NOT NULL,
  model character varying,
  year integer,
  registration_date date,
  registration_expiry_date date,
  insurance_provider character varying,
  insurance_policy_number character varying,
  insurance_expiry_date date,
  current_status text DEFAULT 'Available'::text,
  current_odometer numeric DEFAULT 0,
  last_service_date date,
  next_service_date date,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true NOT NULL,
  last_pms_odometer numeric(12,2)
);
ALTER TABLE public.truck_profiles ADD CONSTRAINT truck_profiles_last_pms_odometer_check CHECK ((last_pms_odometer >= (0)::numeric));
ALTER TABLE public.truck_profiles ADD CONSTRAINT truck_profiles_pkey PRIMARY KEY (plate_number);

CREATE TABLE public.users (
  user_id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  username character varying(100) NOT NULL,
  email character varying(255) NOT NULL,
  password_hash character varying(255),
  user_role user_role_enum NOT NULL,
  is_active boolean DEFAULT true,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  auth_user_id uuid,
  client_id integer,
  employee_id integer
);
ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);
ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);
ALTER TABLE public.users ADD CONSTRAINT users_client_id_key UNIQUE (client_id);
ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE public.users ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
ALTER TABLE public.users ADD CONSTRAINT users_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);
ALTER TABLE public.users ADD CONSTRAINT users_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
CREATE INDEX idx_users_is_active ON public.users USING btree (is_active);
CREATE INDEX idx_users_user_role ON public.users USING btree (user_role);
CREATE UNIQUE INDEX users_username_lower_key ON public.users USING btree (lower(TRIM(BOTH FROM username)));

CREATE TABLE public.work_order_acceptance_log (
  log_id integer DEFAULT nextval('work_order_acceptance_log_log_id_seq'::regclass) NOT NULL,
  work_order_id integer NOT NULL,
  employee_id integer NOT NULL,
  accepted_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.work_order_acceptance_log ADD CONSTRAINT work_order_acceptance_log_pkey PRIMARY KEY (log_id);
ALTER TABLE public.work_order_acceptance_log ADD CONSTRAINT work_order_acceptance_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.work_order_acceptance_log ADD CONSTRAINT work_order_acceptance_log_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

CREATE TABLE public.work_order_completions (
  completion_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  work_order_id integer NOT NULL,
  employee_id integer NOT NULL,
  description text NOT NULL,
  odometer_reading numeric,
  next_service_date date,
  notes text,
  completed_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.work_order_completions ADD CONSTRAINT work_order_completions_pkey PRIMARY KEY (completion_id);
ALTER TABLE public.work_order_completions ADD CONSTRAINT work_order_completions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.work_order_completions ADD CONSTRAINT work_order_completions_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

CREATE TABLE public.work_order_notes (
  note_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  work_order_id integer NOT NULL,
  employee_id integer NOT NULL,
  note text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.work_order_notes ADD CONSTRAINT work_order_notes_pkey PRIMARY KEY (note_id);
ALTER TABLE public.work_order_notes ADD CONSTRAINT work_order_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.work_order_notes ADD CONSTRAINT work_order_notes_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

CREATE TABLE public.work_order_parts_log (
  log_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  work_order_id integer NOT NULL,
  item_id integer NOT NULL,
  item_name_text text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  employee_id integer NOT NULL,
  used_at timestamp with time zone DEFAULT now() NOT NULL,
  unit_cost numeric(12,2),
  completion_id integer
);
ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_quantity_check CHECK ((quantity > (0)::numeric));
ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_unit_cost_check CHECK ((unit_cost >= (0)::numeric));
ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_pkey PRIMARY KEY (log_id);
ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_completion_id_fkey FOREIGN KEY (completion_id) REFERENCES work_order_completions(completion_id);
ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);
ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);
ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);
CREATE INDEX work_order_parts_log_completion_id_idx ON public.work_order_parts_log USING btree (completion_id);
CREATE INDEX work_order_parts_log_item_id_idx ON public.work_order_parts_log USING btree (item_id);
CREATE INDEX work_order_parts_log_work_order_id_idx ON public.work_order_parts_log USING btree (work_order_id);

CREATE TABLE public.work_order_parts_used (
  part_used_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  completion_id integer NOT NULL,
  item_id integer,
  item_name_text character varying,
  quantity numeric DEFAULT 1 NOT NULL,
  unit_cost numeric(12,2)
);
ALTER TABLE public.work_order_parts_used ADD CONSTRAINT work_order_parts_used_unit_cost_check CHECK ((unit_cost >= (0)::numeric));
ALTER TABLE public.work_order_parts_used ADD CONSTRAINT work_order_parts_used_pkey PRIMARY KEY (part_used_id);
ALTER TABLE public.work_order_parts_used ADD CONSTRAINT work_order_parts_used_completion_id_fkey FOREIGN KEY (completion_id) REFERENCES work_order_completions(completion_id);
ALTER TABLE public.work_order_parts_used ADD CONSTRAINT work_order_parts_used_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);
CREATE INDEX work_order_parts_used_completion_id_idx ON public.work_order_parts_used USING btree (completion_id);
CREATE INDEX work_order_parts_used_item_id_idx ON public.work_order_parts_used USING btree (item_id);

CREATE TABLE public.work_order_status_log (
  log_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  work_order_id integer NOT NULL,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  changed_by integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.work_order_status_log ADD CONSTRAINT work_order_status_log_pkey PRIMARY KEY (log_id);
ALTER TABLE public.work_order_status_log ADD CONSTRAINT work_order_status_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES employees(employee_id);
ALTER TABLE public.work_order_status_log ADD CONSTRAINT work_order_status_log_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

CREATE TABLE public.work_orders (
  work_order_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  work_order_number character varying NOT NULL,
  plate_number character varying,
  assigned_mechanic_id integer,
  work_order_status work_order_status_enum DEFAULT 'Created'::work_order_status_enum NOT NULL,
  work_description text,
  scheduled_start_date date,
  created_at timestamp with time zone DEFAULT now(),
  trailer_id integer,
  maintenance_type maintenance_type_enum DEFAULT 'Routine'::maintenance_type_enum NOT NULL,
  pms_target_km numeric(12,2)
);
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_vehicle_check CHECK ((((plate_number IS NOT NULL) AND (trailer_id IS NULL)) OR ((plate_number IS NULL) AND (trailer_id IS NOT NULL))));
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_pkey PRIMARY KEY (work_order_id);
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_work_order_number_key UNIQUE (work_order_number);
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_assigned_mechanic_id_fkey FOREIGN KEY (assigned_mechanic_id) REFERENCES employees(employee_id);
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number);
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_trailer_id_fkey FOREIGN KEY (trailer_id) REFERENCES trailers(trailer_id);
CREATE UNIQUE INDEX work_orders_one_open_pms ON public.work_orders USING btree (plate_number) WHERE ((pms_target_km IS NOT NULL) AND (work_order_status = ANY (ARRAY['Created'::work_order_status_enum, 'Scheduled'::work_order_status_enum, 'In Progress'::work_order_status_enum, 'On Hold'::work_order_status_enum])));

-- ===== Enum types (65; many are left over from the original design and unused) =====

CREATE TYPE public.additional_charge_type_enum AS ENUM ('Damage', 'Extra Service', 'Storage', 'Documentation', 'Toll', 'Other');
CREATE TYPE public.assignment_status_enum AS ENUM ('Assigned', 'Dispatched', 'InTransit', 'Delivered', 'Cancelled');
CREATE TYPE public.attendance_status_enum AS ENUM ('Present', 'Absent', 'Late', 'Half Day', 'On Leave');
CREATE TYPE public.audit_action_enum AS ENUM ('Create', 'Update', 'Delete', 'View', 'Approve', 'Reject');
CREATE TYPE public.booking_cargo_type_enum AS ENUM ('Container', 'Loose', 'Mixed');
CREATE TYPE public.booking_status_enum AS ENUM ('Draft', 'Confirmed', 'Dispatched', 'InProgress', 'Delivered', 'Cancelled', 'OnHold');
CREATE TYPE public.cargo_type_enum AS ENUM ('Container', 'Loose');
CREATE TYPE public.cash_advance_deduction_status_enum AS ENUM ('Pending Deduction', 'Partially Deducted', 'Fully Deducted', 'Cancelled');
CREATE TYPE public.cash_advance_reason_enum AS ENUM ('Food', 'Emergency', 'Transport', 'Other');
CREATE TYPE public.charge_to_enum AS ENUM ('Client', 'Company');
CREATE TYPE public.config_type_enum AS ENUM ('Number', 'Decimal', 'Text', 'Boolean', 'Date', 'List');
CREATE TYPE public.container_ownership_enum AS ENUM ('Company Owned', 'Client Owned', 'Leased');
CREATE TYPE public.container_state_enum AS ENUM ('Available', 'In Use', 'Maintenance', 'Decommissioned');
CREATE TYPE public.container_type_enum AS ENUM ('20ft', '40ft');
CREATE TYPE public.crew_role_enum AS ENUM ('Driver', 'Helper', 'Mechanic');
CREATE TYPE public.damage_status_enum AS ENUM ('Reported', 'Under Investigation', 'Approved', 'Rejected');
CREATE TYPE public.delivery_condition_enum AS ENUM ('Good', 'Damaged', 'Partial', 'Missing');
CREATE TYPE public.driver_license_status_enum AS ENUM ('Valid', 'Expired', 'Suspended', 'Revoked');
CREATE TYPE public.driver_license_type_enum AS ENUM ('Professional', 'Non-Professional');
CREATE TYPE public.driver_medical_exam_result_enum AS ENUM ('Passed', 'Failed', 'Conditional');
CREATE TYPE public.driver_medical_exam_type_enum AS ENUM ('Annual Checkup', 'Pre-employment', 'Post-incident', 'Renewal');
CREATE TYPE public.employee_civil_status_enum AS ENUM ('Single', 'Married', 'Divorced', 'Widowed');
CREATE TYPE public.employee_gender_enum AS ENUM ('Male', 'Female', 'Other');
CREATE TYPE public.employee_pay_frequency_enum AS ENUM ('Weekly', 'Bi-weekly', 'Monthly');
CREATE TYPE public.employee_position_enum AS ENUM ('Driver', 'Helper', 'Mechanic', 'Dispatcher', 'Admin', 'Other');
CREATE TYPE public.employee_rate_type_enum AS ENUM ('Daily Fixed', 'Commission Per Trip', 'Monthly Salary', 'Hourly', 'Weekly Salary');
CREATE TYPE public.employee_term_type_enum AS ENUM ('Advance', 'Deferred Pay', 'Installment');
CREATE TYPE public.employment_status_name_enum AS ENUM ('Active', 'Inactive', 'On Leave', 'Terminated', 'Resigned');
CREATE TYPE public.expense_type_enum AS ENUM ('Fuel', 'Toll', 'Parking', 'Maintenance', 'Driver Meal', 'Helper Pay', 'Other');
CREATE TYPE public.incident_severity_enum AS ENUM ('Minor', 'Major');
CREATE TYPE public.incident_status_enum AS ENUM ('Reported', 'Investigating', 'Resolved', 'Pending');
CREATE TYPE public.incident_type_enum AS ENUM ('Accident', 'Breakdown', 'Delay', 'Violation', 'Other');
CREATE TYPE public.inspection_issue_severity_enum AS ENUM ('Minor', 'Major', 'Critical');
CREATE TYPE public.inspection_report_status_enum AS ENUM ('Reported', 'Under Review', 'Assigned to Maintenance', 'Resolved');
CREATE TYPE public.inventory_transaction_type_enum AS ENUM ('Stock In', 'Stock Out', 'Adjustment', 'Return');
CREATE TYPE public.invoice_status_enum AS ENUM ('Draft', 'Issued', 'Overdue', 'Paid', 'PartiallyPaid', 'Cancelled');
CREATE TYPE public.itinerary_status_enum AS ENUM ('Awaiting', 'Dispatched', 'PickedUp', 'InTransit', 'Delivered', 'Cancelled');
CREATE TYPE public.maintenance_frequency_type_enum AS ENUM ('ByKilometers', 'ByMonths', 'ByDays');
CREATE TYPE public.maintenance_request_priority_enum AS ENUM ('Low', 'Medium', 'High', 'Urgent');
CREATE TYPE public.maintenance_request_status_enum AS ENUM ('Submitted', 'Approved', 'Rejected', 'Assigned', 'In Progress', 'Completed');
CREATE TYPE public.maintenance_request_type_enum AS ENUM ('Routine', 'Breakdown', 'Preventive');
CREATE TYPE public.maintenance_schedule_status_enum AS ENUM ('Scheduled', 'In Progress', 'Completed', 'Overdue', 'Cancelled');
CREATE TYPE public.maintenance_type_enum AS ENUM ('Preventive', 'Predictive', 'Corrective', 'Routine');
CREATE TYPE public.misc_deduction_category_enum AS ENUM ('Damage', 'Violation', 'Shortage', 'Loan', 'Other');
CREATE TYPE public.notification_recipient_type_enum AS ENUM ('Admin', 'Dispatcher', 'Driver', 'Mechanic');
CREATE TYPE public.notification_sent_status_enum AS ENUM ('Queued', 'Sent', 'Failed');
CREATE TYPE public.notification_type_enum AS ENUM ('TripDelayed', 'LicenseExpiry', 'MedicalExpiry', 'MaintenanceDue', 'InsuranceDue', 'UnassignedItinerary', 'PaymentOverdue', 'IncidentReport');
CREATE TYPE public.part_category_enum AS ENUM ('Engine Parts', 'Tire & Wheels', 'Brake System', 'Electrical', 'Suspension', 'Other');
CREATE TYPE public.payment_method_enum AS ENUM ('Cash', 'Bank Transfer', 'Check', 'Online', 'Other');
CREATE TYPE public.payment_terms_enum AS ENUM ('Cash', '7Days', '14Days', '30Days');
CREATE TYPE public.payment_terms_preference AS ENUM ('Cash', '7Days', '14Days', '30Days');
CREATE TYPE public.payroll_adjustment_type_enum AS ENUM ('Correction', 'Addition', 'Deduction', 'Override');
CREATE TYPE public.payroll_deduction_type_enum AS ENUM ('SSS', 'PhilHealth', 'Pag-IBIG', 'Tax', 'Cash Advance', 'Loan', 'Insurance', 'Other');
CREATE TYPE public.payslip_status_enum AS ENUM ('Draft', 'Submitted', 'Approved', 'Finalized', 'Paid');
CREATE TYPE public.request_status_enum AS ENUM ('Pending', 'Approved', 'Rejected', 'Expired', 'Offered', 'Countered', 'Declined', 'Withdrawn');
CREATE TYPE public.service_type_enum AS ENUM ('Oil Change', 'Tire Replacement', 'Brake Inspection', 'Engine Tune-up', 'Electrical Check', 'Other');
CREATE TYPE public.suggestion_status_enum AS ENUM ('Pending', 'Confirmed', 'Rejected');
CREATE TYPE public.trailer_assignment_status_enum AS ENUM ('Assigned', 'In Use', 'Returned', 'Cancelled');
CREATE TYPE public.trailer_status_enum AS ENUM ('Available', 'In Use', 'Maintenance', 'Decommissioned');
CREATE TYPE public.trip_earning_category_enum AS ENUM ('Commission', 'Helper Pay', 'Other');
CREATE TYPE public.truck_status_enum AS ENUM ('Available', 'Dispatched', 'InTransit', 'Maintenance', 'Inactive');
CREATE TYPE public.truck_trailer_compatibility_enum AS ENUM ('20ft', '40ft', 'Both');
CREATE TYPE public.user_role_enum AS ENUM ('Admin', 'Dispatcher', 'Driver', 'Mechanic', 'Client', 'Manager', 'Helper');
CREATE TYPE public.weight_unit_enum AS ENUM ('kg', 'tons', 'lbs');
CREATE TYPE public.work_order_status_enum AS ENUM ('Created', 'Scheduled', 'In Progress', 'On Hold', 'Completed', 'Cancelled');

-- ===== Functions (signatures only; bodies are in the baseline migration) =====

-- public._cap_ms(t timestamp with time zone)
-- public._inventory_actor(OUT o_employee_id integer, OUT o_role user_role_enum)
-- public._inventory_check_usable(p_item inventory_items)
-- public._inventory_open_work_order(p_work_order_id integer, p_role user_role_enum, p_employee_id integer)
-- public._inventory_put(p_lot_id integer, p_qty numeric)
-- public._inventory_receive(p_item_id integer, p_qty numeric, p_unit_cost numeric, p_received_at timestamp with time zone, p_note text, p_employee_id integer)
-- public._inventory_take(p_item_id integer, p_qty numeric)
-- public._inventory_use_on_completion(p_item inventory_items, p_qty numeric, p_completion_id integer, p_work_order_id integer, p_employee_id integer)
-- public._my_employee_id()
-- public.accept_quote_counter(p_quote_id bigint, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_trip_plan jsonb DEFAULT NULL::jsonb)
-- public.adjust_stock(p_item_id integer, p_new_quantity numeric, p_reason text, p_note text DEFAULT NULL::text)
-- public.adjust_stock_by(p_item_id integer, p_change numeric, p_reason text, p_note text DEFAULT NULL::text)
-- public.attach_payment_proof(p_payment_id integer, p_path text)
-- public.booking_downpayment(p_booking_id integer)
-- public.can_view_trip_documents(p_itinerary_id integer)
-- public.cancel_work_order_parts(p_work_order_id integer, p_mode text, p_reason text DEFAULT NULL::text)
-- public.change_my_username(p_username text)
-- public.check_vehicle_slot()
-- public.close_part_request(p_request_id integer, p_note text DEFAULT NULL::text)
-- public.complete_work_order(p_work_order_id integer, p_description text, p_odometer numeric DEFAULT NULL::numeric, p_next_service_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_parts jsonb DEFAULT '[]'::jsonb, p_new_items jsonb DEFAULT '[]'::jsonb)
-- public.count_bookings_for_clients(client_ids integer[])
-- public.create_bill(p_category text, p_description text, p_amount numeric, p_creditor_id integer DEFAULT NULL::integer, p_bill_date date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_reference_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_paid_now boolean DEFAULT false, p_method text DEFAULT 'Cash'::text)
-- public.create_booking_from_quote(p_quote_id bigint)
-- public.create_inventory_item(p_name text, p_item_type text, p_unit text, p_quantity numeric, p_unit_cost numeric, p_reorder_level numeric DEFAULT NULL::numeric)
-- public.crew_slot_conflict(p_employee_id integer, p_itinerary_id integer)
-- public.current_admin_employee_id()
-- public.discard_draft_payslip(p_payroll_id bigint)
-- public.free_vehicles_on_delivery()
-- public.get_capacity_inputs(p_from timestamp with time zone, p_to timestamp with time zone, p_exclude_quote bigint DEFAULT NULL::bigint)
-- public.get_login_email(p_username text)
-- public.get_my_profile()
-- public.get_trip_client_and_rate(p_itinerary_id integer)
-- public.get_trip_payment_status(p_itinerary_id integer)
-- public.get_trip_storage_deadline(p_itinerary_id integer)
-- public.handle_client_signup()
-- public.inventory_items_guard_quantity()
-- public.is_admin()
-- public.is_staff()
-- public.itineraries_after_reschedule()
-- public.itinerary_crews_check_slot()
-- public.itinerary_crews_notify()
-- public.itinerary_slot_defaults()
-- public.itinerary_trailer_fits()
-- public.itinerary_trip_rate_default()
-- public.log_part_used(p_work_order_id integer, p_item_id integer, p_quantity numeric)
-- public.parts_requests_close_on_receive()
-- public.pms_auto_schedule()
-- public.pms_reset_on_completion()
-- public.post_stock_count(p_counts jsonb, p_note text DEFAULT NULL::text)
-- public.quote_average_rate(p_cargo_lines jsonb, p_line_rates jsonb)
-- public.receive_stock(p_item_id integer, p_quantity numeric, p_unit_cost numeric, p_note text DEFAULT NULL::text)
-- public.record_bill_payment(p_bill_id integer, p_amount numeric, p_method text DEFAULT 'Cash'::text, p_paid_on date DEFAULT NULL::date, p_reference_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
-- public.record_booking_payment(p_booking_id integer, p_amount numeric, p_method text, p_paid_on date DEFAULT NULL::date, p_reference_no text DEFAULT NULL::text, p_or_number text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_set_amount_to_pay numeric DEFAULT NULL::numeric)
-- public.record_odometer_reading(p_plate_number text, p_reading numeric, p_note text DEFAULT NULL::text)
-- public.record_trip_km(p_itinerary_id integer, p_out_km numeric, p_trip_km numeric, p_back_km numeric, p_note text DEFAULT NULL::text)
-- public.request_part(p_item_id integer, p_work_order_id integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
-- public.require_crew_free_of_road()
-- public.require_downpayment()
-- public.respond_to_quote_offer(p_quote_id bigint, p_action text, p_pickup_date date, p_deadline_date date, p_note text, p_line_rates jsonb DEFAULT NULL::jsonb, p_rate numeric DEFAULT NULL::numeric)
-- public.resubmit_quote_request(p_quote_id bigint, p_changes jsonb)
-- public.return_logged_part(p_log_id integer)
-- public.rls_auto_enable()
-- public.send_quote_offer(p_quote_id bigint, p_pickup_date date, p_deadline_date date, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_note text, p_line_rates jsonb DEFAULT NULL::jsonb, p_rate numeric DEFAULT NULL::numeric, p_trip_plan jsonb DEFAULT NULL::jsonb)
-- public.set_client_active(p_client_id integer, p_active boolean, p_reason text DEFAULT NULL::text)
-- public.set_item_archived(p_item_id integer, p_archived boolean)
-- public.set_item_price(p_item_id integer, p_unit_cost numeric)
-- public.set_updated_at()
-- public.sync_bill_amount_paid()
-- public.sync_booking_amount_paid()
-- public.sync_booking_status()
-- public.truck_odometer_log_direct()
-- public.update_my_profile(p_changes jsonb)
-- public.void_bill(p_bill_id integer, p_reason text)
-- public.void_bill_payment(p_bill_payment_id integer, p_reason text)
-- public.void_booking_payment(p_payment_id integer, p_reason text)
-- public.waive_downpayment(p_booking_id integer, p_reason text)
-- public.withdraw_quote_request(p_quote_id bigint)
