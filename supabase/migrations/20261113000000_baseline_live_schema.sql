-- Baseline: full public schema of the live Supabase project, 2026-11-13.
-- Generated from the live database catalog (read-only queries via
-- `supabase db query --remote --read-only`; `db dump` needs Docker).
-- Replaces the three earlier migrations (20260822100231, 20260918120000,
-- 20260918130000) and everything run by hand in the SQL Editor since.
-- Builds a fresh project from empty. Do NOT push this to the live project:
-- it's marked as already applied there (`supabase migration repair`).
-- Not included: data rows (app_settings, location_reference, ...), auth
-- settings, Edge Function secrets.

SET check_function_bodies = false;

-- ===== 1. Extensions (4) =====

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ===== 2. Enum types (65) =====

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

-- ===== 3. Sequences (serial columns) (9) =====

CREATE SEQUENCE public.cash_advances_cash_advance_id_seq AS integer START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE public.client_status_requests_request_id_seq AS integer START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE public.inventory_lots_lot_id_seq AS integer START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE public.inventory_movements_movement_id_seq AS integer START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE public.parts_requests_request_id_seq AS integer START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE public.payslip_issue_reports_report_id_seq AS integer START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE public.payslip_line_items_payslip_line_item_id_seq AS integer START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE public.route_cache_route_cache_id_seq AS integer START WITH 1 INCREMENT BY 1;

CREATE SEQUENCE public.work_order_acceptance_log_log_id_seq AS integer START WITH 1 INCREMENT BY 1;

-- ===== 4. Tables (53) =====

CREATE TABLE public.app_settings (
  setting_key text NOT NULL,
  label text NOT NULL,
  setting_value numeric NOT NULL,
  unit text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

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

CREATE TABLE public.client_delinquency_log (
  log_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  client_id integer NOT NULL,
  action text NOT NULL,
  reason text NOT NULL,
  changed_by_employee_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.client_reviews (
  review_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  client_id integer NOT NULL,
  rating integer NOT NULL,
  comment text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  is_featured boolean DEFAULT false NOT NULL
);

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

CREATE TABLE public.creditors (
  creditor_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  creditor_name text NOT NULL,
  contact_person text,
  phone text,
  tin_number text,
  note text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

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

CREATE TABLE public.employment_status (
  status_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  status_name text NOT NULL,
  description text
);

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

CREATE TABLE public.itinerary_crews (
  itinerary_crew_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  employee_id integer NOT NULL,
  crew_role text NOT NULL,
  assigned_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  completed_at timestamp with time zone
);

CREATE TABLE public.itinerary_documents (
  document_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  uploaded_by integer,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.itinerary_expenses (
  expense_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itinerary_id integer NOT NULL,
  employee_id integer NOT NULL,
  amount numeric NOT NULL,
  description text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  category text DEFAULT 'Other'::text NOT NULL
);

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

CREATE TABLE public.location_reference (
  location_ref_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  province character varying,
  city character varying NOT NULL,
  barangay character varying NOT NULL
);

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

CREATE TABLE public.named_locations (
  named_location_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  abbreviation character varying NOT NULL,
  full_name character varying NOT NULL,
  city character varying NOT NULL,
  barangay character varying NOT NULL,
  landmark_detail text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.notifications (
  notification_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_id integer NOT NULL,
  kind text NOT NULL,
  itinerary_id integer,
  created_at timestamp with time zone DEFAULT now(),
  read_at timestamp with time zone
);

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

CREATE TABLE public.payslip_line_items (
  payslip_line_item_id integer DEFAULT nextval('payslip_line_items_payslip_line_item_id_seq'::regclass) NOT NULL,
  payroll_id integer NOT NULL,
  itinerary_id integer,
  description text NOT NULL,
  amount numeric NOT NULL
);

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

CREATE TABLE public.route_cache (
  route_cache_id integer DEFAULT nextval('route_cache_route_cache_id_seq'::regclass) NOT NULL,
  place_id_a integer NOT NULL,
  place_id_b integer NOT NULL,
  distance_km numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

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

CREATE TABLE public.work_order_acceptance_log (
  log_id integer DEFAULT nextval('work_order_acceptance_log_log_id_seq'::regclass) NOT NULL,
  work_order_id integer NOT NULL,
  employee_id integer NOT NULL,
  accepted_at timestamp with time zone DEFAULT now() NOT NULL
);

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

CREATE TABLE public.work_order_notes (
  note_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  work_order_id integer NOT NULL,
  employee_id integer NOT NULL,
  note text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

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

CREATE TABLE public.work_order_parts_used (
  part_used_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  completion_id integer NOT NULL,
  item_id integer,
  item_name_text character varying,
  quantity numeric DEFAULT 1 NOT NULL,
  unit_cost numeric(12,2)
);

CREATE TABLE public.work_order_status_log (
  log_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  work_order_id integer NOT NULL,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  changed_by integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

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

-- ===== 5. Sequence ownership (9) =====

ALTER SEQUENCE public.cash_advances_cash_advance_id_seq OWNED BY public.cash_advances.cash_advance_id;

ALTER SEQUENCE public.client_status_requests_request_id_seq OWNED BY public.client_status_requests.request_id;

ALTER SEQUENCE public.inventory_lots_lot_id_seq OWNED BY public.inventory_lots.lot_id;

ALTER SEQUENCE public.inventory_movements_movement_id_seq OWNED BY public.inventory_movements.movement_id;

ALTER SEQUENCE public.parts_requests_request_id_seq OWNED BY public.parts_requests.request_id;

ALTER SEQUENCE public.payslip_issue_reports_report_id_seq OWNED BY public.payslip_issue_reports.report_id;

ALTER SEQUENCE public.payslip_line_items_payslip_line_item_id_seq OWNED BY public.payslip_line_items.payslip_line_item_id;

ALTER SEQUENCE public.route_cache_route_cache_id_seq OWNED BY public.route_cache.route_cache_id;

ALTER SEQUENCE public.work_order_acceptance_log_log_id_seq OWNED BY public.work_order_acceptance_log.log_id;

-- ===== 6. Primary keys, unique and check constraints (156) =====

ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (setting_key);

ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_amount_check CHECK ((amount > (0)::numeric));

ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_check CHECK (((voided_at IS NULL) OR (void_reason IS NOT NULL)));

ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_method_check CHECK ((method = ANY (ARRAY['Cash'::text, 'Bank Transfer'::text, 'GCash'::text, 'Check'::text, 'Other'::text])));

ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_pkey PRIMARY KEY (bill_payment_id);

ALTER TABLE public.bills ADD CONSTRAINT bills_amount_check CHECK ((amount > (0)::numeric));

ALTER TABLE public.bills ADD CONSTRAINT bills_category_check CHECK ((category = ANY (ARRAY['Fuel'::text, 'Parts'::text, 'Utilities'::text, 'Rent'::text, 'Permits & Registration'::text, 'Insurance'::text, 'Tolls'::text, 'Office'::text, 'Other'::text])));

ALTER TABLE public.bills ADD CONSTRAINT bills_check CHECK (((due_date IS NULL) OR (due_date >= bill_date)));

ALTER TABLE public.bills ADD CONSTRAINT bills_check1 CHECK (((voided_at IS NULL) OR (void_reason IS NOT NULL)));

ALTER TABLE public.bills ADD CONSTRAINT bills_description_check CHECK ((TRIM(BOTH FROM description) <> ''::text));

ALTER TABLE public.bills ADD CONSTRAINT bills_pkey PRIMARY KEY (bill_id);

ALTER TABLE public.booking_charges ADD CONSTRAINT booking_charges_amount_check CHECK ((amount > (0)::numeric));

ALTER TABLE public.booking_charges ADD CONSTRAINT booking_charges_description_check CHECK ((length(TRIM(BOTH FROM description)) > 0));

ALTER TABLE public.booking_charges ADD CONSTRAINT booking_charges_pkey PRIMARY KEY (charge_id);

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_amount_check CHECK ((amount <> (0)::numeric));

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_check CHECK (((method = 'Refund'::text) = (amount < (0)::numeric)));

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_check1 CHECK (((voided_at IS NULL) OR (void_reason IS NOT NULL)));

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_method_check CHECK ((method = ANY (ARRAY['Cash'::text, 'Bank Transfer'::text, 'GCash'::text, 'Check'::text, 'Other'::text, 'Refund'::text])));

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_reference_required CHECK (((method <> ALL (ARRAY['GCash'::text, 'Bank Transfer'::text, 'Check'::text])) OR (NULLIF(btrim(reference_no), ''::text) IS NOT NULL))) NOT VALID;

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_pkey PRIMARY KEY (payment_id);

ALTER TABLE public.bookings ADD CONSTRAINT bookings_cost_per_trip_check CHECK ((cost_per_trip >= (0)::numeric));

ALTER TABLE public.bookings ADD CONSTRAINT bookings_delivery_pin_pair CHECK (((delivery_lat IS NULL) = (delivery_lng IS NULL)));

ALTER TABLE public.bookings ADD CONSTRAINT bookings_hours_per_trip_check CHECK (((hours_per_trip > (0)::numeric) AND (hours_per_trip <= (72)::numeric)));

ALTER TABLE public.bookings ADD CONSTRAINT bookings_pickup_pin_pair CHECK (((pickup_lat IS NULL) = (pickup_lng IS NULL)));

ALTER TABLE public.bookings ADD CONSTRAINT bookings_trailer_type_check CHECK ((trailer_type = ANY (ARRAY['Flatbed'::text, 'Skeletal'::text])));

ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (booking_id);

ALTER TABLE public.cash_advances ADD CONSTRAINT cash_advances_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])));

ALTER TABLE public.cash_advances ADD CONSTRAINT cash_advances_pkey PRIMARY KEY (cash_advance_id);

ALTER TABLE public.client_delinquency_log ADD CONSTRAINT client_delinquency_log_action_check CHECK ((action = ANY (ARRAY['Marked'::text, 'Unmarked'::text])));

ALTER TABLE public.client_delinquency_log ADD CONSTRAINT client_delinquency_log_pkey PRIMARY KEY (log_id);

ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));

ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_pkey PRIMARY KEY (review_id);

ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_client_id_key UNIQUE (client_id);

ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Responded'::text])));

ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_pkey PRIMARY KEY (request_id);

ALTER TABLE public.clients ADD CONSTRAINT clients_phone_ph CHECK (((phone_number)::text ~ '^09[0-9]{9}$'::text)) NOT VALID;

ALTER TABLE public.clients ADD CONSTRAINT clients_pkey PRIMARY KEY (client_id);

ALTER TABLE public.clients ADD CONSTRAINT clients_email_key UNIQUE (email);

ALTER TABLE public.creditors ADD CONSTRAINT creditors_creditor_name_check CHECK ((TRIM(BOTH FROM creditor_name) <> ''::text));

ALTER TABLE public.creditors ADD CONSTRAINT creditors_pkey PRIMARY KEY (creditor_id);

ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_charge_to_check CHECK ((charge_to = ANY (ARRAY['Client'::text, 'Company'::text, 'Insurance'::text]))) NOT VALID;

ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_claim_status_check CHECK (((claim_status IS NULL) OR (claim_status = ANY (ARRAY['Filed'::text, 'Paid'::text, 'Denied'::text]))));

ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_covered_check CHECK (((insurance_covered_amount IS NULL) OR ((insurance_covered_amount >= (0)::numeric) AND (insurance_covered_amount <= estimated_damage_cost))));

ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_insurance_complete CHECK (((charge_to IS DISTINCT FROM 'Insurance'::text) OR ((insurance_company_id IS NOT NULL) AND (insurance_covered_amount IS NOT NULL) AND (claim_status IS NOT NULL))));

ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_pkey PRIMARY KEY (damage_id);

ALTER TABLE public.dispatch_status_logs ADD CONSTRAINT dispatch_status_logs_pkey PRIMARY KEY (log_id);

ALTER TABLE public.employee_attendance ADD CONSTRAINT employee_attendance_status_check CHECK ((attendance_status = ANY (ARRAY['Present'::text, 'Leave'::text, 'Unpaid Leave'::text, 'Absent'::text])));

ALTER TABLE public.employee_attendance ADD CONSTRAINT employee_attendance_pkey PRIMARY KEY (attendance_id);

ALTER TABLE public.employee_attendance ADD CONSTRAINT employee_attendance_employee_date_key UNIQUE (employee_id, attendance_date);

ALTER TABLE public.employees ADD CONSTRAINT employees_commission_basis_check CHECK ((commission_basis = ANY (ARRAY['Flat Fee'::text, 'Percentage'::text])));

ALTER TABLE public.employees ADD CONSTRAINT employees_phone_ph CHECK (((phone_number)::text ~ '^09[0-9]{9}$'::text)) NOT VALID;

ALTER TABLE public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (employee_id);

ALTER TABLE public.employees ADD CONSTRAINT employees_assigned_plate_number_key UNIQUE (assigned_plate_number);

ALTER TABLE public.employment_status ADD CONSTRAINT employment_status_pkey PRIMARY KEY (status_id);

ALTER TABLE public.employment_status ADD CONSTRAINT employment_status_status_name_key UNIQUE (status_name);

ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_amount_insured_check CHECK ((amount_insured > (0)::numeric));

ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_company_name_check CHECK ((btrim(company_name) <> ''::text));

ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_dates CHECK ((valid_until >= valid_from));

ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_limit_type_check CHECK ((limit_type = ANY (ARRAY['Total'::text, 'PerClaim'::text])));

ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_policy_number_check CHECK ((btrim(policy_number) <> ''::text));

ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_pkey PRIMARY KEY (insurance_company_id);

ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_quantity_check CHECK ((quantity >= (0)::numeric));

ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_reorder_level_check CHECK ((reorder_level >= (0)::numeric));

ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_unit_check CHECK ((unit = ANY (ARRAY['pcs'::text, 'L'::text, 'kg'::text, 'm'::text, 'set'::text])));

ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_unit_cost_check CHECK ((unit_cost >= (0)::numeric));

ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (item_id);

ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_check CHECK (((qty_remaining >= (0)::numeric) AND (qty_remaining <= qty_received)));

ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_qty_received_check CHECK ((qty_received > (0)::numeric));

ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_unit_cost_check CHECK ((unit_cost >= (0)::numeric));

ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_pkey PRIMARY KEY (lot_id);

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_qty_change_check CHECK ((qty_change <> (0)::numeric));

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_reason_check CHECK ((reason = ANY (ARRAY['opening'::text, 'receive'::text, 'use'::text, 'return'::text, 'adjust'::text, 'write_off'::text, 'count'::text])));

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (movement_id);

ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_pkey PRIMARY KEY (issue_report_id);

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_cargo_type_check CHECK (((cargo_type IS NULL) OR (cargo_type = ANY (ARRAY['Container'::text, 'Loose'::text])))) NOT VALID;

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_container_type_check CHECK (((container_type IS NULL) OR (container_type = ANY (ARRAY['20ft'::text, '40ft'::text])))) NOT VALID;

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_loose_on_flatbed CHECK (((cargo_type IS DISTINCT FROM 'Loose'::text) OR (trailer_type = 'Flatbed'::text))) NOT VALID;

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_trailer_type_check CHECK (((trailer_type IS NULL) OR (trailer_type = ANY (ARRAY['Flatbed'::text, 'Skeletal'::text])))) NOT VALID;

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_weight_check CHECK (((weight IS NULL) OR ((weight > (0)::numeric) AND (weight <= (45)::numeric)))) NOT VALID;

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_pkey PRIMARY KEY (itinerary_id);

ALTER TABLE public.itinerary_crews ADD CONSTRAINT itinerary_crews_pkey PRIMARY KEY (itinerary_crew_id);

ALTER TABLE public.itinerary_documents ADD CONSTRAINT itinerary_documents_pkey PRIMARY KEY (document_id);

ALTER TABLE public.itinerary_documents ADD CONSTRAINT itinerary_documents_file_path_key UNIQUE (file_path);

ALTER TABLE public.itinerary_expenses ADD CONSTRAINT itinerary_expenses_category_check CHECK ((category = ANY (ARRAY['Fuel'::text, 'Toll'::text, 'Parking'::text, 'Other'::text])));

ALTER TABLE public.itinerary_expenses ADD CONSTRAINT itinerary_expenses_pkey PRIMARY KEY (expense_id);

ALTER TABLE public.itinerary_schedule_logs ADD CONSTRAINT itinerary_schedule_logs_pkey PRIMARY KEY (log_id);

ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_check CHECK ((end_date >= start_date));

ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_leave_type_check CHECK ((leave_type = ANY (ARRAY['Vacation'::text, 'Sick'::text, 'Emergency'::text, 'Other'::text])));

ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])));

ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_pkey PRIMARY KEY (leave_id);

ALTER TABLE public.location_reference ADD CONSTRAINT location_reference_pkey PRIMARY KEY (location_ref_id);

ALTER TABLE public.location_reference ADD CONSTRAINT location_reference_city_barangay_key UNIQUE (city, barangay);

ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_one_vehicle CHECK ((((plate_number IS NOT NULL) AND (trailer_id IS NULL)) OR ((plate_number IS NULL) AND (trailer_id IS NOT NULL))));

ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])));

ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_pkey PRIMARY KEY (request_id);

ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_one_vehicle CHECK ((((plate_number IS NOT NULL) AND (trailer_id IS NULL)) OR ((plate_number IS NULL) AND (trailer_id IS NOT NULL))));

ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Completed'::text])));

ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_pkey PRIMARY KEY (schedule_id);

ALTER TABLE public.named_locations ADD CONSTRAINT named_locations_pkey PRIMARY KEY (named_location_id);

ALTER TABLE public.named_locations ADD CONSTRAINT named_locations_abbreviation_key UNIQUE (abbreviation);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK ((kind = ANY (ARRAY['assigned'::text, 'removed'::text, 'rescheduled'::text])));

ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (notification_id);

ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_status_check CHECK ((status = ANY (ARRAY['Open'::text, 'Done'::text])));

ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_pkey PRIMARY KEY (request_id);

ALTER TABLE public.payroll_payslips ADD CONSTRAINT payroll_payslips_pkey PRIMARY KEY (payroll_id);

ALTER TABLE public.payroll_payslips ADD CONSTRAINT payroll_payslips_employee_period_key UNIQUE (employee_id, payroll_period_start, payroll_period_end);

ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Resolved'::text])));

ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_pkey PRIMARY KEY (report_id);

ALTER TABLE public.payslip_line_items ADD CONSTRAINT payslip_line_items_pkey PRIMARY KEY (payslip_line_item_id);

ALTER TABLE public.places ADD CONSTRAINT places_pkey PRIMARY KEY (place_id);

ALTER TABLE public.quote_rate_offers ADD CONSTRAINT quote_rate_offers_action_check CHECK ((action = ANY (ARRAY['Offer'::text, 'Counter'::text, 'Accept'::text, 'Decline'::text])));

ALTER TABLE public.quote_rate_offers ADD CONSTRAINT quote_rate_offers_party_check CHECK ((party = ANY (ARRAY['Business'::text, 'Client'::text])));

