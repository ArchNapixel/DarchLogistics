CREATE TABLE IF NOT EXISTS public.employee_attendance (
  attendance_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_id integer NOT NULL,
  attendance_date date NOT NULL,
  attendance_status text NOT NULL DEFAULT 'Present',
  hours_worked numeric,
  notes text,
  recorded_by integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT employee_attendance_pkey PRIMARY KEY (attendance_id),
  CONSTRAINT employee_attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id),
  CONSTRAINT employee_attendance_status_check CHECK (attendance_status IN ('Present', 'Absent', 'Leave')),
  CONSTRAINT employee_attendance_employee_date_key UNIQUE (employee_id, attendance_date)
);