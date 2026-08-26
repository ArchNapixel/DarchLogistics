 # Darch Logistics — Project Context

## Stack
React + Vite, Tailwind CSS, Supabase (JS client, already connected — 
don't touch env vars or the Supabase client setup file).

## User is a beginner coder
Keep code simple, well-commented. Explain briefly what each file does 
before creating it.

## What's already built (DO NOT rebuild or touch these)
- Public landing page with nav, hero, About section
- Public quote request form (inserts into `quote_requests`)
- Staff login/logout (Supabase Auth) + protected route wrapper
- 3-tier role routing: isStaff() (Admin/Dispatcher), isEmployee() (Driver/Mechanic)
- StaffDashboard (Admin + Dispatcher — full working dashboard)
- EmployeeDashboard shared shell (MyTasksSection) — one page for both roles, 
  branches internally on `role` to render DriverTasks or MechanicTasks
- Driver task flow — fully built and wired to real Supabase tables:
  - Section 1: My Tasks trip list
  - Section 2: Update Trip Status (advances `itineraries.itinerary_status` 
    step by step, logs each change to `dispatch_status_logs`; marking a trip 
    "Delivered" opens DeliveryReceiptModal, which records `delivery_receipts` 
    and, if damaged, `delivery_damage_records`)
  - Section 3: Report Issue (inserts into `issue_reports`)
  - Section 4: Add Trip Expense (inserts into `itinerary_expenses`)
- Mechanic "My Tasks" — intentionally a placeholder (ComingSoonPage), not 
  broken. The `work_orders` table (plus `maintenance_requests` and 
  `inspection_reports`) was removed in a schema cleanup and hasn't been 
  rebuilt — rebuilding this is a scope decision still pending with the team.
- Staff sidebar page shells (Bookings, Dispatch Board, Fleet, Employees, 
  Payroll, Reports) and the employee "My History" page — see "UI-only 
  screens" below, these have real UI but mock data only

## Currently in progress
Nothing is actively mid-build right now. Next up: wiring the mock-data 
pages listed below to real Supabase tables, one page at a time, confirming 
exact table/column names before each (per the rule below).

## UI-only screens (mock data, NOT wired to Supabase yet)
These pages have finished-looking UI with hardcoded/mock data, but no real
backend behind them — no Supabase queries, no persistence. Don't assume
they're functional. Each file has a `// MOCK DATA` comment marking the
fake data:
- `/dashboard/bookings` — BookingsSection, NewBookingModal, BookingDetailModal
- `/dashboard/dispatch` — DispatchBoardSection (status dropdown updates
  local state only)
- `/dashboard/fleet` — FleetSection (Trucks/Trailers tabs)
- `/dashboard/employees` — EmployeesSection, AddEmployeeModal
- `/dashboard/payroll` — PayrollSection
- `/dashboard/reports` — ReportsSection
- `/dashboard/history` — HistorySection (Driver/Mechanic "My History")

Wiring these up to real Supabase tables/columns is still to be done —
confirm schema first per the rule below.

## Not started yet
- Quotation module beyond public form (approve/reject flow already exists —
  this refers to anything further)
- Wiring the 7 mock-data pages (see "UI-only screens" above) to real
  Supabase queries
- Rebuilding Mechanic work order tracking (`work_orders` and friends) —
  blocked on a team scope decision, not just a build task

## Schema reality check
Live DB is a snake_case subset of the full design doc (see memory) — not
all 88 tables exist yet. Tables actually queried by the app right now
(confirmed via grep of `.from(...)` calls in `src/`):
`bookings`, `clients`, `delivery_damage_records`, `delivery_receipts`,
`dispatch_status_logs`, `issue_reports`, `itineraries`, `itinerary_crews`,
`itinerary_expenses`, `places`, `quote_requests`, `trailers`,
`truck_profiles`, `users`.

`issue_reports` and `itinerary_expenses` were added to this list today —
both confirmed reachable via the Supabase REST API (200 response) before
adding them here, not assumed from the code alone.

## Rules
- Before any Supabase query, confirm exact table/column names with me — 
  never guess schema
- Build one feature/section at a time, stop after each for testing