ALTER TABLE public.quote_rate_offers ADD CONSTRAINT quote_rate_offers_pkey PRIMARY KEY (offer_id);

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_cargo_lines_check CHECK (((cargo_lines IS NULL) OR ((jsonb_typeof(cargo_lines) = 'array'::text) AND ((jsonb_array_length(cargo_lines) >= 1) AND (jsonb_array_length(cargo_lines) <= 50)))));

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_delivery_pin_pair CHECK (((delivery_lat IS NULL) = (delivery_lng IS NULL)));

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_phone_ph CHECK (((contact_number)::text ~ '^09[0-9]{9}$'::text)) NOT VALID;

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_pickup_pin_pair CHECK (((pickup_lat IS NULL) = (pickup_lng IS NULL)));

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_rejected_needs_tag CHECK (((request_status <> 'Rejected'::request_status_enum) OR (rejection_tag IS NOT NULL))) NOT VALID;

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_rejection_tag_check CHECK ((rejection_tag = ANY (ARRAY['Rate'::text, 'Weight'::text, 'Schedule'::text, 'Terms'::text, 'Other'::text])));

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_trailer_type_check CHECK ((trailer_type = ANY (ARRAY['Flatbed'::text, 'Skeletal'::text])));

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_pkey PRIMARY KEY (quote_request_id);

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_reference_code_key UNIQUE (reference_code);

ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_ordered_pair CHECK ((place_id_a < place_id_b));

ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_pkey PRIMARY KEY (route_cache_id);

ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_pair_unique UNIQUE (place_id_a, place_id_b);

ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_one_target CHECK ((((itinerary_id IS NOT NULL) AND (work_order_id IS NULL)) OR ((itinerary_id IS NULL) AND (work_order_id IS NOT NULL))));

ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_status_check CHECK ((status = ANY (ARRAY['Pending'::text, 'Approved'::text, 'Rejected'::text])));

ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_pkey PRIMARY KEY (request_id);

ALTER TABLE public.trailers ADD CONSTRAINT trailers_trailer_size_check CHECK ((trailer_size = ANY (ARRAY['20ft'::text, '40ft'::text])));

ALTER TABLE public.trailers ADD CONSTRAINT trailers_pkey PRIMARY KEY (trailer_id);

ALTER TABLE public.trailers ADD CONSTRAINT trailers_plate_number_key UNIQUE (plate_number);

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_back_km_check CHECK ((back_km >= (0)::numeric));

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_out_km_check CHECK ((out_km >= (0)::numeric));

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_reading_check CHECK ((reading >= (0)::numeric));

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_source_check CHECK ((source = ANY (ARRAY['opening'::text, 'trip'::text, 'reading'::text, 'edit'::text])));

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_trip_km_check CHECK ((trip_km >= (0)::numeric));

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_pkey PRIMARY KEY (log_id);

ALTER TABLE public.truck_profiles ADD CONSTRAINT truck_profiles_last_pms_odometer_check CHECK ((last_pms_odometer >= (0)::numeric));

ALTER TABLE public.truck_profiles ADD CONSTRAINT truck_profiles_pkey PRIMARY KEY (plate_number);

ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);

ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id);

ALTER TABLE public.users ADD CONSTRAINT users_client_id_key UNIQUE (client_id);

ALTER TABLE public.users ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE public.users ADD CONSTRAINT users_username_key UNIQUE (username);

ALTER TABLE public.work_order_acceptance_log ADD CONSTRAINT work_order_acceptance_log_pkey PRIMARY KEY (log_id);

ALTER TABLE public.work_order_completions ADD CONSTRAINT work_order_completions_pkey PRIMARY KEY (completion_id);

ALTER TABLE public.work_order_notes ADD CONSTRAINT work_order_notes_pkey PRIMARY KEY (note_id);

ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_quantity_check CHECK ((quantity > (0)::numeric));

ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_unit_cost_check CHECK ((unit_cost >= (0)::numeric));

ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_pkey PRIMARY KEY (log_id);

ALTER TABLE public.work_order_parts_used ADD CONSTRAINT work_order_parts_used_unit_cost_check CHECK ((unit_cost >= (0)::numeric));

ALTER TABLE public.work_order_parts_used ADD CONSTRAINT work_order_parts_used_pkey PRIMARY KEY (part_used_id);

ALTER TABLE public.work_order_status_log ADD CONSTRAINT work_order_status_log_pkey PRIMARY KEY (log_id);

ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_vehicle_check CHECK ((((plate_number IS NOT NULL) AND (trailer_id IS NULL)) OR ((plate_number IS NULL) AND (trailer_id IS NOT NULL))));

ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_pkey PRIMARY KEY (work_order_id);

ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_work_order_number_key UNIQUE (work_order_number);

-- ===== 7. Foreign keys (96) =====

ALTER TABLE public.bill_payments ADD CONSTRAINT bill_payments_bill_id_fkey FOREIGN KEY (bill_id) REFERENCES bills(bill_id);

ALTER TABLE public.bills ADD CONSTRAINT bills_creditor_id_fkey FOREIGN KEY (creditor_id) REFERENCES creditors(creditor_id);

ALTER TABLE public.booking_charges ADD CONSTRAINT booking_charges_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(booking_id);

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(booking_id);

ALTER TABLE public.bookings ADD CONSTRAINT bookings_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);

ALTER TABLE public.bookings ADD CONSTRAINT bookings_place_of_delivery_id_fkey FOREIGN KEY (place_of_delivery_id) REFERENCES places(place_id);

ALTER TABLE public.bookings ADD CONSTRAINT bookings_place_of_pickup_id_fkey FOREIGN KEY (place_of_pickup_id) REFERENCES places(place_id);

ALTER TABLE public.bookings ADD CONSTRAINT bookings_quote_request_id_fkey FOREIGN KEY (quote_request_id) REFERENCES quote_requests(quote_request_id);

ALTER TABLE public.cash_advances ADD CONSTRAINT cash_advances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.client_delinquency_log ADD CONSTRAINT client_delinquency_log_changed_by_employee_id_fkey FOREIGN KEY (changed_by_employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.client_delinquency_log ADD CONSTRAINT client_delinquency_log_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);

ALTER TABLE public.client_reviews ADD CONSTRAINT client_reviews_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);

ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(booking_id);

ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);

ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.client_status_requests ADD CONSTRAINT client_status_requests_responded_by_fkey FOREIGN KEY (responded_by) REFERENCES employees(employee_id);

ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_insurance_company_id_fkey FOREIGN KEY (insurance_company_id) REFERENCES insurance_companies(insurance_company_id) ON DELETE RESTRICT;

ALTER TABLE public.delivery_damage_records ADD CONSTRAINT delivery_damage_records_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.dispatch_status_logs ADD CONSTRAINT dispatch_status_logs_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.employee_attendance ADD CONSTRAINT employee_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.employees ADD CONSTRAINT "employees_UID_fkey" FOREIGN KEY ("UID") REFERENCES auth.users(id);

ALTER TABLE public.employees ADD CONSTRAINT employees_assigned_plate_number_fkey FOREIGN KEY (assigned_plate_number) REFERENCES truck_profiles(plate_number) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.inventory_lots ADD CONSTRAINT inventory_lots_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_completion_id_fkey FOREIGN KEY (completion_id) REFERENCES work_order_completions(completion_id);

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_log_id_fkey FOREIGN KEY (log_id) REFERENCES work_order_parts_log(log_id) ON DELETE SET NULL;

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES inventory_lots(lot_id);

ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.issue_reports ADD CONSTRAINT issue_reports_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(booking_id);

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_place_of_delivery_id_fkey FOREIGN KEY (place_of_delivery_id) REFERENCES places(place_id);

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_place_of_pickup_id_fkey FOREIGN KEY (place_of_pickup_id) REFERENCES places(place_id);

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number);

ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_trailer_id_fkey FOREIGN KEY (trailer_id) REFERENCES trailers(trailer_id);

ALTER TABLE public.itinerary_crews ADD CONSTRAINT itinerary_crews_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.itinerary_documents ADD CONSTRAINT itinerary_documents_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id) ON DELETE CASCADE;

ALTER TABLE public.itinerary_expenses ADD CONSTRAINT itinerary_expenses_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.itinerary_expenses ADD CONSTRAINT itinerary_expenses_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.itinerary_schedule_logs ADD CONSTRAINT itinerary_schedule_logs_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES employees(employee_id);

