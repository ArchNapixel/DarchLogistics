ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS driver_license_number character varying,
  ADD COLUMN IF NOT EXISTS driver_license_expiry_date date,
  ADD COLUMN IF NOT EXISTS medical_exam_date date,
  ADD COLUMN IF NOT EXISTS medical_exam_expiry_date date;