ALTER TABLE public.leave_requests ADD CONSTRAINT leave_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number);

ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_requested_by_employee_id_fkey FOREIGN KEY (requested_by_employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_resolved_by_employee_id_fkey FOREIGN KEY (resolved_by_employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_trailer_id_fkey FOREIGN KEY (trailer_id) REFERENCES trailers(trailer_id);

ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_requests_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_completed_by_employee_id_fkey FOREIGN KEY (completed_by_employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number);

ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_reported_by_employee_id_fkey FOREIGN KEY (reported_by_employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_trailer_id_fkey FOREIGN KEY (trailer_id) REFERENCES trailers(trailer_id);

ALTER TABLE public.named_locations ADD CONSTRAINT named_locations_city_barangay_fkey FOREIGN KEY (city, barangay) REFERENCES location_reference(city, barangay);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);

ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES employees(employee_id);

ALTER TABLE public.parts_requests ADD CONSTRAINT parts_requests_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.payroll_payslips ADD CONSTRAINT payroll_payslips_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_payroll_id_fkey FOREIGN KEY (payroll_id) REFERENCES payroll_payslips(payroll_id);

ALTER TABLE public.payslip_issue_reports ADD CONSTRAINT payslip_issue_reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES employees(employee_id);

ALTER TABLE public.payslip_line_items ADD CONSTRAINT payslip_line_items_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.payslip_line_items ADD CONSTRAINT payslip_line_items_payroll_id_fkey FOREIGN KEY (payroll_id) REFERENCES payroll_payslips(payroll_id) ON DELETE CASCADE;

ALTER TABLE public.quote_rate_offers ADD CONSTRAINT quote_rate_offers_quote_request_id_fkey FOREIGN KEY (quote_request_id) REFERENCES quote_requests(quote_request_id);

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);

ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_place_id_a_fkey FOREIGN KEY (place_id_a) REFERENCES places(place_id);

ALTER TABLE public.route_cache ADD CONSTRAINT route_cache_place_id_b_fkey FOREIGN KEY (place_id_b) REFERENCES places(place_id);

ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_requested_by_employee_id_fkey FOREIGN KEY (requested_by_employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_resolved_by_employee_id_fkey FOREIGN KEY (resolved_by_employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.status_relog_requests ADD CONSTRAINT status_relog_requests_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_itinerary_id_fkey FOREIGN KEY (itinerary_id) REFERENCES itineraries(itinerary_id);

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.truck_odometer_log ADD CONSTRAINT truck_odometer_log_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES employees(employee_id);

ALTER TABLE public.users ADD CONSTRAINT users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);

ALTER TABLE public.users ADD CONSTRAINT users_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(client_id);

ALTER TABLE public.users ADD CONSTRAINT users_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.work_order_acceptance_log ADD CONSTRAINT work_order_acceptance_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.work_order_acceptance_log ADD CONSTRAINT work_order_acceptance_log_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.work_order_completions ADD CONSTRAINT work_order_completions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.work_order_completions ADD CONSTRAINT work_order_completions_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.work_order_notes ADD CONSTRAINT work_order_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.work_order_notes ADD CONSTRAINT work_order_notes_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_completion_id_fkey FOREIGN KEY (completion_id) REFERENCES work_order_completions(completion_id);

ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(employee_id);

ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);

ALTER TABLE public.work_order_parts_log ADD CONSTRAINT work_order_parts_log_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.work_order_parts_used ADD CONSTRAINT work_order_parts_used_completion_id_fkey FOREIGN KEY (completion_id) REFERENCES work_order_completions(completion_id);

ALTER TABLE public.work_order_parts_used ADD CONSTRAINT work_order_parts_used_item_id_fkey FOREIGN KEY (item_id) REFERENCES inventory_items(item_id);

ALTER TABLE public.work_order_status_log ADD CONSTRAINT work_order_status_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES employees(employee_id);

ALTER TABLE public.work_order_status_log ADD CONSTRAINT work_order_status_log_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(work_order_id);

ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_assigned_mechanic_id_fkey FOREIGN KEY (assigned_mechanic_id) REFERENCES employees(employee_id);

ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_plate_number_fkey FOREIGN KEY (plate_number) REFERENCES truck_profiles(plate_number);

ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_trailer_id_fkey FOREIGN KEY (trailer_id) REFERENCES trailers(trailer_id);

-- ===== 8. Indexes (46) =====

CREATE INDEX bill_payments_bill_idx ON public.bill_payments USING btree (bill_id);

CREATE INDEX bills_bill_date_idx ON public.bills USING btree (bill_date);

CREATE INDEX booking_charges_booking_idx ON public.booking_charges USING btree (booking_id);

CREATE INDEX booking_payments_booking_idx ON public.booking_payments USING btree (booking_id);

CREATE INDEX booking_payments_paid_on_idx ON public.booking_payments USING btree (paid_on);

CREATE UNIQUE INDEX creditors_name_key ON public.creditors USING btree (lower(TRIM(BOTH FROM creditor_name)));

CREATE INDEX dispatch_status_logs_itinerary_id_idx ON public.dispatch_status_logs USING btree (itinerary_id);

CREATE INDEX dispatch_status_logs_status_time_idx ON public.dispatch_status_logs USING btree (new_status, status_changed_at);

CREATE INDEX employee_attendance_date_idx ON public.employee_attendance USING btree (attendance_date);

CREATE INDEX idx_clients_client_name ON public.clients USING btree (client_name);

CREATE INDEX idx_clients_is_active ON public.clients USING btree (is_active);

CREATE INDEX idx_employees_employment_status_id ON public.employees USING btree (employment_status_id);

CREATE INDEX idx_employees_full_name ON public.employees USING btree (full_name);

CREATE INDEX idx_employees_position ON public.employees USING btree ("position");

CREATE INDEX idx_quote_requests_client_id ON public.quote_requests USING btree (client_id);

CREATE INDEX idx_quote_requests_quotation_date ON public.quote_requests USING btree (quotation_date);

CREATE INDEX idx_quote_requests_request_status ON public.quote_requests USING btree (request_status);

CREATE INDEX idx_users_is_active ON public.users USING btree (is_active);

CREATE INDEX idx_users_user_role ON public.users USING btree (user_role);

CREATE UNIQUE INDEX insurance_companies_policy_unique ON public.insurance_companies USING btree (lower(btrim(company_name)), lower(btrim(policy_number)));

CREATE UNIQUE INDEX inventory_items_name_unique ON public.inventory_items USING btree (lower(regexp_replace(btrim((name)::text), '\s+'::text, ' '::text, 'g'::text)));

CREATE INDEX inventory_lots_open_idx ON public.inventory_lots USING btree (item_id, received_at, lot_id) WHERE (qty_remaining > (0)::numeric);

CREATE INDEX inventory_movements_item_idx ON public.inventory_movements USING btree (item_id, created_at);

CREATE INDEX inventory_movements_log_idx ON public.inventory_movements USING btree (log_id);

CREATE INDEX inventory_movements_lot_idx ON public.inventory_movements USING btree (lot_id);

CREATE INDEX inventory_movements_work_order_idx ON public.inventory_movements USING btree (work_order_id);

CREATE INDEX itinerary_crews_employee_id_idx ON public.itinerary_crews USING btree (employee_id);

CREATE INDEX itinerary_crews_itinerary_id_idx ON public.itinerary_crews USING btree (itinerary_id);

CREATE INDEX itinerary_documents_itinerary_id_idx ON public.itinerary_documents USING btree (itinerary_id);

CREATE INDEX leave_requests_employee_idx ON public.leave_requests USING btree (employee_id, status);

CREATE INDEX notifications_employee_created_idx ON public.notifications USING btree (employee_id, created_at DESC);

CREATE UNIQUE INDEX parts_requests_one_open_per_item ON public.parts_requests USING btree (item_id) WHERE (status = 'Open'::text);

CREATE INDEX payroll_payslips_period_idx ON public.payroll_payslips USING btree (payroll_period_start DESC, payroll_id DESC);

CREATE INDEX payslip_line_items_itinerary_id_idx ON public.payslip_line_items USING btree (itinerary_id);

CREATE INDEX payslip_line_items_payroll_id_idx ON public.payslip_line_items USING btree (payroll_id);

CREATE UNIQUE INDEX places_city_barangay_unique_idx ON public.places USING btree (lower(TRIM(BOTH FROM city)), lower(TRIM(BOTH FROM barangay))) WHERE ((city IS NOT NULL) AND (barangay IS NOT NULL));

CREATE INDEX quote_rate_offers_quote_idx ON public.quote_rate_offers USING btree (quote_request_id, offer_id);

CREATE UNIQUE INDEX truck_odometer_log_one_per_trip ON public.truck_odometer_log USING btree (itinerary_id) WHERE (source = 'trip'::text);

CREATE INDEX truck_odometer_log_plate ON public.truck_odometer_log USING btree (plate_number, recorded_at DESC);

CREATE UNIQUE INDEX users_username_lower_key ON public.users USING btree (lower(TRIM(BOTH FROM username)));

CREATE INDEX work_order_parts_log_completion_id_idx ON public.work_order_parts_log USING btree (completion_id);

CREATE INDEX work_order_parts_log_item_id_idx ON public.work_order_parts_log USING btree (item_id);

CREATE INDEX work_order_parts_log_work_order_id_idx ON public.work_order_parts_log USING btree (work_order_id);

CREATE INDEX work_order_parts_used_completion_id_idx ON public.work_order_parts_used USING btree (completion_id);

CREATE INDEX work_order_parts_used_item_id_idx ON public.work_order_parts_used USING btree (item_id);

CREATE UNIQUE INDEX work_orders_one_open_pms ON public.work_orders USING btree (plate_number) WHERE ((pms_target_km IS NOT NULL) AND (work_order_status = ANY (ARRAY['Created'::work_order_status_enum, 'Scheduled'::work_order_status_enum, 'In Progress'::work_order_status_enum, 'On Hold'::work_order_status_enum])));

-- ===== 9. Functions (77) =====

CREATE OR REPLACE FUNCTION public._cap_ms(t timestamp with time zone)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select (extract(epoch from t) * 1000)::bigint
$function$
;

CREATE OR REPLACE FUNCTION public._inventory_actor(OUT o_employee_id integer, OUT o_role user_role_enum)
 RETURNS record
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select employee_id, user_role from public.users where auth_user_id = auth.uid() limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public._inventory_check_usable(p_item inventory_items)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if p_item.archived_at is not null then
    raise exception '% is archived.', p_item.name;
  end if;
  if p_item.item_type in ('Tools', 'Equipment') then
    raise exception '% is %: tools and equipment are counted, not used up.', p_item.name, lower(p_item.item_type);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public._inventory_open_work_order(p_work_order_id integer, p_role user_role_enum, p_employee_id integer)
 RETURNS work_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_wo public.work_orders;
begin
  select * into v_wo from public.work_orders where work_order_id = p_work_order_id for update;
  if not found then raise exception 'Work order #% not found.', p_work_order_id; end if;
  if v_wo.work_order_status in ('Completed', 'Cancelled') then
    raise exception 'Work order % is already %.', v_wo.work_order_number, v_wo.work_order_status;
  end if;
  if p_role = 'Admin' then return v_wo; end if;
  if p_role = 'Mechanic' and p_employee_id is not null and v_wo.assigned_mechanic_id = p_employee_id then
    return v_wo;
  end if;
  raise exception 'Only the mechanic assigned to work order % (or an Admin) can do this.', v_wo.work_order_number;
end $function$
;

CREATE OR REPLACE FUNCTION public._inventory_put(p_lot_id integer, p_qty numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_item_id integer;
begin
  perform set_config('darch.inventory_write', 'on', true);
  select item_id into v_item_id from public.inventory_lots where lot_id = p_lot_id;
  if not found then raise exception 'Stock batch #% not found.', p_lot_id; end if;
  perform 1 from public.inventory_items where item_id = v_item_id for update;
  update public.inventory_lots set qty_remaining = qty_remaining + p_qty where lot_id = p_lot_id;
  update public.inventory_items set quantity = quantity + p_qty where item_id = v_item_id;
end $function$
;

CREATE OR REPLACE FUNCTION public._inventory_receive(p_item_id integer, p_qty numeric, p_unit_cost numeric, p_received_at timestamp with time zone, p_note text, p_employee_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_lot_id integer;
begin
  perform set_config('darch.inventory_write', 'on', true);
  perform 1 from public.inventory_items where item_id = p_item_id for update;
  if not found then raise exception 'Inventory item #% not found.', p_item_id; end if;
  insert into public.inventory_lots (item_id, received_at, unit_cost, qty_received, qty_remaining, note, employee_id)
  values (p_item_id, p_received_at, p_unit_cost, p_qty, p_qty, p_note, p_employee_id)
  returning lot_id into v_lot_id;
  update public.inventory_items set quantity = quantity + p_qty where item_id = p_item_id;
  return v_lot_id;
end $function$
;

CREATE OR REPLACE FUNCTION public._inventory_take(p_item_id integer, p_qty numeric)
 RETURNS TABLE(o_lot_id integer, o_qty numeric, o_unit_cost numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_item public.inventory_items; v_lot record; v_left numeric := p_qty; v_take numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than 0.'; end if;
  perform set_config('darch.inventory_write', 'on', true);
  select * into v_item from public.inventory_items where item_id = p_item_id for update;
  if not found then raise exception 'Inventory item #% not found.', p_item_id; end if;
  if v_item.quantity < p_qty then
    raise exception 'Only % % of % in stock -- not enough for %.', v_item.quantity, v_item.unit, v_item.name, p_qty;
  end if;
  for v_lot in
    select l.lot_id, l.qty_remaining, l.unit_cost from public.inventory_lots l
     where l.item_id = p_item_id and l.qty_remaining > 0
     order by l.received_at, l.lot_id for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_lot.qty_remaining);
    update public.inventory_lots set qty_remaining = qty_remaining - v_take where lot_id = v_lot.lot_id;
    v_left := v_left - v_take;
    o_lot_id := v_lot.lot_id; o_qty := v_take; o_unit_cost := v_lot.unit_cost;
    return next;
  end loop;
  if v_left > 0 then
    raise exception 'Stock batches for % are short by % -- needs manual review.', v_item.name, v_left;
  end if;
  update public.inventory_items set quantity = quantity - p_qty where item_id = p_item_id;
end $function$
;

CREATE OR REPLACE FUNCTION public._inventory_use_on_completion(p_item inventory_items, p_qty numeric, p_completion_id integer, p_work_order_id integer, p_employee_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_part record;
begin
  for v_part in select * from public._inventory_take(p_item.item_id, p_qty) loop
    insert into public.work_order_parts_used (completion_id, item_id, item_name_text, quantity, unit_cost)
    values (p_completion_id, p_item.item_id, p_item.name, v_part.o_qty, v_part.o_unit_cost);
    insert into public.inventory_movements
      (item_id, lot_id, qty_change, reason, unit_cost, work_order_id, completion_id, employee_id)
    values (p_item.item_id, v_part.o_lot_id, -v_part.o_qty, 'use', v_part.o_unit_cost,
            p_work_order_id, p_completion_id, p_employee_id);
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public._my_employee_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select employee_id from public.users where auth_user_id = auth.uid() limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.accept_quote_counter(p_quote_id bigint, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_trip_plan jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q public.quote_requests;
begin
  if not public.is_staff() then raise exception 'Only staff can accept a counter-offer.'; end if;
  select * into q from public.quote_requests where quote_request_id = p_quote_id for update;
  if not found then raise exception 'Quote not found.'; end if;
  if q.request_status <> 'Countered' then
    raise exception 'This quote has no counter-offer waiting (someone else may have handled it).';
  end if;
  if p_distance_km is null or p_distance_km <= 0 then raise exception 'Enter the distance.'; end if;
  if p_hours_per_trip is null or p_hours_per_trip <= 0 or p_hours_per_trip > 72 then
    raise exception 'Hours per trip must be more than 0 and at most 72.';
  end if;
  if p_cost_per_trip is null or p_cost_per_trip < 0 then raise exception 'The trip cost could not be worked out.'; end if;
  update public.quote_requests set
    estimated_distance_km = p_distance_km,
    hours_per_trip        = p_hours_per_trip,
    cost_per_trip         = p_cost_per_trip,
    trip_plan             = p_trip_plan
  where quote_request_id = p_quote_id;
  insert into public.quote_rate_offers (quote_request_id, party, action, rate, line_rates, pickup_date, deadline_date)
  values (p_quote_id, 'Business', 'Accept', q.proposed_rate, q.line_rates, q.preferred_pickup_date, q.preferred_delivery_date);
  return public.create_booking_from_quote(p_quote_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_stock(p_item_id integer, p_new_quantity numeric, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp integer := public.current_admin_employee_id(); v_item public.inventory_items;
  v_delta numeric; v_part record; v_lot_id integer; v_note text; v_kind text;
begin
  if p_reason is null or p_reason not in ('Count correction', 'Damaged', 'Lost', 'Found', 'Other') then
    raise exception 'Pick a reason for the adjustment.';
  end if;
  if p_reason = 'Other' and coalesce(btrim(p_note), '') = '' then raise exception 'Explain the adjustment.'; end if;
  if p_new_quantity is null or p_new_quantity < 0 then raise exception 'Enter the new quantity (0 or more).'; end if;
  select * into v_item from public.inventory_items where item_id = p_item_id for update;
  if not found then raise exception 'Inventory item #% not found.', p_item_id; end if;
  v_delta := p_new_quantity - v_item.quantity;
  if v_delta = 0 then raise exception 'Stock is already %.', v_item.quantity; end if;
  v_note := p_reason || coalesce(': ' || nullif(btrim(p_note), ''), '');
  v_kind := case when p_reason in ('Damaged', 'Lost') then 'write_off' else 'adjust' end;
  if v_delta < 0 then
    if p_reason = 'Found' then raise exception '"Found" can only add stock.'; end if;
    for v_part in select * from public._inventory_take(p_item_id, -v_delta) loop
      insert into public.inventory_movements (item_id, lot_id, qty_change, reason, unit_cost, employee_id, note)
      values (p_item_id, v_part.o_lot_id, -v_part.o_qty, v_kind, v_part.o_unit_cost, v_emp, v_note);
    end loop;
  else
    if p_reason in ('Damaged', 'Lost') then raise exception '"%" can only take stock off.', p_reason; end if;
    v_lot_id := public._inventory_receive(p_item_id, v_delta, v_item.unit_cost, now(), v_note, v_emp);
    insert into public.inventory_movements (item_id, lot_id, qty_change, reason, unit_cost, employee_id, note)
    values (p_item_id, v_lot_id, v_delta, 'adjust', v_item.unit_cost, v_emp, v_note);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.adjust_stock_by(p_item_id integer, p_change numeric, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_item public.inventory_items;
begin
  perform public.current_admin_employee_id();   -- Admins only
  if p_change is null or p_change = 0 then
    raise exception 'Enter a quantity more than 0.';
  end if;
  select * into v_item from public.inventory_items where item_id = p_item_id for update;
  if not found then raise exception 'Inventory item #% not found.', p_item_id; end if;
  if v_item.quantity + p_change < 0 then
    raise exception 'Only % % of % on hand -- can''t remove %.',
      v_item.quantity, v_item.unit, v_item.name, -p_change;
  end if;
  -- same rules and record as before (reasons, oldest batch first, write-offs)
  perform public.adjust_stock(p_item_id, v_item.quantity + p_change, p_reason, p_note);
end $function$
;

CREATE OR REPLACE FUNCTION public.attach_payment_proof(p_payment_id integer, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_booking integer;
begin
  perform current_admin_employee_id();   -- raises "Admins only"
  select booking_id into v_booking from booking_payments where payment_id = p_payment_id;
  if v_booking is null then raise exception 'Payment not found.'; end if;
  if p_path is null or p_path not like v_booking || '/%' then
    raise exception 'That file does not belong to this booking.';
  end if;
  update booking_payments set proof_path = p_path
   where payment_id = p_payment_id and proof_path is null;
  if not found then raise exception 'This payment already has a proof attached.'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.booking_downpayment(p_booking_id integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
           when b.cost_per_trip is null or b.rate_of_delivery_service is null then null
           else round(
             t.n * b.cost_per_trip
             + 0.25 * greatest(t.contract - t.n * b.cost_per_trip, 0),
             2)
         end
  from bookings b
  cross join lateral (
    select count(*) as n,
           coalesce(sum(coalesce(i.trip_rate, b.rate_of_delivery_service)), 0) as contract
    from itineraries i
    where i.booking_id = b.booking_id and i.itinerary_status <> 'Cancelled'
  ) t
  where b.booking_id = p_booking_id
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_trip_documents(p_itinerary_id integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    exists (
      select 1
      from public.itinerary_crews ic
      join public.users u on u.employee_id = ic.employee_id
      where ic.itinerary_id = p_itinerary_id
        and ic.is_active = true
        and u.auth_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.itineraries i
      join public.bookings b on b.booking_id = i.booking_id
      join public.users u on u.client_id = b.client_id
      where i.itinerary_id = p_itinerary_id
        and u.auth_user_id = auth.uid()
    );
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_work_order_parts(p_work_order_id integer, p_mode text, p_reason text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor record; v_log record; v_n integer := 0;
begin
  if p_mode not in ('return', 'write_off') then raise exception 'Choose return or write_off.'; end if;
  select * into v_actor from public._inventory_actor();
  perform public._inventory_open_work_order(p_work_order_id, v_actor.o_role, v_actor.o_employee_id);
  if p_mode = 'write_off' then
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Give a reason for keeping the parts as used.';
    end if;
    update public.inventory_movements m
       set reason = 'write_off', note = btrim(p_reason)
      from public.work_order_parts_log l
     where m.log_id = l.log_id and l.work_order_id = p_work_order_id
       and l.completion_id is null and m.reason = 'use';
    get diagnostics v_n = row_count;
    return v_n;
  end if;
  for v_log in
    select l.log_id from public.work_order_parts_log l
     where l.work_order_id = p_work_order_id and l.completion_id is null
     order by l.log_id
  loop
    perform public.return_logged_part(v_log.log_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.change_my_username(p_username text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name    text := btrim(p_username);
  v_user_id integer;
begin
  select user_id into v_user_id
  from users
  where auth_user_id = auth.uid() and user_role = 'Client';
  if v_user_id is null then
    raise exception 'Only a client can change their username here.';
  end if;

  if v_name !~ '^[A-Za-z0-9._-]{3,30}$' then
    raise exception 'Username: 3–30 characters, letters, numbers, dot, underscore or dash only.';
  end if;

  if exists (
    select 1 from users
    where lower(username) = lower(v_name) and user_id <> v_user_id
  ) then
    raise exception 'That username is already taken. Try another.';
  end if;

  update users set username = v_name where user_id = v_user_id;
end;
$function$
;

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
  if coalesce(new.itinerary_status, 'Awaiting') in ('Delivered', 'Cancelled')
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
     and coalesce(i.itinerary_status, 'Awaiting') not in ('Delivered', 'Cancelled')
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
$function$
;

CREATE OR REPLACE FUNCTION public.close_part_request(p_request_id integer, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer := public.current_admin_employee_id();   -- Admins only
begin
  update public.parts_requests
     set status = 'Done', resolved_at = now(), resolved_by = v_emp,
         resolution_note = coalesce(nullif(btrim(p_note), ''), 'Closed without restocking')
   where request_id = p_request_id and status = 'Open';
  if not found then raise exception 'This request was already closed.'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.complete_work_order(p_work_order_id integer, p_description text, p_odometer numeric DEFAULT NULL::numeric, p_next_service_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_parts jsonb DEFAULT '[]'::jsonb, p_new_items jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor record; v_wo public.work_orders; v_completion_id integer; v_row record;
  v_item public.inventory_items; v_truck record; v_lot_id integer;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select * into v_actor from public._inventory_actor();
  if v_actor.o_employee_id is null then
    raise exception 'Your login has no employee record linked, so the completion can''t be saved under your name.';
  end if;
  v_wo := public._inventory_open_work_order(p_work_order_id, v_actor.o_role, v_actor.o_employee_id);
  if coalesce(btrim(p_description), '') = '' then raise exception 'Enter a description of the work done.'; end if;
  if p_odometer is not null and p_odometer < 0 then raise exception 'Enter a valid odometer reading.'; end if;

  -- Truck odometer must go up (checked before anything is saved)
  if v_wo.plate_number is not null and (p_odometer is not null or p_next_service_date is not null) then
    select current_odometer into v_truck from public.truck_profiles
     where plate_number = v_wo.plate_number for update;
    if not found then raise exception 'Truck % not found.', v_wo.plate_number; end if;
    if p_odometer is not null and v_truck.current_odometer is not null
       and p_odometer <= v_truck.current_odometer then
      raise exception 'Odometer reading must be higher than the truck''s current recorded value (%).', v_truck.current_odometer;
    end if;
  end if;

  insert into public.work_order_completions
    (work_order_id, employee_id, description, odometer_reading, next_service_date, notes, completed_at)
  values (p_work_order_id, v_actor.o_employee_id, btrim(p_description),
          case when v_wo.plate_number is not null then p_odometer end,
          p_next_service_date, nullif(btrim(p_notes), ''), now())
  returning completion_id into v_completion_id;

  -- Parts logged during the job (already out of stock) -> onto this completion
  update public.work_order_parts_log l set completion_id = v_completion_id
   where l.work_order_id = p_work_order_id and l.completion_id is null
     and not exists (select 1 from public.inventory_movements m
                      where m.log_id = l.log_id and m.reason = 'write_off');
  insert into public.work_order_parts_used (completion_id, item_id, item_name_text, quantity, unit_cost)
  select v_completion_id, item_id, item_name_text, quantity, unit_cost
    from public.work_order_parts_log where completion_id = v_completion_id order by log_id;
  update public.inventory_movements m set completion_id = v_completion_id
    from public.work_order_parts_log l
   where m.log_id = l.log_id and l.completion_id = v_completion_id;

  -- Parts entered on the form (the same item on several rows is added together)
  for v_row in
    select (e->>'item_id')::integer as item_id, sum((e->>'quantity')::numeric) as qty
      from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) e
     group by 1 order by 1
  loop
    if v_row.item_id is null then raise exception 'A part row has no item selected.'; end if;
    select * into v_item from public.inventory_items where item_id = v_row.item_id;
    if not found then raise exception 'Inventory item #% not found.', v_row.item_id; end if;
    perform public._inventory_check_usable(v_item);
    perform public._inventory_use_on_completion(v_item, v_row.qty, v_completion_id, p_work_order_id, v_actor.o_employee_id);
  end loop;

  -- Brand-new items (D2): no price, no extra stock -- received N, used N, flagged Needs price
  for v_row in
    select e->>'name' as name, e->>'item_type' as item_type,
           coalesce(e->>'unit', 'pcs') as unit, (e->>'quantity')::numeric as qty
      from jsonb_array_elements(coalesce(p_new_items, '[]'::jsonb)) e
  loop
    if coalesce(btrim(v_row.name), '') = '' then raise exception 'Enter a name for the new item.'; end if;
    if v_row.item_type is null or v_row.item_type not in ('Parts', 'Supplies', 'Other') then
      raise exception 'A new item used on a job must be Parts, Supplies or Other.';
    end if;
    if v_row.qty is null or v_row.qty <= 0 then
      raise exception 'Enter how many of "%" were used.', btrim(v_row.name);
    end if;
    begin
      insert into public.inventory_items (name, item_type, unit, quantity, unit_cost, needs_price)
      values (regexp_replace(btrim(v_row.name), '\s+', ' ', 'g'), v_row.item_type, v_row.unit, 0, null, true)
      returning * into v_item;
    exception when unique_violation then
      raise exception '"%" is already in inventory -- pick it from the list instead.', btrim(v_row.name);
    end;
    v_lot_id := public._inventory_receive(v_item.item_id, v_row.qty, null, now(),
                  'Added by mechanic on ' || v_wo.work_order_number, v_actor.o_employee_id);
    insert into public.inventory_movements
      (item_id, lot_id, qty_change, reason, work_order_id, completion_id, employee_id, note)
    values (v_item.item_id, v_lot_id, v_row.qty, 'receive', p_work_order_id, v_completion_id,
            v_actor.o_employee_id, 'Added on the job -- needs a price');
    perform public._inventory_use_on_completion(v_item, v_row.qty, v_completion_id, p_work_order_id, v_actor.o_employee_id);
  end loop;

  update public.work_orders set work_order_status = 'Completed' where work_order_id = p_work_order_id;

  if v_wo.plate_number is not null and (p_odometer is not null or p_next_service_date is not null) then
    update public.truck_profiles
       set current_odometer = coalesce(p_odometer, current_odometer),
           next_service_date = coalesce(p_next_service_date, next_service_date),
           last_service_date = case when p_next_service_date is not null then v_today else last_service_date end
     where plate_number = v_wo.plate_number;
  end if;

  return v_completion_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.count_bookings_for_clients(client_ids integer[])
 RETURNS TABLE(client_id integer, booking_count integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select client_id, count(*)::integer as booking_count
  from public.bookings
  where client_id = any(client_ids)
  group by client_id;
$function$
;

CREATE OR REPLACE FUNCTION public.create_bill(p_category text, p_description text, p_amount numeric, p_creditor_id integer DEFAULT NULL::integer, p_bill_date date DEFAULT NULL::date, p_due_date date DEFAULT NULL::date, p_reference_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_paid_now boolean DEFAULT false, p_method text DEFAULT 'Cash'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer; v_id integer; v_date date;
begin
  v_emp  := public.current_admin_employee_id();
  v_date := coalesce(p_bill_date, (now() at time zone 'Asia/Manila')::date);
  insert into public.bills
    (creditor_id, category, description, bill_date, due_date, amount, reference_no, note, created_by)
  values
    (p_creditor_id, p_category, trim(p_description), v_date, p_due_date, p_amount,
     nullif(trim(p_reference_no), ''), nullif(trim(p_note), ''), v_emp)
  returning bill_id into v_id;
  if p_paid_now then
    insert into public.bill_payments (bill_id, amount, paid_on, method, reference_no, recorded_by)
    values (v_id, p_amount, v_date, p_method, nullif(trim(p_reference_no), ''), v_emp);
  end if;
  return v_id;
end $function$
;

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
    rate_of_delivery_service, hours_per_trip, cost_per_trip, storage_deadline, is_last_day_of_port_storage
  ) values (
    p_quote_id, v_client_id, v_pickup_id, v_delivery_id,
    nullif(q.pickup_location_text, ''), nullif(q.delivery_location_text, ''), q.pickup_landmark, q.delivery_landmark,
    q.pickup_lat, q.pickup_lng, q.delivery_lat, q.delivery_lng,
    q.payment_terms, 'Confirmed', q.preferred_pickup_date, q.estimated_distance_km,
    v_avg, q.hours_per_trip, q.cost_per_trip,
    case when v_urgent then q.preferred_pickup_date end, v_urgent
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
        plate_number, trailer_id
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
        (v_slot->>'trailer_id')::int
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_inventory_item(p_name text, p_item_type text, p_unit text, p_quantity numeric, p_unit_cost numeric, p_reorder_level numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer := public.current_admin_employee_id(); v_id integer; v_lot_id integer;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter an item name.'; end if;
  if p_item_type is null or p_item_type not in ('Tools', 'Parts', 'Supplies', 'Equipment', 'Other') then
    raise exception 'Pick an item type.';
  end if;
  if p_quantity is null or p_quantity < 0 then raise exception 'Enter a valid quantity (0 or more).'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Enter the unit price (0 or more).'; end if;
  begin
    insert into public.inventory_items (name, item_type, unit, quantity, unit_cost, reorder_level)
    values (regexp_replace(btrim(p_name), '\s+', ' ', 'g'), p_item_type, coalesce(p_unit, 'pcs'), 0,
            p_unit_cost, p_reorder_level)
    returning item_id into v_id;
  exception when unique_violation then
    raise exception 'An item called "%" already exists.', btrim(p_name);
  end;
  if p_quantity > 0 then
    v_lot_id := public._inventory_receive(v_id, p_quantity, p_unit_cost, now(), 'Starting stock', v_emp);
    insert into public.inventory_movements (item_id, lot_id, qty_change, reason, unit_cost, employee_id, note)
    values (v_id, v_lot_id, p_quantity, 'opening', p_unit_cost, v_emp, 'Starting stock');
  end if;
  return v_id;
end $function$
;

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
    and other.itinerary_status not in ('Delivered', 'Cancelled')
    and other.trip_start_at < me.trip_end_at
    and (case when other.itinerary_status <> 'Awaiting'
              then greatest(other.trip_end_at, now())
              else other.trip_end_at end) > me.trip_start_at
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.current_admin_employee_id()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer;
begin
  select employee_id into v_emp from public.users
   where auth_user_id = auth.uid() and user_role = 'Admin';
  if not found then raise exception 'Admins only'; end if;
  return v_emp;   -- may be null if the admin has no employees row linked
end $function$
;

CREATE OR REPLACE FUNCTION public.discard_draft_payslip(p_payroll_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from users where auth_user_id = auth.uid() and user_role = 'Admin'
  ) then
    raise exception 'Admins only';
  end if;

  perform 1 from payroll_payslips
   where payroll_id = p_payroll_id and finalized_at is null
   for update;
  if not found then
    raise exception 'Payslip #% is not a draft any more (already finalized or gone).', p_payroll_id;
  end if;

  update employee_attendance set paid_payroll_id = null where paid_payroll_id = p_payroll_id;
  delete from payslip_line_items where payroll_id = p_payroll_id;
  delete from payroll_payslips where payroll_id = p_payroll_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.free_vehicles_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.itinerary_status = 'Delivered'
     and old.itinerary_status is distinct from 'Delivered' then
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
            and i.itinerary_status in ('Dispatched','PickedUp','InTransit'));
    end if;
    if new.trailer_id is not null then
      update trailers set current_status = 'Available'
      where trailer_id = new.trailer_id
        and current_status = 'In Transit'
        and not exists (
          select 1 from itineraries i
          where i.trailer_id = new.trailer_id
            and i.itinerary_id <> new.itinerary_id
            and i.itinerary_status in ('Dispatched','PickedUp','InTransit'));
    end if;
  end if;
  return new;
end;
$function$
;

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
     where coalesce(i.itinerary_status, 'Awaiting') not in ('Delivered', 'Cancelled')
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
        'end', public._cap_ms(case when coalesce(i.itinerary_status, 'Awaiting') not in ('Awaiting', 'Delivered')
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
            or coalesce(i.itinerary_status, 'Awaiting') not in ('Awaiting', 'Delivered'))
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_login_email(p_username text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select au.email
  from public.users u
  join auth.users au on au.id = u.auth_user_id
  where lower(trim(u.username)) = lower(trim(p_username))
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_profile()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object(
    'employee_id', e.employee_id,
    'full_name', e.full_name,
    'position', e.position::text,
    'hire_date', e.hire_date,
    'phone_number', e.phone_number,
    'date_of_birth', e.date_of_birth,
    'email', e.email,
    'address', e.address,
    'city', e.city,
    'province', e.province,
    'zip_code', e.zip_code,
    'emergency_contact_name', e.emergency_contact_name,
    'emergency_contact_number', e.emergency_contact_number,
    'tin_number', e.tin_number,
    'sss_number', e.sss_number,
    'philhealth_number', e.philhealth_number,
    'pagibig_number', e.pagibig_number
  )
  from public.employees e
  join public.users u on u.employee_id = e.employee_id
  where u.auth_user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.get_trip_client_and_rate(p_itinerary_id integer)
 RETURNS TABLE(client_name text, rate_of_delivery_service numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.client_name::text, coalesce(i.trip_rate, b.rate_of_delivery_service)
  from itineraries i
  join bookings b on b.booking_id = i.booking_id
  join clients c on c.client_id = b.client_id
  where i.itinerary_id = p_itinerary_id
    and exists (
      select 1 from itinerary_crews ic
      where ic.itinerary_id = i.itinerary_id
        and ic.is_active = true
        and ic.employee_id = (select employee_id from users where auth_user_id = auth.uid())
    );
$function$
;

CREATE OR REPLACE FUNCTION public.get_trip_payment_status(p_itinerary_id integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booking integer; v_rate numeric; v_amount_to_pay numeric; v_paid numeric;
  v_terms text; v_waived timestamptz; v_contract numeric; v_damage numeric;
  v_owed numeric; v_dp numeric;
begin
  -- Only the trip's active crew may ask.
  if not exists (
    select 1 from itinerary_crews c join users u on u.employee_id = c.employee_id
    where c.itinerary_id = p_itinerary_id and c.is_active and u.auth_user_id = auth.uid()
  ) then
    return null;
  end if;

  select b.booking_id, b.rate_of_delivery_service, b.amount_to_pay, coalesce(b.amount_paid, 0),
         b.payment_terms, b.downpayment_waived_at
    into v_booking, v_rate, v_amount_to_pay, v_paid, v_terms, v_waived
  from itineraries i join bookings b on b.booking_id = i.booking_id
  where i.itinerary_id = p_itinerary_id;

  -- Whole contract = each live trip's own rate.
  select coalesce(sum(coalesce(trip_rate, v_rate, 0)), 0) into v_contract
    from itineraries
   where booking_id = v_booking and itinerary_status <> 'Cancelled';
  select coalesce(sum(d.estimated_damage_cost), 0) into v_damage
    from delivery_damage_records d join itineraries i on i.itinerary_id = d.itinerary_id
   where i.booking_id = v_booking and d.damage_status = 'Approved' and d.charge_to = 'Client';

  -- Whole contract (or staff's override) + approved client damage.
  v_owed := coalesce(v_amount_to_pay, v_contract) + v_damage;
  if v_paid >= v_owed then return 'paid'; end if;

  -- Credit terms: fine to unload once the downpayment is settled (or waived / not required).
  v_dp := booking_downpayment(v_booking);
  if coalesce(v_terms, 'Cash') <> 'Cash'
     and (v_dp is null or v_paid >= v_dp or v_waived is not null) then
    return 'terms';
  end if;

  return 'unpaid';
end $function$
;

CREATE OR REPLACE FUNCTION public.get_trip_storage_deadline(p_itinerary_id integer)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select b.storage_deadline
  from public.itineraries i
  join public.bookings b on b.booking_id = i.booking_id
  where i.itinerary_id = p_itinerary_id
    and exists (
      select 1
      from public.itinerary_crews c
      join public.users u on u.employee_id = c.employee_id
      where c.itinerary_id = i.itinerary_id
        and c.is_active
        and u.auth_user_id = auth.uid()
    );
$function$
;

CREATE OR REPLACE FUNCTION public.handle_client_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_client_id int;
  v_username text := trim(new.raw_user_meta_data->>'username');
  v_phone text := new.raw_user_meta_data->>'phone_number';
begin
  if coalesce(new.raw_user_meta_data->>'sign_up_as_client', '') <> 'true' then
    return new;
  end if;

  -- Same rules as the sign-up form and complete_client_signup.
  if v_username is null or length(v_username) < 3
     or v_username like '%@%' or v_username ~ '\s' then
    raise exception 'Invalid username';
  end if;
  if exists (select 1 from public.users where lower(username) = lower(v_username)) then
    raise exception 'That username is already taken';
  end if;
  if v_phone is null or v_phone !~ '^09[0-9]{9}$' then
    raise exception 'Invalid phone number';
  end if;
  if coalesce(trim(new.raw_user_meta_data->>'client_name'), '') = '' then
    raise exception 'Name is required';
  end if;

  -- A client staff already created for this email (e.g. from a phone quote)
  -- and that has no login yet: link the new account to it, so its old
  -- bookings and quotes show up.
  select c.client_id into new_client_id
    from public.clients c
   where lower(c.email) = lower(new.email)
     and not exists (select 1 from public.users u where u.client_id = c.client_id)
   order by c.client_id
   limit 1;

  if new_client_id is null then
    insert into public.clients (client_name, email, phone_number)
    values (trim(new.raw_user_meta_data->>'client_name'), new.email, v_phone)
    returning client_id into new_client_id;
  else
    update public.clients
       set phone_number = coalesce(nullif(phone_number, ''), v_phone)
     where client_id = new_client_id;
  end if;

  insert into public.users (email, username, user_role, client_id, auth_user_id)
  values (new.email, v_username, 'Client', new_client_id, new.id);

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_items_guard_quantity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if coalesce(current_setting('darch.inventory_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.quantity <> 0 then
    raise exception 'New items start at 0 -- add stock through Add Item or Receive Stock.';
  elsif tg_op = 'UPDATE' and new.quantity is distinct from old.quantity then
    raise exception 'Stock can only change through stock movements (parts used, Receive / Adjust Stock).';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.users
    where users.auth_user_id = auth.uid()
    and users.user_role = 'Admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.users
    where users.auth_user_id = auth.uid()
    and users.user_role in ('Admin', 'Dispatcher')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.itineraries_after_reschedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_conflict integer;
begin
  if new.trip_start_at is not distinct from old.trip_start_at
     and new.trip_end_at is not distinct from old.trip_end_at then
    return new;
  end if;

  for r in
    select c.employee_id, e.full_name
    from itinerary_crews c left join employees e on e.employee_id = c.employee_id
    where c.itinerary_id = new.itinerary_id and c.is_active and c.crew_role in ('Driver', 'Helper')
  loop
    perform pg_advisory_xact_lock(4242, r.employee_id);
    v_conflict := crew_slot_conflict(r.employee_id, new.itinerary_id);
    if v_conflict is not null then
      raise exception 'That time overlaps trip #% for %. Reassign one of the trips first.',
        v_conflict, coalesce(r.full_name, 'the assigned crew');
    end if;
    if old.trip_start_at is not null then
      insert into notifications (employee_id, kind, itinerary_id)
      values (r.employee_id, 'rescheduled', new.itinerary_id);
    end if;
  end loop;

  insert into itinerary_schedule_logs (itinerary_id, old_start, old_end, new_start, new_end, changed_by)
  values (new.itinerary_id, old.trip_start_at, old.trip_end_at, new.trip_start_at, new.trip_end_at,
          (select employee_id from users where auth_user_id = auth.uid()));
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.itinerary_crews_check_slot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_conflict integer; v_name text;
begin
  if not coalesce(new.is_active, true) or new.crew_role not in ('Driver', 'Helper') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active
     and old.employee_id = new.employee_id and old.itinerary_id = new.itinerary_id then
    return new;
  end if;

  -- one assignment per person at a time, so two dispatchers can't both slip them in
  perform pg_advisory_xact_lock(4242, new.employee_id);
  v_conflict := crew_slot_conflict(new.employee_id, new.itinerary_id);
  if v_conflict is not null then
    select full_name into v_name from employees where employee_id = new.employee_id;
    raise exception '% is already on trip #% at that time.', coalesce(v_name, 'This person'), v_conflict;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.itinerary_crews_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.crew_role not in ('Driver', 'Helper') then return new; end if;
  if tg_op = 'INSERT' and coalesce(new.is_active, true) then
    insert into notifications (employee_id, kind, itinerary_id)
    values (new.employee_id, 'assigned', new.itinerary_id);
  elsif tg_op = 'UPDATE' and old.is_active and not new.is_active then
    insert into notifications (employee_id, kind, itinerary_id)
    values (old.employee_id, 'removed', old.itinerary_id);
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.itinerary_slot_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_hours numeric;
begin
  if new.trip_start_at is null then
    new.trip_end_at := null;
    return new;
  end if;

  if new.trip_end_at is null then
    select hours_per_trip into v_hours from bookings where booking_id = new.booking_id;
    if v_hours is null then
      raise exception 'Set the booking''s hours per trip first.';
    end if;
    new.trip_end_at := new.trip_start_at + make_interval(secs => (v_hours * 3600)::double precision);
  elsif tg_op = 'UPDATE'
        and old.trip_start_at is not null
        and new.trip_start_at is distinct from old.trip_start_at
        and new.trip_end_at is not distinct from old.trip_end_at then
    new.trip_end_at := new.trip_start_at + (old.trip_end_at - old.trip_start_at);
  end if;

  if new.trip_end_at <= new.trip_start_at then
    raise exception 'A trip has to end after it starts.';
  end if;

  new.trip_date_from := (new.trip_start_at at time zone 'Asia/Manila')::date;
  new.trip_date_to   := (new.trip_end_at   at time zone 'Asia/Manila')::date;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.itinerary_trailer_fits()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  t record;
begin
  if new.trailer_id is null then
    return new;
  end if;
  select trailer_type, trailer_size, plate_number into t
  from public.trailers where trailer_id = new.trailer_id;
  if not found then
    return new;
  end if;

  -- Size: a 40ft trailer may take a 20ft trip, never the reverse -- unless the
  -- trip is "only a 20 ft trailer" (exact_trailer_size). Unknown = no rule.
  -- Same rule as sizeAllowed() in src/lib/trailerRules.ts -- change both.
  if new.container_type is not null and t.trailer_size is not null
     and new.container_type <> t.trailer_size
     and (new.exact_trailer_size
          or not (new.container_type = '20ft' and t.trailer_size = '40ft')) then
    raise exception 'Trailer % is %; trip #% needs a % trailer%.',
      coalesce(t.plate_number, '#' || new.trailer_id), t.trailer_size, new.itinerary_id, new.container_type,
      case when new.exact_trailer_size then ' (exact size only)' else '' end
      using errcode = 'check_violation';
  end if;

  -- Type: exact, except a container may use Flatbed or Skeletal.
  if new.trailer_type is not null and t.trailer_type is not null
     and t.trailer_type <> new.trailer_type
     and not (new.cargo_type = 'Container'
              and new.trailer_type in ('Flatbed', 'Skeletal')
              and t.trailer_type in ('Flatbed', 'Skeletal')) then
    raise exception 'Trailer % is a %; trip #% needs a % trailer.',
      coalesce(t.plate_number, '#' || new.trailer_id), t.trailer_type, new.itinerary_id, new.trailer_type
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.itinerary_trip_rate_default()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.trip_rate is null then
    select rate_of_delivery_service into new.trip_rate
    from public.bookings where booking_id = new.booking_id;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.log_part_used(p_work_order_id integer, p_item_id integer, p_quantity numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor record; v_item public.inventory_items; v_part record; v_log_id integer;
begin
  select * into v_actor from public._inventory_actor();
  if v_actor.o_employee_id is null then
    raise exception 'Your login has no employee record linked, so parts can''t be logged under your name.';
  end if;
  perform public._inventory_open_work_order(p_work_order_id, v_actor.o_role, v_actor.o_employee_id);
  select * into v_item from public.inventory_items where item_id = p_item_id;
  if not found then raise exception 'Inventory item #% not found.', p_item_id; end if;
  perform public._inventory_check_usable(v_item);
  for v_part in select * from public._inventory_take(p_item_id, p_quantity) loop
    insert into public.work_order_parts_log (work_order_id, item_id, item_name_text, quantity, unit_cost, employee_id)
    values (p_work_order_id, p_item_id, v_item.name, v_part.o_qty, v_part.o_unit_cost, v_actor.o_employee_id)
    returning log_id into v_log_id;
    insert into public.inventory_movements
      (item_id, lot_id, qty_change, reason, unit_cost, work_order_id, log_id, employee_id)
    values (p_item_id, v_part.o_lot_id, -v_part.o_qty, 'use', v_part.o_unit_cost,
            p_work_order_id, v_log_id, v_actor.o_employee_id);
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.parts_requests_close_on_receive()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.reason = 'receive' then
    update public.parts_requests
       set status = 'Done', resolved_at = now(), resolved_by = new.employee_id,
           resolution_note = 'Stock received'
     where item_id = new.item_id and status = 'Open';
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.pms_auto_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_interval numeric; v_soon numeric; v_target numeric; v_per_day numeric; v_expected text := '';
begin
  if new.last_pms_odometer is null or new.current_odometer is null then return new; end if;
  select setting_value into v_interval from app_settings where setting_key = 'pms_interval_km';
  select setting_value into v_soon from app_settings where setting_key = 'pms_due_soon_km';
  v_interval := coalesce(v_interval, 1000);
  v_soon := coalesce(v_soon, 200);
  if v_interval <= 0 then return new; end if;

  v_target := new.last_pms_odometer + v_interval;
  if new.current_odometer < v_target - v_soon then return new; end if;

  -- Expected date from the truck's last 30 days of trip km (text only: a
  -- scheduled_start_date would make Fleet Match block the truck).
  select sum(km_added) / 30 into v_per_day from truck_odometer_log
  where plate_number = new.plate_number and source = 'trip' and recorded_at > now() - interval '30 days';
  if new.current_odometer >= v_target then
    v_expected := ' Due now.';
  elsif coalesce(v_per_day, 0) > 0 then
    v_expected := ' Expected around ' || to_char(
      (now() at time zone 'Asia/Manila')::date + ceil((v_target - new.current_odometer) / v_per_day)::int,
      'Mon DD, YYYY') || ' at the current pace.';
  end if;

  insert into work_orders (work_order_number, plate_number, trailer_id, assigned_mechanic_id,
                           maintenance_type, work_description, pms_target_km)
  values ('WO-' || new.plate_number || '-' || (extract(epoch from clock_timestamp()) * 1000)::bigint,
          new.plate_number, null, null, 'Preventive',
          format('PMS due at %s km (every %s km). Created automatically at %s km.',
                 to_char(v_target, 'FM999,999,990'), to_char(v_interval, 'FM999,999,990'),
                 to_char(new.current_odometer, 'FM999,999,990')) || v_expected,
          v_target)
  on conflict (plate_number)
    where pms_target_km is not null
      and work_order_status in ('Created', 'Scheduled', 'In Progress', 'On Hold')
  do nothing;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.pms_reset_on_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_plate text; v_target numeric;
begin
  select plate_number, pms_target_km into v_plate, v_target
  from work_orders where work_order_id = new.work_order_id;
  if v_target is null or v_plate is null then return new; end if;
  update truck_profiles
     set last_pms_odometer = coalesce(new.odometer_reading, current_odometer)
   where plate_number = v_plate;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.post_stock_count(p_counts jsonb, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_emp integer := public.current_admin_employee_id();   -- Admins only
  v_row record; v_item public.inventory_items; v_delta numeric; v_part record;
  v_lot_id integer; v_changed text[] := '{}'; v_n integer := 0;
  v_note text := 'Stocktake' || coalesce(': ' || nullif(btrim(p_note), ''), '');
begin
  -- 1. Lock every item (in id order, so two posts can't deadlock) and check nothing moved
  for v_row in
    select (e->>'item_id')::integer as item_id, (e->>'expected')::numeric as expected,
           (e->>'counted')::numeric as counted
      from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) e order by 1
  loop
    if v_row.counted is null or v_row.counted < 0 then
      raise exception 'Counted quantities must be 0 or more.';
    end if;
    select * into v_item from public.inventory_items where item_id = v_row.item_id for update;
    if not found then raise exception 'Inventory item #% not found.', v_row.item_id; end if;
    if v_item.quantity is distinct from v_row.expected then
      v_changed := v_changed || v_item.name::text;
    end if;
  end loop;
  if array_length(v_changed, 1) > 0 then
    raise exception 'Stock changed while you were counting: %. Close the stocktake, reopen it and recount those.',
      array_to_string(v_changed, ', ');
  end if;

  -- 2. Post the differences as 'count' movements
  for v_row in
    select (e->>'item_id')::integer as item_id, (e->>'counted')::numeric as counted
      from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) e order by 1
  loop
    select * into v_item from public.inventory_items where item_id = v_row.item_id;
    v_delta := v_row.counted - v_item.quantity;
    continue when v_delta = 0;
    if v_delta < 0 then
      for v_part in select * from public._inventory_take(v_item.item_id, -v_delta) loop
        insert into public.inventory_movements (item_id, lot_id, qty_change, reason, unit_cost, employee_id, note)
        values (v_item.item_id, v_part.o_lot_id, -v_part.o_qty, 'count', v_part.o_unit_cost, v_emp, v_note);
      end loop;
    else
      v_lot_id := public._inventory_receive(v_item.item_id, v_delta, v_item.unit_cost, now(), v_note, v_emp);
      insert into public.inventory_movements (item_id, lot_id, qty_change, reason, unit_cost, employee_id, note)
      values (v_item.item_id, v_lot_id, v_delta, 'count', v_item.unit_cost, v_emp, v_note);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.quote_average_rate(p_cargo_lines jsonb, p_line_rates jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
declare total numeric := 0; trips int := 0; i int; r numeric; qty int;
begin
  if p_cargo_lines is null or jsonb_typeof(p_cargo_lines) <> 'array'
     or jsonb_array_length(p_cargo_lines) = 0 then
    raise exception 'This quote has no cargo lines.';
  end if;
  if p_line_rates is null or jsonb_typeof(p_line_rates) <> 'array'
     or jsonb_array_length(p_line_rates) <> jsonb_array_length(p_cargo_lines) then
    raise exception 'Enter a rate for every cargo line.';
  end if;
  for i in 0 .. jsonb_array_length(p_cargo_lines) - 1 loop
    if jsonb_typeof(p_line_rates -> i) <> 'number' then
      raise exception 'Line % rate must be a number.', i + 1;
    end if;
    r := (p_line_rates ->> i)::numeric;
    if r <= 0 or r <> round(r, 2) then
      raise exception 'Line % rate must be more than 0, with at most 2 decimals.', i + 1;
    end if;
    qty := greatest(coalesce((p_cargo_lines -> i ->> 'quantity')::int, 1), 1);
    total := total + r * qty;
    trips := trips + qty;
  end loop;
  return round(total / trips, 2);
end $function$
;

CREATE OR REPLACE FUNCTION public.receive_stock(p_item_id integer, p_quantity numeric, p_unit_cost numeric, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer := public.current_admin_employee_id(); v_item public.inventory_items; v_lot_id integer;
begin
  if p_quantity is null or p_quantity <= 0 then raise exception 'Enter a quantity more than 0.'; end if;
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Enter the unit price (0 or more).'; end if;
  select * into v_item from public.inventory_items where item_id = p_item_id;
  if not found then raise exception 'Inventory item #% not found.', p_item_id; end if;
  if v_item.archived_at is not null then raise exception '% is archived.', v_item.name; end if;
  v_lot_id := public._inventory_receive(p_item_id, p_quantity, p_unit_cost, now(), nullif(btrim(p_note), ''), v_emp);
  update public.inventory_items set unit_cost = p_unit_cost where item_id = p_item_id;  -- latest price
  insert into public.inventory_movements (item_id, lot_id, qty_change, reason, unit_cost, employee_id, note)
  values (p_item_id, v_lot_id, p_quantity, 'receive', p_unit_cost, v_emp, nullif(btrim(p_note), ''));
  return v_lot_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_bill_payment(p_bill_id integer, p_amount numeric, p_method text DEFAULT 'Cash'::text, p_paid_on date DEFAULT NULL::date, p_reference_no text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer; v_bill public.bills%rowtype; v_id integer;
begin
  v_emp := public.current_admin_employee_id();
  select * into v_bill from public.bills where bill_id = p_bill_id for update;
  if not found then raise exception 'Bill % not found', p_bill_id; end if;
  if v_bill.voided_at is not null then raise exception 'This bill was voided'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_amount > v_bill.amount - v_bill.amount_paid then
    raise exception 'Payment is more than the % still owed', v_bill.amount - v_bill.amount_paid;
  end if;
  insert into public.bill_payments (bill_id, amount, paid_on, method, reference_no, note, recorded_by)
  values (p_bill_id, p_amount, coalesce(p_paid_on, (now() at time zone 'Asia/Manila')::date),
          p_method, nullif(trim(p_reference_no), ''), nullif(trim(p_note), ''), v_emp)
  returning bill_payment_id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_booking_payment(p_booking_id integer, p_amount numeric, p_method text, p_paid_on date DEFAULT NULL::date, p_reference_no text DEFAULT NULL::text, p_or_number text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_set_amount_to_pay numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer; v_id integer;
begin
  if not exists (select 1 from public.users where auth_user_id = auth.uid() and user_role = 'Admin') then
    raise exception 'Admins only';
  end if;
  if p_amount is null or p_amount = 0 then raise exception 'Amount must not be zero'; end if;
  perform 1 from public.bookings where booking_id = p_booking_id for update;
  if not found then raise exception 'Booking % not found', p_booking_id; end if;

  select employee_id into v_emp from public.users where auth_user_id = auth.uid();
  if p_set_amount_to_pay is not null then
    update public.bookings set amount_to_pay = p_set_amount_to_pay where booking_id = p_booking_id;
  end if;

  insert into public.booking_payments
    (booking_id, amount, method, paid_on, reference_no, or_number, note, recorded_by)
  values
    (p_booking_id, p_amount, p_method,
     coalesce(p_paid_on, (now() at time zone 'Asia/Manila')::date),
     nullif(trim(p_reference_no), ''), nullif(trim(p_or_number), ''), nullif(trim(p_note), ''), v_emp)
  returning payment_id into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_odometer_reading(p_plate_number text, p_reading numeric, p_note text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_current numeric; v_floor numeric;
begin
  if not is_admin() then raise exception 'Only Admin can enter odometer readings.'; end if;
  if p_reading is null or p_reading < 0 or p_reading > 9999999 then
    raise exception 'Enter a valid odometer reading.';
  end if;
  select current_odometer into v_current from truck_profiles where plate_number = p_plate_number for update;
  if not found then raise exception 'Truck % not found.', p_plate_number; end if;
  select reading into v_floor from truck_odometer_log
  where plate_number = p_plate_number and source in ('reading', 'edit')
  order by recorded_at desc, log_id desc limit 1;
  if v_floor is not null and p_reading < v_floor then
    raise exception 'The last real reading for % was % km. An odometer can''t go back.', p_plate_number, v_floor;
  end if;

  perform set_config('darch.odometer_write', 'on', true);
  update truck_profiles set current_odometer = p_reading, updated_at = now() where plate_number = p_plate_number;
  perform set_config('darch.odometer_write', 'off', true);

  insert into truck_odometer_log (plate_number, source, reading, km_added, note, recorded_by)
  values (p_plate_number, 'reading', p_reading, p_reading - coalesce(v_current, 0),
          nullif(trim(p_note), ''), _my_employee_id());
  return p_reading;
end $function$
;

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
  if v_status <> 'Delivered' then raise exception 'Trip #% is not delivered.', p_itinerary_id; end if;

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
end $function$
;

CREATE OR REPLACE FUNCTION public.request_part(p_item_id integer, p_work_order_id integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor record; v_item public.inventory_items; v_by text; v_id integer;
begin
  select * into v_actor from public._inventory_actor();
  if v_actor.o_role is null or v_actor.o_role not in ('Mechanic', 'Admin') then
    raise exception 'Only mechanics and Admins can request parts.';
  end if;
  if v_actor.o_employee_id is null then
    raise exception 'Your login has no employee record linked, so the request can''t be saved under your name.';
  end if;
  select * into v_item from public.inventory_items where item_id = p_item_id;
  if not found or v_item.archived_at is not null then
    raise exception 'This item is not in inventory.';
  end if;
  select e.full_name into v_by
    from public.parts_requests r join public.employees e on e.employee_id = r.employee_id
   where r.item_id = p_item_id and r.status = 'Open';
  if found then
    raise exception '% was already requested by %.', v_item.name, v_by;
  end if;
  insert into public.parts_requests (item_id, work_order_id, employee_id, note)
  values (p_item_id, p_work_order_id, v_actor.o_employee_id, nullif(btrim(p_note), ''))
  returning request_id into v_id;
  return v_id;
exception when unique_violation then
  raise exception '% was just requested by someone else.', v_item.name;
end $function$
;

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
       and i.itinerary_status in ('Dispatched', 'PickedUp', 'InTransit')
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
$function$
;

CREATE OR REPLACE FUNCTION public.require_downpayment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_required numeric; v_paid numeric; v_waived timestamptz;
begin
  if old.itinerary_status is distinct from 'Awaiting'
     or new.itinerary_status in ('Awaiting', 'Cancelled') then
    return new;
  end if;
  select amount_paid, downpayment_waived_at into v_paid, v_waived
  from bookings where booking_id = new.booking_id;
  if v_waived is not null then return new; end if;
  v_required := booking_downpayment(new.booking_id);
  if v_required is not null and coalesce(v_paid, 0) < v_required then
    raise exception 'Waiting for the client''s downpayment before this trip can start.';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.respond_to_quote_offer(p_quote_id bigint, p_action text, p_pickup_date date, p_deadline_date date, p_note text, p_line_rates jsonb DEFAULT NULL::jsonb, p_rate numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q          public.quote_requests;
  v_client   integer;
  v_staff    boolean := public.is_staff();
  v_booking  integer;
  v_pickup   date;
  v_deadline date;
  v_rates    jsonb;
  v_avg      numeric;
begin
  select * into q from public.quote_requests where quote_request_id = p_quote_id for update;
  if not found then raise exception 'Quote not found.'; end if;

  if not v_staff then
    select client_id into v_client from public.users
    where auth_user_id = auth.uid() and user_role = 'Client';
    if v_client is null or q.client_id is distinct from v_client then
      raise exception 'This is not your quote.';
    end if;
  end if;

  if q.request_status <> 'Offered' then
    raise exception 'There is no open offer on this quote (it may have been withdrawn or already answered).';
  end if;

  if p_action = 'accept' then
    if q.preferred_pickup_date is not null
       and q.preferred_pickup_date < (now() at time zone 'Asia/Manila')::date then
      raise exception 'The pickup date on this offer has passed. Send a counter-offer with a new pickup date.';
    end if;
    insert into public.quote_rate_offers (quote_request_id, party, action, rate, line_rates, pickup_date, deadline_date, note, entered_by_staff)
    values (p_quote_id, 'Client', 'Accept', q.proposed_rate, q.line_rates, q.preferred_pickup_date, q.preferred_delivery_date,
            nullif(trim(p_note), ''), v_staff);
    v_booking := public.create_booking_from_quote(p_quote_id);
    return v_booking;

  elsif p_action = 'counter' then
    v_rates := p_line_rates;
    if v_rates is null and p_rate is not null and jsonb_typeof(q.cargo_lines) = 'array' then
      select jsonb_agg(p_rate) into v_rates from jsonb_array_elements(q.cargo_lines);
    end if;
    v_avg      := public.quote_average_rate(q.cargo_lines, v_rates);
    v_pickup   := coalesce(p_pickup_date, q.preferred_pickup_date);
    v_deadline := coalesce(p_deadline_date, q.preferred_delivery_date);
    if p_pickup_date is not null and p_pickup_date < (now() at time zone 'Asia/Manila')::date then
      raise exception 'The pickup date is in the past.';
    end if;
    if v_deadline is not null and v_pickup is not null and v_deadline < v_pickup then
      raise exception 'The deadline is before the pickup date.';
    end if;
    update public.quote_requests set
      request_status          = 'Countered',
      proposed_rate           = v_avg,
      line_rates              = v_rates,
      preferred_pickup_date   = v_pickup,
      preferred_delivery_date = v_deadline,
      trip_plan               = null
    where quote_request_id = p_quote_id;
    insert into public.quote_rate_offers (quote_request_id, party, action, rate, line_rates, pickup_date, deadline_date, note, entered_by_staff)
    values (p_quote_id, 'Client', 'Counter', v_avg, v_rates, v_pickup, v_deadline, nullif(trim(p_note), ''), v_staff);
    return null;

  elsif p_action = 'decline' then
    if nullif(trim(p_note), '') is null then raise exception 'Please say why you are declining.'; end if;
    update public.quote_requests set
      request_status = 'Declined',
      decline_reason = trim(p_note)
    where quote_request_id = p_quote_id;
    insert into public.quote_rate_offers (quote_request_id, party, action, rate, line_rates, note, entered_by_staff)
    values (p_quote_id, 'Client', 'Decline', q.proposed_rate, q.line_rates, trim(p_note), v_staff);
    return null;
  end if;

  raise exception 'Unknown action %.', p_action;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resubmit_quote_request(p_quote_id bigint, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id public.users.client_id%type;
  r public.quote_requests;
begin
  select client_id into v_client_id
  from public.users
  where auth_user_id = auth.uid() and user_role = 'Client';
  if v_client_id is null then
    raise exception 'Only a client can resubmit a quote.';
  end if;

  r := jsonb_populate_record(null::public.quote_requests, p_changes);

  update public.quote_requests set
    pickup_location_text        = r.pickup_location_text,
    pickup_landmark             = r.pickup_landmark,
    pickup_city                 = r.pickup_city,
    pickup_barangay             = r.pickup_barangay,
    pickup_lat                  = r.pickup_lat,
    pickup_lng                  = r.pickup_lng,
    delivery_location_text      = r.delivery_location_text,
    delivery_landmark           = r.delivery_landmark,
    delivery_city               = r.delivery_city,
    delivery_barangay           = r.delivery_barangay,
    delivery_lat                = r.delivery_lat,
    delivery_lng                = r.delivery_lng,
    cargo_lines                 = r.cargo_lines,
    preferred_pickup_date       = r.preferred_pickup_date,
    payment_terms               = r.payment_terms,
    proposed_rate               = r.proposed_rate,
    is_last_day_of_port_storage = r.is_last_day_of_port_storage,
    preferred_delivery_date     = r.preferred_delivery_date,
    delivery_order_count        = r.delivery_order_count,
    previous_rejection_reason   = rejection_reason,
    rejection_reason            = null,
    rejection_tag               = null,
    resubmit_count              = resubmit_count + 1,
    request_status              = 'Pending'
  where quote_request_id = p_quote_id
    and client_id = v_client_id
    and request_status = 'Rejected';

  if not found then
    raise exception 'This quote can''t be resubmitted (not yours, or no longer Rejected).';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.return_logged_part(p_log_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor record; v_log public.work_order_parts_log; v_lot_id integer;
begin
  select * into v_actor from public._inventory_actor();
  select * into v_log from public.work_order_parts_log where log_id = p_log_id;
  if not found then raise exception 'This part was already returned or removed.'; end if;
  perform public._inventory_open_work_order(v_log.work_order_id, v_actor.o_role, v_actor.o_employee_id);
  select * into v_log from public.work_order_parts_log where log_id = p_log_id for update;
  if not found then raise exception 'This part was already returned or removed.'; end if;
  if v_log.completion_id is not null then
    raise exception '% is already on a completed job record and can''t be returned.', v_log.item_name_text;
  end if;
  if exists (select 1 from public.inventory_movements where log_id = p_log_id and reason = 'write_off') then
    raise exception '% was written off and can''t be returned.', v_log.item_name_text;
  end if;
  select lot_id into v_lot_id from public.inventory_movements
   where log_id = p_log_id and reason = 'use' and lot_id is not null
   order by movement_id limit 1;
  if v_lot_id is null then
    -- logged before batches existed: comes back as its own (oldest) batch
    v_lot_id := public._inventory_receive(v_log.item_id, v_log.quantity, v_log.unit_cost, v_log.used_at,
                  'Returned from work order (logged before batches)', v_actor.o_employee_id);
  else
    perform public._inventory_put(v_lot_id, v_log.quantity);
  end if;
  insert into public.inventory_movements
    (item_id, lot_id, qty_change, reason, unit_cost, work_order_id, employee_id, note)
  values (v_log.item_id, v_lot_id, v_log.quantity, 'return', v_log.unit_cost,
          v_log.work_order_id, v_actor.o_employee_id, 'Returned log #' || p_log_id);
  delete from public.work_order_parts_log where log_id = p_log_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.send_quote_offer(p_quote_id bigint, p_pickup_date date, p_deadline_date date, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_note text, p_line_rates jsonb DEFAULT NULL::jsonb, p_rate numeric DEFAULT NULL::numeric, p_trip_plan jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_lines jsonb; v_rates jsonb; v_avg numeric;
begin
  if not public.is_staff() then raise exception 'Only staff can send an offer.'; end if;
  select cargo_lines into v_lines from public.quote_requests where quote_request_id = p_quote_id;
  if not found then raise exception 'Quote not found.'; end if;

  v_rates := p_line_rates;
  if v_rates is null and p_rate is not null and v_lines is not null and jsonb_typeof(v_lines) = 'array' then
    select jsonb_agg(p_rate) into v_rates from jsonb_array_elements(v_lines);
  end if;
  v_avg := public.quote_average_rate(v_lines, v_rates);

  if p_distance_km is null or p_distance_km <= 0 then raise exception 'Enter the distance.'; end if;
  if p_hours_per_trip is null or p_hours_per_trip <= 0 or p_hours_per_trip > 72 then
    raise exception 'Hours per trip must be more than 0 and at most 72.';
  end if;
  if p_cost_per_trip is null or p_cost_per_trip < 0 then raise exception 'The trip cost could not be worked out.'; end if;
  if p_pickup_date is null then raise exception 'Enter a pickup date.'; end if;
  if p_deadline_date is not null and p_deadline_date < p_pickup_date then
    raise exception 'The deadline is before the pickup date.';
  end if;

  update public.quote_requests set
    request_status          = 'Offered',
    proposed_rate           = v_avg,
    line_rates              = v_rates,
    preferred_pickup_date   = p_pickup_date,
    preferred_delivery_date = p_deadline_date,
    estimated_distance_km   = p_distance_km,
    hours_per_trip          = p_hours_per_trip,
    cost_per_trip           = p_cost_per_trip,
    trip_plan               = p_trip_plan
  where quote_request_id = p_quote_id
    and request_status in ('Pending', 'Countered');
  if not found then
    raise exception 'This quote is no longer waiting for a price (someone else may have handled it).';
  end if;

  insert into public.quote_rate_offers (quote_request_id, party, action, rate, line_rates, pickup_date, deadline_date, note)
  values (p_quote_id, 'Business', 'Offer', v_avg, v_rates, p_pickup_date, p_deadline_date, nullif(trim(p_note), ''));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_client_active(p_client_id integer, p_active boolean, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin integer := public.current_admin_employee_id();  -- raises "Admins only"
begin
  if not p_active and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Enter a reason for deactivating this client.';
  end if;

  update public.clients
     set deactivated_at      = case when p_active then null else now() end,
         deactivated_by      = case when p_active then null else v_admin end,
         deactivation_reason = case when p_active then null else left(trim(p_reason), 500) end
   where client_id = p_client_id;

  if not found then
    raise exception 'Client #% not found.', p_client_id;
  end if;

  -- Ban (or unban) every login linked to this client. A fixed far-future
  -- date rather than 'infinity', which Supabase Auth can't read.
  update auth.users
     set banned_until = case when p_active then null else now() + interval '100 years' end
   where id in (select auth_user_id from public.users
                where client_id = p_client_id and auth_user_id is not null);

  -- On deactivation, end their open sessions so "stay logged in" can't
  -- refresh them back in.
  if not p_active then
    delete from auth.sessions
     where user_id in (select auth_user_id from public.users
                       where client_id = p_client_id and auth_user_id is not null);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_item_archived(p_item_id integer, p_archived boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_item public.inventory_items;
begin
  perform public.current_admin_employee_id();
  select * into v_item from public.inventory_items where item_id = p_item_id for update;
  if not found then raise exception 'Inventory item #% not found.', p_item_id; end if;
  if p_archived and v_item.quantity > 0 then
    raise exception 'Take the remaining % % of % off first (Adjust stock).', v_item.quantity, v_item.unit, v_item.name;
  end if;
  update public.inventory_items set archived_at = case when p_archived then now() end where item_id = p_item_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_item_price(p_item_id integer, p_unit_cost numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.current_admin_employee_id();
  if p_unit_cost is null or p_unit_cost < 0 then raise exception 'Enter the unit price (0 or more).'; end if;
  update public.inventory_items set unit_cost = p_unit_cost, needs_price = false where item_id = p_item_id;
  if not found then raise exception 'Inventory item #% not found.', p_item_id; end if;
  update public.inventory_lots      set unit_cost = p_unit_cost where item_id = p_item_id and unit_cost is null;
  update public.inventory_movements set unit_cost = p_unit_cost where item_id = p_item_id and unit_cost is null;
  update public.work_order_parts_log  set unit_cost = p_unit_cost where item_id = p_item_id and unit_cost is null;
  update public.work_order_parts_used set unit_cost = p_unit_cost where item_id = p_item_id and unit_cost is null;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_bill_amount_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_bill integer;
begin
  v_bill := coalesce(new.bill_id, old.bill_id);
  update public.bills
     set amount_paid = coalesce((select sum(amount) from public.bill_payments
                                  where bill_id = v_bill and voided_at is null), 0)
   where bill_id = v_bill;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_booking_amount_paid()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_booking integer;
begin
  v_booking := coalesce(new.booking_id, old.booking_id);
  update public.bookings
     set amount_paid = coalesce((select sum(amount) from public.booking_payments
                                  where booking_id = v_booking and voided_at is null), 0)
   where booking_id = v_booking;
  return null;
end $function$
;

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
    count(*) filter (where coalesce(itinerary_status, 'Awaiting') = 'Delivered'),
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
$function$
;

CREATE OR REPLACE FUNCTION public.truck_odometer_log_direct()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('darch.odometer_write', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into truck_odometer_log (plate_number, source, reading, note, recorded_by)
    values (new.plate_number, 'opening', coalesce(new.current_odometer, 0), 'Truck added', _my_employee_id());
  elsif new.current_odometer is distinct from old.current_odometer then
    insert into truck_odometer_log (plate_number, source, reading, km_added, note, recorded_by)
    values (new.plate_number, 'edit', coalesce(new.current_odometer, 0),
            coalesce(new.current_odometer, 0) - coalesce(old.current_odometer, 0),
            'Changed outside the odometer log (work order completion or a direct edit)',
            _my_employee_id());
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.update_my_profile(p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  my_id integer;
  k text;
  v text;
  lbl text;
  max_len integer;
  n jsonb := '{}'::jsonb;  -- cleaned values to write
  allowed text[] := array[
    'phone_number','date_of_birth','email','address','city','province','zip_code',
    'emergency_contact_name','emergency_contact_number',
    'tin_number','sss_number','philhealth_number','pagibig_number'];
begin
  select employee_id into my_id from public.users where auth_user_id = auth.uid();
  if my_id is null then
    raise exception 'Your account has no linked employee record.';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'Nothing to save.';
  end if;

  for k, v in select key, value from jsonb_each_text(p_changes) loop
    if not (k = any(allowed)) then
      raise exception 'Unknown field: %', k;
    end if;

    lbl := replace(k, '_', ' ');
    v := nullif(btrim(v), '');           -- blank -> NULL (clears the field)

    if v is not null then
      if v ~ '[[:cntrl:]]' then
        raise exception '% has invalid characters.', lbl;
      end if;

      max_len := case k
        when 'date_of_birth' then 10 when 'email' then 100 when 'address' then 200
        when 'city' then 80 when 'province' then 80 when 'zip_code' then 10
        when 'emergency_contact_name' then 100 else 20 end;
      if length(v) > max_len then
        raise exception '% is too long (max % characters).', lbl, max_len;
      end if;

      if k in ('phone_number', 'emergency_contact_number') then
        if v !~ '^[+]?[0-9 ()-]+$' or length(regexp_replace(v, '[^0-9]', '', 'g')) < 7 then
          raise exception '% is not a valid phone number.', lbl;
        end if;
      elsif k = 'email' then
        if v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
          raise exception 'Enter a valid email address.';
        end if;
      elsif k in ('tin_number', 'sss_number', 'philhealth_number', 'pagibig_number') then
        if v !~ '^[A-Za-z0-9 -]+$' then
          raise exception '% can only have letters, digits, spaces and dashes.', lbl;
        end if;
      elsif k = 'date_of_birth' then
        begin
          if v::date < date '1900-01-01' or v::date > (now() at time zone 'Asia/Manila')::date then
            raise exception 'x';
          end if;
        exception when others then
          raise exception 'Enter a real date of birth (not in the future).';
        end;
      end if;
    elsif k = 'phone_number' then
      raise exception 'Phone number is required.';
    end if;

    n := n || jsonb_build_object(k, v);   -- NULL v becomes JSON null
  end loop;

  -- Only the fields present in n are touched; everything else keeps its value
  update public.employees set
    phone_number             = case when n ? 'phone_number' then n->>'phone_number' else phone_number end,
    date_of_birth            = case when n ? 'date_of_birth' then (n->>'date_of_birth')::date else date_of_birth end,
    email                    = case when n ? 'email' then n->>'email' else email end,
    address                  = case when n ? 'address' then n->>'address' else address end,
    city                     = case when n ? 'city' then n->>'city' else city end,
    province                 = case when n ? 'province' then n->>'province' else province end,
    zip_code                 = case when n ? 'zip_code' then n->>'zip_code' else zip_code end,
    emergency_contact_name   = case when n ? 'emergency_contact_name' then n->>'emergency_contact_name' else emergency_contact_name end,
    emergency_contact_number = case when n ? 'emergency_contact_number' then n->>'emergency_contact_number' else emergency_contact_number end,
    tin_number               = case when n ? 'tin_number' then n->>'tin_number' else tin_number end,
    sss_number               = case when n ? 'sss_number' then n->>'sss_number' else sss_number end,
    philhealth_number        = case when n ? 'philhealth_number' then n->>'philhealth_number' else philhealth_number end,
    pagibig_number           = case when n ? 'pagibig_number' then n->>'pagibig_number' else pagibig_number end
  where employee_id = my_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.void_bill(p_bill_id integer, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer;
begin
  v_emp := public.current_admin_employee_id();
  if p_reason is null or trim(p_reason) = '' then raise exception 'A reason is required'; end if;
  if exists (select 1 from public.bill_payments where bill_id = p_bill_id and voided_at is null) then
    raise exception 'Void this bill''s payments first';
  end if;
  update public.bills
     set voided_at = now(), voided_by = v_emp, void_reason = trim(p_reason)
   where bill_id = p_bill_id and voided_at is null;
  if not found then raise exception 'Bill not found or already voided'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.void_bill_payment(p_bill_payment_id integer, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer;
begin
  v_emp := public.current_admin_employee_id();
  if p_reason is null or trim(p_reason) = '' then raise exception 'A reason is required'; end if;
  update public.bill_payments
     set voided_at = now(), voided_by = v_emp, void_reason = trim(p_reason)
   where bill_payment_id = p_bill_payment_id and voided_at is null;
  if not found then raise exception 'Payment not found or already voided'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.void_booking_payment(p_payment_id integer, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_emp integer;
begin
  if not exists (select 1 from public.users where auth_user_id = auth.uid() and user_role = 'Admin') then
    raise exception 'Admins only';
  end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'A reason is required'; end if;
  select employee_id into v_emp from public.users where auth_user_id = auth.uid();
  update public.booking_payments
     set voided_at = now(), voided_by = v_emp, void_reason = trim(p_reason)
   where payment_id = p_payment_id and voided_at is null;
  if not found then raise exception 'Payment not found or already voided'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.waive_downpayment(p_booking_id integer, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_admin integer;
begin
  v_admin := current_admin_employee_id();   -- raises "Admins only"
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required.';
  end if;
  update bookings
     set downpayment_waived_at    = now(),
         downpayment_waived_by    = v_admin,
         downpayment_waive_reason = btrim(p_reason)
   where booking_id = p_booking_id;
  if not found then raise exception 'Booking not found.'; end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.withdraw_quote_request(p_quote_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q        public.quote_requests;
  v_client integer;
begin
  select * into q from public.quote_requests where quote_request_id = p_quote_id for update;
  if not found then raise exception 'Quote not found.'; end if;

  if not public.is_staff() then
    select client_id into v_client from public.users
     where auth_user_id = auth.uid() and user_role = 'Client';
    if v_client is null or q.client_id is distinct from v_client then
      raise exception 'This is not your quote.';
    end if;
  end if;

  if q.request_status not in ('Pending', 'Offered', 'Countered') then
    raise exception 'This quote can no longer be withdrawn (it may already be answered).';
  end if;

  update public.quote_requests set request_status = 'Withdrawn' where quote_request_id = p_quote_id;
end;
$function$
;

-- ===== 10. Triggers (incl. on_client_signup on auth.users) (24) =====

CREATE TRIGGER bill_payments_sync AFTER INSERT OR DELETE OR UPDATE ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION sync_bill_amount_paid();

CREATE TRIGGER booking_payments_sync AFTER INSERT OR DELETE OR UPDATE ON public.booking_payments FOR EACH ROW EXECUTE FUNCTION sync_booking_amount_paid();

CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER inventory_items_guard_quantity BEFORE INSERT OR UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION inventory_items_guard_quantity();

CREATE TRIGGER inventory_items_set_updated_at BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER inventory_movements_close_part_requests AFTER INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION parts_requests_close_on_receive();

CREATE TRIGGER free_vehicles_on_delivery AFTER UPDATE OF itinerary_status ON public.itineraries FOR EACH ROW EXECUTE FUNCTION free_vehicles_on_delivery();

CREATE TRIGGER itineraries_after_reschedule AFTER UPDATE OF trip_start_at, trip_end_at ON public.itineraries FOR EACH ROW EXECUTE FUNCTION itineraries_after_reschedule();

CREATE TRIGGER itineraries_sync_booking_status AFTER INSERT OR DELETE OR UPDATE OF itinerary_status ON public.itineraries FOR EACH ROW EXECUTE FUNCTION sync_booking_status();

CREATE TRIGGER itinerary_slot_defaults BEFORE INSERT OR UPDATE OF trip_start_at, trip_end_at ON public.itineraries FOR EACH ROW EXECUTE FUNCTION itinerary_slot_defaults();

CREATE TRIGGER itinerary_trailer_fits BEFORE INSERT OR UPDATE OF trailer_id, cargo_type, trailer_type, container_type ON public.itineraries FOR EACH ROW EXECUTE FUNCTION itinerary_trailer_fits();

CREATE TRIGGER itinerary_trip_rate_default BEFORE INSERT ON public.itineraries FOR EACH ROW EXECUTE FUNCTION itinerary_trip_rate_default();

CREATE TRIGGER itinerary_vehicle_slot_check BEFORE INSERT OR UPDATE OF plate_number, trailer_id, trip_start_at, trip_end_at ON public.itineraries FOR EACH ROW EXECUTE FUNCTION check_vehicle_slot();

CREATE TRIGGER require_crew_free_of_road BEFORE UPDATE OF itinerary_status ON public.itineraries FOR EACH ROW EXECUTE FUNCTION require_crew_free_of_road();

CREATE TRIGGER require_downpayment BEFORE UPDATE OF itinerary_status ON public.itineraries FOR EACH ROW EXECUTE FUNCTION require_downpayment();

CREATE TRIGGER itinerary_crews_check_slot BEFORE INSERT OR UPDATE OF is_active, employee_id, itinerary_id ON public.itinerary_crews FOR EACH ROW EXECUTE FUNCTION itinerary_crews_check_slot();

CREATE TRIGGER itinerary_crews_notify AFTER INSERT OR UPDATE OF is_active ON public.itinerary_crews FOR EACH ROW EXECUTE FUNCTION itinerary_crews_notify();

CREATE TRIGGER trg_quote_requests_updated_at BEFORE UPDATE ON public.quote_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pms_auto_schedule AFTER UPDATE OF current_odometer, last_pms_odometer ON public.truck_profiles FOR EACH ROW EXECUTE FUNCTION pms_auto_schedule();

CREATE TRIGGER truck_odometer_log_direct AFTER INSERT OR UPDATE OF current_odometer ON public.truck_profiles FOR EACH ROW EXECUTE FUNCTION truck_odometer_log_direct();

CREATE TRIGGER on_client_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_client_signup();

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pms_reset_on_completion AFTER INSERT ON public.work_order_completions FOR EACH ROW EXECUTE FUNCTION pms_reset_on_completion();

-- ===== 11. Row Level Security on (53) =====

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_charges ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cash_advances ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.client_delinquency_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.client_reviews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.client_status_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.creditors ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.delivery_damage_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dispatch_status_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.employee_attendance ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.employment_status ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.insurance_companies ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.inventory_lots ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.itineraries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.itinerary_crews ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.itinerary_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.itinerary_expenses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.itinerary_schedule_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.location_reference ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.named_locations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parts_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payroll_payslips ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payslip_issue_reports ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.payslip_line_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quote_rate_offers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.route_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.status_relog_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.trailers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.truck_odometer_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.truck_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_acceptance_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_completions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_notes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_parts_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_parts_used ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_order_status_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

-- ===== 12. RLS policies (public) (173) =====

CREATE POLICY app_settings_select_authenticated ON public.app_settings AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY app_settings_update_staff ON public.app_settings AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY bill_payments_select_admin ON public.bill_payments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.user_role = 'Admin'::user_role_enum)))));

CREATE POLICY bills_select_admin ON public.bills AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.user_role = 'Admin'::user_role_enum)))));

CREATE POLICY booking_charges_insert_admin ON public.booking_charges AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY booking_charges_select_own_client ON public.booking_charges AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (bookings b
     JOIN users u ON ((u.client_id = b.client_id)))
  WHERE ((b.booking_id = booking_charges.booking_id) AND (u.auth_user_id = auth.uid())))));

CREATE POLICY booking_charges_select_staff ON public.booking_charges AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY booking_charges_update_admin ON public.booking_charges AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY booking_payments_select_admin ON public.booking_payments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.user_role = 'Admin'::user_role_enum)))));

CREATE POLICY "Allow staff to insert bookings" ON public.bookings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY "Clients can view their own bookings" ON public.bookings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.client_id = bookings.client_id)))));

CREATE POLICY "Staff can create bookings" ON public.bookings AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can delete bookings" ON public.bookings AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can view all bookings" ON public.bookings AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY staff_can_update_bookings ON public.bookings AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY cash_advances_insert_own_employee ON public.cash_advances AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((status = 'Pending'::text) AND (employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())))));

CREATE POLICY cash_advances_insert_staff ON public.cash_advances AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY cash_advances_select_own_employee ON public.cash_advances AS PERMISSIVE FOR SELECT TO authenticated
  USING ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY cash_advances_select_staff ON public.cash_advances AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY cash_advances_update_staff ON public.cash_advances AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY client_delinquency_log_insert_staff ON public.client_delinquency_log AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY client_delinquency_log_select_staff ON public.client_delinquency_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY client_reviews_insert_own ON public.client_reviews AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY client_reviews_select_featured_public ON public.client_reviews AS PERMISSIVE FOR SELECT TO public
  USING ((is_featured = true));

CREATE POLICY client_reviews_select_own ON public.client_reviews AS PERMISSIVE FOR SELECT TO authenticated
  USING ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY client_reviews_select_staff ON public.client_reviews AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY client_reviews_update_own ON public.client_reviews AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))))
  WITH CHECK ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY client_reviews_update_staff ON public.client_reviews AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY client_status_requests_insert_own_client ON public.client_status_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY client_status_requests_select_own_client ON public.client_status_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY client_status_requests_select_staff ON public.client_status_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY client_status_requests_update_staff ON public.client_status_requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY "Staff can create clients" ON public.clients AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can view clients" ON public.clients AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY clients_delete_admin ON public.clients AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_staff());

CREATE POLICY clients_select_own ON public.clients AS PERMISSIVE FOR SELECT TO authenticated
  USING ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY clients_update_admin ON public.clients AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY clients_update_own ON public.clients AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))))
  WITH CHECK ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY creditors_insert_admin ON public.creditors AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.user_role = 'Admin'::user_role_enum)))));

CREATE POLICY creditors_select_admin ON public.creditors AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.user_role = 'Admin'::user_role_enum)))));

CREATE POLICY creditors_update_admin ON public.creditors AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.user_role = 'Admin'::user_role_enum)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.user_role = 'Admin'::user_role_enum)))));

CREATE POLICY delivery_damage_records_insert_staff ON public.delivery_damage_records AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_admin() OR (is_staff() AND (COALESCE(damage_status, 'Reported'::text) = 'Reported'::text) AND (approved_by IS NULL) AND (insurance_company_id IS NULL))));

CREATE POLICY delivery_damage_records_select_own_client ON public.delivery_damage_records AS PERMISSIVE FOR SELECT TO authenticated
  USING (((damage_status = 'Approved'::text) AND (charge_to = 'Client'::text) AND (itinerary_id IN ( SELECT i.itinerary_id
   FROM ((itineraries i
     JOIN bookings b ON ((b.booking_id = i.booking_id)))
     JOIN users u ON ((u.client_id = b.client_id)))
  WHERE (u.auth_user_id = auth.uid())))));

CREATE POLICY delivery_damage_records_select_staff ON public.delivery_damage_records AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY delivery_damage_records_update_admin ON public.delivery_damage_records AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Drivers can insert status logs for assigned itineraries" ON public.dispatch_status_logs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((changed_by = ( SELECT u.employee_id
   FROM users u
  WHERE ((u.auth_user_id = auth.uid()) AND (u.user_role = 'Driver'::user_role_enum)))) AND (EXISTS ( SELECT 1
   FROM itinerary_crews ic
  WHERE ((ic.itinerary_id = dispatch_status_logs.itinerary_id) AND (ic.employee_id = dispatch_status_logs.changed_by) AND (ic.crew_role = 'Driver'::text) AND (ic.is_active = true))))));

CREATE POLICY "Logging each status change" ON public.dispatch_status_logs AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY dispatch_status_logs_select_own_client ON public.dispatch_status_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((itinerary_id IN ( SELECT i.itinerary_id
   FROM ((itineraries i
     JOIN bookings b ON ((b.booking_id = i.booking_id)))
     JOIN users u ON ((u.client_id = b.client_id)))
  WHERE (u.auth_user_id = auth.uid()))));

CREATE POLICY dispatch_status_logs_select_staff ON public.dispatch_status_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY employee_attendance_insert_staff ON public.employee_attendance AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_staff());

CREATE POLICY employee_attendance_select_own ON public.employee_attendance AS PERMISSIVE FOR SELECT TO authenticated
  USING ((employee_id = ( SELECT u.employee_id
   FROM users u
  WHERE (u.auth_user_id = auth.uid()))));

CREATE POLICY employee_attendance_select_staff ON public.employee_attendance AS PERMISSIVE FOR SELECT TO public
  USING (is_staff());

CREATE POLICY employee_attendance_update_staff ON public.employee_attendance AS PERMISSIVE FOR UPDATE TO public
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY "Staff can add employees" ON public.employees AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can delete employees" ON public.employees AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can update employees" ON public.employees AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can view employees" ON public.employees AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY employees_select_own ON public.employees AS PERMISSIVE FOR SELECT TO authenticated
  USING ((employee_id IN ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY "Authenticated can view employment_status" ON public.employment_status AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY employment_status_select_all ON public.employment_status AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY insurance_companies_insert_admin ON public.insurance_companies AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY insurance_companies_select_staff ON public.insurance_companies AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY insurance_companies_update_admin ON public.insurance_companies AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY inventory_items_delete_admin ON public.inventory_items AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_admin());

CREATE POLICY inventory_items_insert_admin ON public.inventory_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY inventory_items_select_staff_mechanic ON public.inventory_items AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_staff() OR (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum))))));

CREATE POLICY inventory_items_update_admin ON public.inventory_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY inventory_lots_select_staff ON public.inventory_lots AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY inventory_movements_select_staff ON public.inventory_movements AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY issue_reports_insert_own ON public.issue_reports AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((employee_id IN ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY issue_reports_select_staff ON public.issue_reports AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY issue_reports_update_staff ON public.issue_reports AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY "Employees can view itineraries they're assigned to" ON public.itineraries AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM itinerary_crews ic
  WHERE ((ic.itinerary_id = itineraries.itinerary_id) AND (ic.employee_id = ( SELECT users.employee_id
           FROM users
          WHERE (users.auth_user_id = auth.uid())))))));

CREATE POLICY "Reading itinerary list" ON public.itineraries AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can create itineraries" ON public.itineraries AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can view all itineraries" ON public.itineraries AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Update itinerary list" ON public.itineraries AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY itineraries_select_own_client ON public.itineraries AS PERMISSIVE FOR SELECT TO authenticated
  USING ((booking_id IN ( SELECT bookings.booking_id
   FROM bookings
  WHERE (bookings.client_id IN ( SELECT users.client_id
           FROM users
          WHERE (users.auth_user_id = auth.uid()))))));

CREATE POLICY itineraries_update_own_driver ON public.itineraries AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((itinerary_id IN ( SELECT itinerary_crews.itinerary_id
   FROM itinerary_crews
  WHERE ((itinerary_crews.crew_role = 'Driver'::text) AND (itinerary_crews.is_active = true) AND (itinerary_crews.employee_id = ( SELECT users.employee_id
           FROM users
          WHERE (users.auth_user_id = auth.uid())))))))
  WITH CHECK ((itinerary_id IN ( SELECT itinerary_crews.itinerary_id
   FROM itinerary_crews
  WHERE ((itinerary_crews.crew_role = 'Driver'::text) AND (itinerary_crews.is_active = true) AND (itinerary_crews.employee_id = ( SELECT users.employee_id
           FROM users
          WHERE (users.auth_user_id = auth.uid())))))));

CREATE POLICY "Assigned driver" ON public.itinerary_crews AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Employees can view their own crew assignments" ON public.itinerary_crews AS PERMISSIVE FOR SELECT TO authenticated
  USING ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY "Signing driver" ON public.itinerary_crews AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can view all crew assignments" ON public.itinerary_crews AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Updating driver" ON public.itinerary_crews AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY itinerary_documents_delete_staff ON public.itinerary_documents AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_staff());

CREATE POLICY itinerary_documents_insert_staff ON public.itinerary_documents AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY itinerary_documents_select_crew_client ON public.itinerary_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_trip_documents(itinerary_id));

CREATE POLICY itinerary_documents_select_staff ON public.itinerary_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY itinerary_expenses_insert_own_crew ON public.itinerary_expenses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))) AND (itinerary_id IN ( SELECT itinerary_crews.itinerary_id
   FROM itinerary_crews
  WHERE ((itinerary_crews.employee_id = itinerary_expenses.employee_id) AND (itinerary_crews.is_active = true))))));

CREATE POLICY itinerary_expenses_insert_staff ON public.itinerary_expenses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY itinerary_expenses_select_staff ON public.itinerary_expenses AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY itinerary_schedule_logs_select_staff ON public.itinerary_schedule_logs AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY leave_requests_insert_own ON public.leave_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((status = 'Pending'::text) AND (employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())))));

CREATE POLICY leave_requests_select_own ON public.leave_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY leave_requests_select_staff ON public.leave_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY leave_requests_update_admin ON public.leave_requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY location_reference_select_all ON public.location_reference AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY maintenance_requests_insert_employee ON public.maintenance_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Driver'::user_role_enum, 'Mechanic'::user_role_enum]))))));

CREATE POLICY maintenance_requests_select_own ON public.maintenance_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((requested_by_employee_id IN ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY maintenance_requests_select_staff ON public.maintenance_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY maintenance_requests_update_admin ON public.maintenance_requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Admin'::user_role_enum)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Admin'::user_role_enum)))));

CREATE POLICY maintenance_schedules_insert_mechanic ON public.maintenance_schedules AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum)))));

CREATE POLICY maintenance_schedules_insert_staff ON public.maintenance_schedules AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY maintenance_schedules_select_staff ON public.maintenance_schedules AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY maintenance_schedules_update_staff ON public.maintenance_schedules AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY named_locations_select_all ON public.named_locations AS PERMISSIVE FOR SELECT TO public
  USING (true);

CREATE POLICY notifications_select_own ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY notifications_update_own ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))))
  WITH CHECK ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY parts_requests_select_staff_mechanic ON public.parts_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_staff() OR (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum))))));

CREATE POLICY "Staff can view payroll" ON public.payroll_payslips AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY payroll_payslips_delete_draft_staff ON public.payroll_payslips AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_staff() AND (finalized_at IS NULL)));

CREATE POLICY payroll_payslips_hide_drafts ON public.payroll_payslips AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((is_staff() OR (finalized_at IS NOT NULL)));

CREATE POLICY payroll_payslips_insert_staff ON public.payroll_payslips AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY payroll_payslips_select_own_employee ON public.payroll_payslips AS PERMISSIVE FOR SELECT TO authenticated
  USING ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY payroll_payslips_update_staff ON public.payroll_payslips AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY payslip_issue_reports_insert_own_employee ON public.payslip_issue_reports AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY payslip_issue_reports_select_own_employee ON public.payslip_issue_reports AS PERMISSIVE FOR SELECT TO authenticated
  USING ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY payslip_issue_reports_select_staff ON public.payslip_issue_reports AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY payslip_issue_reports_update_staff ON public.payslip_issue_reports AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY payslip_line_items_delete_staff ON public.payslip_line_items AS PERMISSIVE FOR DELETE TO authenticated
  USING (is_staff());

CREATE POLICY payslip_line_items_insert_staff ON public.payslip_line_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY payslip_line_items_select_own_employee ON public.payslip_line_items AS PERMISSIVE FOR SELECT TO authenticated
  USING ((payroll_id IN ( SELECT payroll_payslips.payroll_id
   FROM payroll_payslips
  WHERE (payroll_payslips.employee_id = ( SELECT users.employee_id
           FROM users
          WHERE (users.auth_user_id = auth.uid()))))));

CREATE POLICY payslip_line_items_select_staff ON public.payslip_line_items AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Authenticated users can view places" ON public.places AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Staff can create places" ON public.places AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY quote_rate_offers_select_own_client ON public.quote_rate_offers AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (quote_requests q
     JOIN users u ON ((u.client_id = q.client_id)))
  WHERE ((q.quote_request_id = quote_rate_offers.quote_request_id) AND (u.auth_user_id = auth.uid()) AND (u.user_role = 'Client'::user_role_enum)))));

CREATE POLICY quote_rate_offers_select_staff ON public.quote_rate_offers AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Staff can create quote requests" ON public.quote_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can update quote requests" ON public.quote_requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY "Staff can view quote requests" ON public.quote_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY quote_requests_insert_own_client ON public.quote_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))) AND (request_status = 'Pending'::request_status_enum) AND (rejection_reason IS NULL) AND (COALESCE(resubmit_count, 0) = 0)));

CREATE POLICY quote_requests_select_own_client ON public.quote_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((client_id IN ( SELECT users.client_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY route_cache_insert_staff ON public.route_cache AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY route_cache_select_authenticated ON public.route_cache AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY route_cache_update_staff ON public.route_cache AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

CREATE POLICY status_relog_requests_insert_staff ON public.status_relog_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Dispatcher'::user_role_enum, 'Mechanic'::user_role_enum]))))));

CREATE POLICY status_relog_requests_select_own ON public.status_relog_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING ((requested_by_employee_id IN ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY status_relog_requests_select_staff ON public.status_relog_requests AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY status_relog_requests_update_admin ON public.status_relog_requests AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Admin'::user_role_enum)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Admin'::user_role_enum)))));

CREATE POLICY "Allow logged in users to read trailers" ON public.trailers AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() IS NOT NULL));

CREATE POLICY "Staff can add trailers" ON public.trailers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can delete trailers" ON public.trailers AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can update trailers" ON public.trailers AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY trailers_update_mechanic ON public.trailers AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum)))));

CREATE POLICY truck_odometer_log_select_staff ON public.truck_odometer_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Allow logged in users to read trucks" ON public.truck_profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() IS NOT NULL));

CREATE POLICY "Staff can add trucks" ON public.truck_profiles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can delete trucks" ON public.truck_profiles AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can update trucks" ON public.truck_profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY truck_profiles_update_mechanic ON public.truck_profiles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum)))));

CREATE POLICY "Authenticated can claim own unclaimed profile" ON public.users AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth_user_id IS NULL) AND ((email)::text = (auth.jwt() ->> 'email'::text))))
  WITH CHECK (((auth_user_id = auth.uid()) AND ((email)::text = (auth.jwt() ->> 'email'::text))));

CREATE POLICY "Staff can view all users" ON public.users AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Users can read own profile" ON public.users AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth_user_id = auth.uid()));

CREATE POLICY "Users can see own unclaimed profile" ON public.users AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth_user_id IS NULL) AND ((email)::text = (auth.jwt() ->> 'email'::text))));

CREATE POLICY work_order_acceptance_log_insert_mechanic ON public.work_order_acceptance_log AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((employee_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY work_order_acceptance_log_select_staff ON public.work_order_acceptance_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY work_order_completions_select_staff ON public.work_order_completions AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY work_order_completions_select_staff_and_mechanic ON public.work_order_completions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_staff() OR (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum))))));

CREATE POLICY work_order_notes_insert_mechanic ON public.work_order_notes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((work_order_id IN ( SELECT wo.work_order_id
   FROM (work_orders wo
     JOIN users u ON ((u.employee_id = wo.assigned_mechanic_id)))
  WHERE (u.auth_user_id = auth.uid()))));

CREATE POLICY work_order_notes_select_mechanic ON public.work_order_notes AS PERMISSIVE FOR SELECT TO authenticated
  USING ((work_order_id IN ( SELECT wo.work_order_id
   FROM (work_orders wo
     JOIN users u ON ((u.employee_id = wo.assigned_mechanic_id)))
  WHERE (u.auth_user_id = auth.uid()))));

CREATE POLICY work_order_notes_select_staff ON public.work_order_notes AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY work_order_parts_log_select_mechanic ON public.work_order_parts_log AS PERMISSIVE FOR SELECT TO authenticated
  USING ((work_order_id IN ( SELECT wo.work_order_id
   FROM (work_orders wo
     JOIN users u ON ((u.employee_id = wo.assigned_mechanic_id)))
  WHERE (u.auth_user_id = auth.uid()))));

CREATE POLICY work_order_parts_log_select_staff ON public.work_order_parts_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY work_order_parts_used_select_staff ON public.work_order_parts_used AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY work_order_status_log_insert_staff_mechanic ON public.work_order_status_log AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Mechanic'::user_role_enum, 'Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY work_order_status_log_select_staff ON public.work_order_status_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY "Mechanics can update their own work orders" ON public.work_orders AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((assigned_mechanic_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))))
  WITH CHECK ((assigned_mechanic_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY "Mechanics can view their own work orders" ON public.work_orders AS PERMISSIVE FOR SELECT TO authenticated
  USING ((assigned_mechanic_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY "Staff can create work orders" ON public.work_orders AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY "Staff can view all work orders" ON public.work_orders AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = ANY (ARRAY['Admin'::user_role_enum, 'Dispatcher'::user_role_enum]))))));

CREATE POLICY mechanics_accept_unassigned_work_orders ON public.work_orders AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((assigned_mechanic_id IS NULL) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum))))))
  WITH CHECK ((assigned_mechanic_id = ( SELECT users.employee_id
   FROM users
  WHERE (users.auth_user_id = auth.uid()))));

CREATE POLICY mechanics_select_unassigned_work_orders ON public.work_orders AS PERMISSIVE FOR SELECT TO authenticated
  USING (((assigned_mechanic_id IS NULL) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Mechanic'::user_role_enum))))));

CREATE POLICY work_orders_update_staff ON public.work_orders AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_staff())
  WITH CHECK (is_staff());

-- ===== 13. Table grants (anon / authenticated) (53) =====

REVOKE ALL ON TABLE public.app_settings FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_settings TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.app_settings TO authenticated;

REVOKE ALL ON TABLE public.bill_payments FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bill_payments TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bill_payments TO authenticated;

REVOKE ALL ON TABLE public.bills FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bills TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bills TO authenticated;

REVOKE ALL ON TABLE public.booking_charges FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.booking_charges TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.booking_charges TO authenticated;

REVOKE ALL ON TABLE public.booking_payments FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.booking_payments TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.booking_payments TO authenticated;

REVOKE ALL ON TABLE public.bookings FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bookings TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.bookings TO authenticated;

REVOKE ALL ON TABLE public.cash_advances FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cash_advances TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cash_advances TO authenticated;

REVOKE ALL ON TABLE public.client_delinquency_log FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_delinquency_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_delinquency_log TO authenticated;

REVOKE ALL ON TABLE public.client_reviews FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_reviews TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_reviews TO authenticated;

REVOKE ALL ON TABLE public.client_status_requests FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_status_requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_status_requests TO authenticated;

REVOKE ALL ON TABLE public.clients FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.clients TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.clients TO authenticated;

REVOKE ALL ON TABLE public.creditors FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.creditors TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.creditors TO authenticated;

REVOKE ALL ON TABLE public.delivery_damage_records FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.delivery_damage_records TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.delivery_damage_records TO authenticated;

REVOKE ALL ON TABLE public.dispatch_status_logs FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dispatch_status_logs TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dispatch_status_logs TO authenticated;

REVOKE ALL ON TABLE public.employee_attendance FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_attendance TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_attendance TO authenticated;

REVOKE ALL ON TABLE public.employees FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees TO authenticated;

REVOKE ALL ON TABLE public.employment_status FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employment_status TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employment_status TO authenticated;

REVOKE ALL ON TABLE public.insurance_companies FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.insurance_companies TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.insurance_companies TO authenticated;

REVOKE ALL ON TABLE public.inventory_items FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_items TO authenticated;

REVOKE ALL ON TABLE public.inventory_lots FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_lots TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_lots TO authenticated;

REVOKE ALL ON TABLE public.inventory_movements FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_movements TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_movements TO authenticated;

REVOKE ALL ON TABLE public.issue_reports FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.issue_reports TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.issue_reports TO authenticated;

REVOKE ALL ON TABLE public.itineraries FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itineraries TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itineraries TO authenticated;

REVOKE ALL ON TABLE public.itinerary_crews FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itinerary_crews TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itinerary_crews TO authenticated;

REVOKE ALL ON TABLE public.itinerary_documents FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itinerary_documents TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itinerary_documents TO authenticated;

REVOKE ALL ON TABLE public.itinerary_expenses FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itinerary_expenses TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itinerary_expenses TO authenticated;

REVOKE ALL ON TABLE public.itinerary_schedule_logs FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itinerary_schedule_logs TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.itinerary_schedule_logs TO authenticated;

REVOKE ALL ON TABLE public.leave_requests FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.leave_requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.leave_requests TO authenticated;

REVOKE ALL ON TABLE public.location_reference FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.location_reference TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.location_reference TO authenticated;

REVOKE ALL ON TABLE public.maintenance_requests FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.maintenance_requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.maintenance_requests TO authenticated;

REVOKE ALL ON TABLE public.maintenance_schedules FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.maintenance_schedules TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.maintenance_schedules TO authenticated;

REVOKE ALL ON TABLE public.named_locations FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.named_locations TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.named_locations TO authenticated;

REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO authenticated;

REVOKE ALL ON TABLE public.parts_requests FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parts_requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.parts_requests TO authenticated;

REVOKE ALL ON TABLE public.payroll_payslips FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_payslips TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_payslips TO authenticated;

REVOKE ALL ON TABLE public.payslip_issue_reports FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payslip_issue_reports TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payslip_issue_reports TO authenticated;

REVOKE ALL ON TABLE public.payslip_line_items FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payslip_line_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payslip_line_items TO authenticated;

REVOKE ALL ON TABLE public.places FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.places TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.places TO authenticated;

REVOKE ALL ON TABLE public.quote_rate_offers FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.quote_rate_offers TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.quote_rate_offers TO authenticated;

REVOKE ALL ON TABLE public.quote_requests FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.quote_requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.quote_requests TO authenticated;

REVOKE ALL ON TABLE public.route_cache FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.route_cache TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.route_cache TO authenticated;

REVOKE ALL ON TABLE public.status_relog_requests FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.status_relog_requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.status_relog_requests TO authenticated;

REVOKE ALL ON TABLE public.trailers FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.trailers TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.trailers TO authenticated;

REVOKE ALL ON TABLE public.truck_odometer_log FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.truck_odometer_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.truck_odometer_log TO authenticated;

REVOKE ALL ON TABLE public.truck_profiles FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.truck_profiles TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.truck_profiles TO authenticated;

REVOKE ALL ON TABLE public.users FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.users TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.users TO authenticated;

REVOKE ALL ON TABLE public.work_order_acceptance_log FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_acceptance_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_acceptance_log TO authenticated;

REVOKE ALL ON TABLE public.work_order_completions FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_completions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_completions TO authenticated;

REVOKE ALL ON TABLE public.work_order_notes FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_notes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_notes TO authenticated;

REVOKE ALL ON TABLE public.work_order_parts_log FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_parts_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_parts_log TO authenticated;

REVOKE ALL ON TABLE public.work_order_parts_used FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_parts_used TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_parts_used TO authenticated;

REVOKE ALL ON TABLE public.work_order_status_log FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_status_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_order_status_log TO authenticated;

REVOKE ALL ON TABLE public.work_orders FROM anon, authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_orders TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.work_orders TO authenticated;

-- ===== 14. Function grants (77) =====

REVOKE ALL ON FUNCTION public._cap_ms(t timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._cap_ms(t timestamp with time zone) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public._cap_ms(t timestamp with time zone) TO anon;
GRANT EXECUTE ON FUNCTION public._cap_ms(t timestamp with time zone) TO authenticated;

REVOKE ALL ON FUNCTION public._inventory_actor(OUT o_employee_id integer, OUT o_role user_role_enum) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._inventory_check_usable(p_item inventory_items) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._inventory_open_work_order(p_work_order_id integer, p_role user_role_enum, p_employee_id integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._inventory_put(p_lot_id integer, p_qty numeric) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._inventory_receive(p_item_id integer, p_qty numeric, p_unit_cost numeric, p_received_at timestamp with time zone, p_note text, p_employee_id integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._inventory_take(p_item_id integer, p_qty numeric) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._inventory_use_on_completion(p_item inventory_items, p_qty numeric, p_completion_id integer, p_work_order_id integer, p_employee_id integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public._my_employee_id() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.accept_quote_counter(p_quote_id bigint, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_trip_plan jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_quote_counter(p_quote_id bigint, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_trip_plan jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_quote_counter(p_quote_id bigint, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_trip_plan jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.accept_quote_counter(p_quote_id bigint, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_trip_plan jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_stock(p_item_id integer, p_new_quantity numeric, p_reason text, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(p_item_id integer, p_new_quantity numeric, p_reason text, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_stock_by(p_item_id integer, p_change numeric, p_reason text, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock_by(p_item_id integer, p_change numeric, p_reason text, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.attach_payment_proof(p_payment_id integer, p_path text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_payment_proof(p_payment_id integer, p_path text) TO authenticated;

REVOKE ALL ON FUNCTION public.booking_downpayment(p_booking_id integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.can_view_trip_documents(p_itinerary_id integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_trip_documents(p_itinerary_id integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_trip_documents(p_itinerary_id integer) TO anon;
GRANT EXECUTE ON FUNCTION public.can_view_trip_documents(p_itinerary_id integer) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_work_order_parts(p_work_order_id integer, p_mode text, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_work_order_parts(p_work_order_id integer, p_mode text, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.change_my_username(p_username text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_my_username(p_username text) TO authenticated;

REVOKE ALL ON FUNCTION public.check_vehicle_slot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_vehicle_slot() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_vehicle_slot() TO anon;
GRANT EXECUTE ON FUNCTION public.check_vehicle_slot() TO authenticated;

REVOKE ALL ON FUNCTION public.close_part_request(p_request_id integer, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_part_request(p_request_id integer, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_work_order(p_work_order_id integer, p_description text, p_odometer numeric, p_next_service_date date, p_notes text, p_parts jsonb, p_new_items jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_work_order(p_work_order_id integer, p_description text, p_odometer numeric, p_next_service_date date, p_notes text, p_parts jsonb, p_new_items jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.count_bookings_for_clients(client_ids integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_bookings_for_clients(client_ids integer[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_bookings_for_clients(client_ids integer[]) TO anon;
GRANT EXECUTE ON FUNCTION public.count_bookings_for_clients(client_ids integer[]) TO authenticated;

REVOKE ALL ON FUNCTION public.create_bill(p_category text, p_description text, p_amount numeric, p_creditor_id integer, p_bill_date date, p_due_date date, p_reference_no text, p_note text, p_paid_now boolean, p_method text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bill(p_category text, p_description text, p_amount numeric, p_creditor_id integer, p_bill_date date, p_due_date date, p_reference_no text, p_note text, p_paid_now boolean, p_method text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_booking_from_quote(p_quote_id bigint) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_inventory_item(p_name text, p_item_type text, p_unit text, p_quantity numeric, p_unit_cost numeric, p_reorder_level numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_inventory_item(p_name text, p_item_type text, p_unit text, p_quantity numeric, p_unit_cost numeric, p_reorder_level numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.crew_slot_conflict(p_employee_id integer, p_itinerary_id integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.current_admin_employee_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_admin_employee_id() TO authenticated;

REVOKE ALL ON FUNCTION public.discard_draft_payslip(p_payroll_id bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_draft_payslip(p_payroll_id bigint) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_draft_payslip(p_payroll_id bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.discard_draft_payslip(p_payroll_id bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.free_vehicles_on_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_vehicles_on_delivery() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.free_vehicles_on_delivery() TO anon;
GRANT EXECUTE ON FUNCTION public.free_vehicles_on_delivery() TO authenticated;

REVOKE ALL ON FUNCTION public.get_capacity_inputs(p_from timestamp with time zone, p_to timestamp with time zone, p_exclude_quote bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_capacity_inputs(p_from timestamp with time zone, p_to timestamp with time zone, p_exclude_quote bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.get_login_email(p_username text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_login_email(p_username text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_login_email(p_username text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

REVOKE ALL ON FUNCTION public.get_trip_client_and_rate(p_itinerary_id integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trip_client_and_rate(p_itinerary_id integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trip_client_and_rate(p_itinerary_id integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_trip_client_and_rate(p_itinerary_id integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_trip_payment_status(p_itinerary_id integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trip_payment_status(p_itinerary_id integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_trip_storage_deadline(p_itinerary_id integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trip_storage_deadline(p_itinerary_id integer) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_client_signup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_client_signup() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_client_signup() TO anon;
GRANT EXECUTE ON FUNCTION public.handle_client_signup() TO authenticated;

REVOKE ALL ON FUNCTION public.inventory_items_guard_quantity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_items_guard_quantity() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_items_guard_quantity() TO anon;
GRANT EXECUTE ON FUNCTION public.inventory_items_guard_quantity() TO authenticated;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

REVOKE ALL ON FUNCTION public.itineraries_after_reschedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itineraries_after_reschedule() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.itineraries_after_reschedule() TO anon;
GRANT EXECUTE ON FUNCTION public.itineraries_after_reschedule() TO authenticated;

REVOKE ALL ON FUNCTION public.itinerary_crews_check_slot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itinerary_crews_check_slot() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.itinerary_crews_check_slot() TO anon;
GRANT EXECUTE ON FUNCTION public.itinerary_crews_check_slot() TO authenticated;

REVOKE ALL ON FUNCTION public.itinerary_crews_notify() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itinerary_crews_notify() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.itinerary_crews_notify() TO anon;
GRANT EXECUTE ON FUNCTION public.itinerary_crews_notify() TO authenticated;

REVOKE ALL ON FUNCTION public.itinerary_slot_defaults() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itinerary_slot_defaults() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.itinerary_slot_defaults() TO anon;
GRANT EXECUTE ON FUNCTION public.itinerary_slot_defaults() TO authenticated;

REVOKE ALL ON FUNCTION public.itinerary_trailer_fits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itinerary_trailer_fits() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.itinerary_trailer_fits() TO anon;
GRANT EXECUTE ON FUNCTION public.itinerary_trailer_fits() TO authenticated;

REVOKE ALL ON FUNCTION public.itinerary_trip_rate_default() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.itinerary_trip_rate_default() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.itinerary_trip_rate_default() TO anon;
GRANT EXECUTE ON FUNCTION public.itinerary_trip_rate_default() TO authenticated;

REVOKE ALL ON FUNCTION public.log_part_used(p_work_order_id integer, p_item_id integer, p_quantity numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_part_used(p_work_order_id integer, p_item_id integer, p_quantity numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.parts_requests_close_on_receive() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parts_requests_close_on_receive() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.parts_requests_close_on_receive() TO anon;
GRANT EXECUTE ON FUNCTION public.parts_requests_close_on_receive() TO authenticated;

REVOKE ALL ON FUNCTION public.pms_auto_schedule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_auto_schedule() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_auto_schedule() TO anon;
GRANT EXECUTE ON FUNCTION public.pms_auto_schedule() TO authenticated;

REVOKE ALL ON FUNCTION public.pms_reset_on_completion() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pms_reset_on_completion() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.pms_reset_on_completion() TO anon;
GRANT EXECUTE ON FUNCTION public.pms_reset_on_completion() TO authenticated;

REVOKE ALL ON FUNCTION public.post_stock_count(p_counts jsonb, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_stock_count(p_counts jsonb, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.quote_average_rate(p_cargo_lines jsonb, p_line_rates jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_average_rate(p_cargo_lines jsonb, p_line_rates jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_average_rate(p_cargo_lines jsonb, p_line_rates jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.quote_average_rate(p_cargo_lines jsonb, p_line_rates jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.receive_stock(p_item_id integer, p_quantity numeric, p_unit_cost numeric, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_stock(p_item_id integer, p_quantity numeric, p_unit_cost numeric, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_bill_payment(p_bill_id integer, p_amount numeric, p_method text, p_paid_on date, p_reference_no text, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_bill_payment(p_bill_id integer, p_amount numeric, p_method text, p_paid_on date, p_reference_no text, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_booking_payment(p_booking_id integer, p_amount numeric, p_method text, p_paid_on date, p_reference_no text, p_or_number text, p_note text, p_set_amount_to_pay numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_booking_payment(p_booking_id integer, p_amount numeric, p_method text, p_paid_on date, p_reference_no text, p_or_number text, p_note text, p_set_amount_to_pay numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.record_odometer_reading(p_plate_number text, p_reading numeric, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_odometer_reading(p_plate_number text, p_reading numeric, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.record_trip_km(p_itinerary_id integer, p_out_km numeric, p_trip_km numeric, p_back_km numeric, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_trip_km(p_itinerary_id integer, p_out_km numeric, p_trip_km numeric, p_back_km numeric, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.request_part(p_item_id integer, p_work_order_id integer, p_note text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_part(p_item_id integer, p_work_order_id integer, p_note text) TO authenticated;

REVOKE ALL ON FUNCTION public.require_crew_free_of_road() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_crew_free_of_road() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_crew_free_of_road() TO anon;
GRANT EXECUTE ON FUNCTION public.require_crew_free_of_road() TO authenticated;

REVOKE ALL ON FUNCTION public.require_downpayment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_downpayment() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_downpayment() TO anon;
GRANT EXECUTE ON FUNCTION public.require_downpayment() TO authenticated;

REVOKE ALL ON FUNCTION public.respond_to_quote_offer(p_quote_id bigint, p_action text, p_pickup_date date, p_deadline_date date, p_note text, p_line_rates jsonb, p_rate numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_quote_offer(p_quote_id bigint, p_action text, p_pickup_date date, p_deadline_date date, p_note text, p_line_rates jsonb, p_rate numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_quote_offer(p_quote_id bigint, p_action text, p_pickup_date date, p_deadline_date date, p_note text, p_line_rates jsonb, p_rate numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.respond_to_quote_offer(p_quote_id bigint, p_action text, p_pickup_date date, p_deadline_date date, p_note text, p_line_rates jsonb, p_rate numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.resubmit_quote_request(p_quote_id bigint, p_changes jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_quote_request(p_quote_id bigint, p_changes jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.return_logged_part(p_log_id integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_logged_part(p_log_id integer) TO authenticated;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO anon;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO authenticated;

REVOKE ALL ON FUNCTION public.send_quote_offer(p_quote_id bigint, p_pickup_date date, p_deadline_date date, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_note text, p_line_rates jsonb, p_rate numeric, p_trip_plan jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_quote_offer(p_quote_id bigint, p_pickup_date date, p_deadline_date date, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_note text, p_line_rates jsonb, p_rate numeric, p_trip_plan jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_quote_offer(p_quote_id bigint, p_pickup_date date, p_deadline_date date, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_note text, p_line_rates jsonb, p_rate numeric, p_trip_plan jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.send_quote_offer(p_quote_id bigint, p_pickup_date date, p_deadline_date date, p_distance_km numeric, p_hours_per_trip numeric, p_cost_per_trip numeric, p_note text, p_line_rates jsonb, p_rate numeric, p_trip_plan jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.set_client_active(p_client_id integer, p_active boolean, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_client_active(p_client_id integer, p_active boolean, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_item_archived(p_item_id integer, p_archived boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_item_archived(p_item_id integer, p_archived boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.set_item_price(p_item_id integer, p_unit_cost numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_item_price(p_item_id integer, p_unit_cost numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;

REVOKE ALL ON FUNCTION public.sync_bill_amount_paid() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_bill_amount_paid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_bill_amount_paid() TO anon;
GRANT EXECUTE ON FUNCTION public.sync_bill_amount_paid() TO authenticated;

REVOKE ALL ON FUNCTION public.sync_booking_amount_paid() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_booking_amount_paid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_booking_amount_paid() TO anon;
GRANT EXECUTE ON FUNCTION public.sync_booking_amount_paid() TO authenticated;

REVOKE ALL ON FUNCTION public.sync_booking_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_booking_status() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_booking_status() TO anon;
GRANT EXECUTE ON FUNCTION public.sync_booking_status() TO authenticated;

REVOKE ALL ON FUNCTION public.truck_odometer_log_direct() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.truck_odometer_log_direct() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.truck_odometer_log_direct() TO anon;
GRANT EXECUTE ON FUNCTION public.truck_odometer_log_direct() TO authenticated;

REVOKE ALL ON FUNCTION public.update_my_profile(p_changes jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile(p_changes jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.void_bill(p_bill_id integer, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_bill(p_bill_id integer, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.void_bill_payment(p_bill_payment_id integer, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_bill_payment(p_bill_payment_id integer, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.void_booking_payment(p_payment_id integer, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_booking_payment(p_payment_id integer, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.waive_downpayment(p_booking_id integer, p_reason text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.waive_downpayment(p_booking_id integer, p_reason text) TO authenticated;

REVOKE ALL ON FUNCTION public.withdraw_quote_request(p_quote_id bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_quote_request(p_quote_id bigint) TO authenticated;

-- ===== 15. Storage policies (storage.objects) (6) =====

CREATE POLICY payment_proofs_admin_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'payment-proofs'::text) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Admin'::user_role_enum))))));

CREATE POLICY payment_proofs_admin_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'payment-proofs'::text) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Admin'::user_role_enum))))));

CREATE POLICY payment_proofs_admin_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'payment-proofs'::text) AND (EXISTS ( SELECT 1
   FROM users
  WHERE ((users.auth_user_id = auth.uid()) AND (users.user_role = 'Admin'::user_role_enum))))));

CREATE POLICY trip_documents_delete_staff ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'trip-documents'::text) AND is_staff()));

CREATE POLICY trip_documents_insert_staff ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'trip-documents'::text) AND is_staff()));

CREATE POLICY trip_documents_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = 'trip-documents'::text) AND (is_staff() OR can_view_trip_documents(((storage.foldername(name))[1])::integer))));

-- ===== 16. Storage buckets (2) =====

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('payment-proofs', 'payment-proofs', false, 5242880, '{image/jpeg,image/png,image/webp,application/pdf}'::text[]) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('trip-documents', 'trip-documents', false, 10485760, '{application/pdf,image/jpeg,image/png,image/webp}'::text[]) ON CONFLICT (id) DO NOTHING;
