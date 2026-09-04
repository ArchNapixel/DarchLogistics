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
- Quotations (`/dashboard/quotations`, QuoteRequestsSection +
  QuoteReviewModal) — Approve finds-or-creates the `clients` row, creates 2
  `places` rows, marks the quote `Approved`, creates the `bookings` row
  (`booking_status: 'Draft'`, `rate_of_delivery_service` set from the
  approved rate), then creates a matching `itineraries` row
  (`itinerary_status: 'Awaiting'`) linked to that booking. Staff sets the
  itinerary's `trip_date_from` in the modal (pre-filled from the quote's
  preferred pickup date when set); Approve is blocked until it's filled in.
  If the itinerary insert fails after the booking was already created, the
  modal shows an explicit "needs manual review" error instead of failing
  silently — steps aren't wrapped in a DB transaction yet. Reject prompts
  for a reason, sets `request_status: 'Rejected'` + `rejection_reason`, and
  never touches bookings/itineraries.
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
- Fleet (`/dashboard/fleet`, FleetSection) — Trucks and Trailers tabs, both 
  reading real Supabase data (`truck_profiles`, `trailers`) with loading/
  error states and status badges. Read-only for now — no insert/update yet.
- Bookings (`/dashboard/bookings`, BookingsSection + BookingDetailModal) —
  reads real `bookings`, joined in JS (not a Supabase embedded select) with
  `clients` (client_name) and `places` (pickup/delivery names), same
  lookup-by-id pattern as DriverTasks.tsx. Detail view shows real
  `rate_of_delivery_service`, `amount_to_pay`, `amount_paid`, `balance_due`
  (no fabricated "payment status" label — those columns are mostly still
  null until a payments flow exists). "New Booking" (NewBookingModal) is
  still a no-op placeholder — real bookings are currently only created via
  the Quotations Approve flow.
- Dispatch Board (`/dashboard/dispatch`, DispatchBoardSection) — reads
  active itineraries (`itinerary_status` not in Delivered/Cancelled),
  joined in JS with `places` for pickup/delivery names. Status dropdown
  writes real `itineraries.itinerary_status` updates and logs each change
  to `dispatch_status_logs` (same pattern as the Driver's own
  UpdateStatusControl.tsx) — reaching "Delivered" drops the row off the
  board. Driver dropdown assigns via `itinerary_crews`: reassigning
  deactivates the previous active `crew_role: 'Driver'` row
  (`is_active: false`, `completed_at` set) rather than deleting it, then
  inserts a new active row — keeps an assignment history. The list of
  assignable drivers comes from `users` where `user_role = 'Driver'`,
  cross-referenced to `employees` for `full_name` (display names come from
  `employees`, not `users.username`, per a deliberate choice — `employees`
  is the real HR record and covers drivers without a login too).
- Staff sidebar page shells (Employees, Payroll, Reports) 
  and the employee "My History" page — see "UI-only screens" below, these 
  have real UI but mock data only

## Currently in progress
Nothing is actively mid-build right now. Next up: wiring the mock-data 
pages listed below to real Supabase tables, one page at a time, confirming 
exact table/column names before each (per the rule below).

## UI-only screens (mock data, NOT wired to Supabase yet)
These pages have finished-looking UI with hardcoded/mock data, but no real
backend behind them — no Supabase queries, no persistence. Don't assume
they're functional. Each file has a `// MOCK DATA` comment marking the
fake data:
- `/dashboard/employees` — EmployeesSection, AddEmployeeModal
- `/dashboard/payroll` — PayrollSection
- `/dashboard/reports` — ReportsSection
- `/dashboard/history` — HistorySection (Driver/Mechanic "My History")

Wiring these up to real Supabase tables/columns is still to be done —
confirm schema first per the rule below.

## Not started yet
- Quotation module beyond public form (approve/reject flow already exists —
  this refers to anything further)
- Wiring the 4 remaining mock-data pages (Employees, Payroll, Reports,
  My History — see "UI-only screens" above) to real Supabase queries
- Rebuilding Mechanic work order tracking (`work_orders` and friends) —
  blocked on a team scope decision, not just a build task

## Schema reality check
Live DB is a snake_case subset of the full design doc (see memory) — not
all 88 tables exist yet. Tables actually queried by the app right now
(confirmed via grep of `.from(...)` calls in `src/`):
`bookings`, `clients`, `delivery_damage_records`, `delivery_receipts`,
`dispatch_status_logs`, `employees`, `issue_reports`, `itineraries`,
`itinerary_crews`, `itinerary_expenses`, `places`, `quote_requests`,
`trailers`, `truck_profiles`, `users`.

`issue_reports` and `itinerary_expenses` were confirmed reachable via the
Supabase REST API (200 response) before being added to this list.
`employees` is also confirmed live and reachable the same way — it's part
of the full 88-table design doc, but exists in the actual DB too, unlike
most of that doc. Note: `itinerary_crews.employee_id` has no formal
foreign key to `employees` in the migration (it's just an unconstrained
integer), but the app treats it as referencing `employees.employee_id`
via the shared ID space also used by `users.employee_id`.

## Row Level Security (RLS) — status and gotchas
RLS is enabled on every table we've touched so far, and almost none of
them had policies for the app's actual access patterns going in — every
table hit at least one missing-policy error today. Two failure shapes to
recognize, since they look different:
- **INSERT with no matching policy → hard error.** Supabase throws "new
  row violates row-level security policy for table X" immediately, so
  it's obvious.
- **SELECT or UPDATE with no matching policy → silent no-op, zero
  errors.** A blocked `SELECT` just returns an empty array (looked like
  "no data yet" for `quote_requests`/`clients`/etc.). A blocked `UPDATE`
  reports success but touches 0 rows (this is what made approved quotes
  keep reappearing after Approve — the `quote_requests` UPDATE was
  silently doing nothing while the booking/itinerary inserts after it
  succeeded normally). **If a write "succeeds" with no error but the data
  doesn't look right afterward, check for a missing UPDATE policy before
  assuming the code is wrong.**

**The `is_staff()` recursion incident:** a `SELECT` policy added directly
on the `users` table, whose own check queried `users` again, caused
infinite recursion and broke ALL access to `users` — including the
core login role-lookup every single user depends on (showed as "Could
not load your account role" for everyone, not just the new use case).
Fixed by replacing raw subqueries with a `SECURITY DEFINER` helper
function (bypasses RLS internally, so it can't self-trigger):
```sql
create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where users.auth_user_id = auth.uid()
    and users.user_role in ('Admin', 'Dispatcher')
  );
$$;
```
**Rule of thumb: a policy attached to table X must never query table X
in its own USING/WITH CHECK clause — use `is_staff()` (or a similar
function) instead.** Every other policy below queries `users` from a
policy on a *different* table, which is safe — only a policy living on
`users` itself needs the function.

**Confirmed working today** (staff successfully completed the action):
- `quote_requests` — `SELECT` for staff
- `clients` — `SELECT` + `INSERT` for staff
- `places` — `INSERT` for staff, `SELECT` for any `authenticated` user
  (opened wider on purpose — Drivers and the Bookings page both need to
  read place names, and place names aren't sensitive)
- `bookings` — `INSERT` for staff
- `itineraries` — `INSERT` for staff

**Given as a fix, not yet re-tested/confirmed:**
- `quote_requests` — `INSERT` for `anon` (public form) — got tangled in a
  "I already have that policy" back-and-forth that never resolved before
  the login emergency took over; **the public quote form may still be
  broken**, needs an actual resubmit test
- `quote_requests` — `UPDATE` for staff — this is the fix for the
  "approved quote keeps reappearing" bug; also silently fixes Reject
  (same missing-policy bug, same table) — needs re-testing on both
  Approve and Reject
- `itineraries` — `SELECT` + `UPDATE` for staff, `itinerary_crews` —
  `SELECT`/`INSERT`/`UPDATE` for staff, `employees` — `SELECT` for staff,
  `dispatch_status_logs` — `INSERT` for staff, `users` — `SELECT` for
  staff (via `is_staff()`, post-recursion-fix) — all given together for
  the Dispatch Board; likely applied (no errors reported on these
  specifically) but the Dispatch Board itself — loading itineraries,
  changing status, assigning a driver — hasn't been confirmed working
  end-to-end since the login incident interrupted testing
- `bookings` — `SELECT` for staff (view all) and `SELECT` for clients
  (own bookings only, via `client_id` match) — given alongside the
  `bookings` INSERT fix, never separately confirmed

**Known gaps — not hit yet because that flow hasn't been tested since RLS
went on, but almost certainly needs a policy:**
- `itineraries` `UPDATE` for **Drivers** — the current `UPDATE` policy is
  staff-only, but `UpdateStatusControl.tsx` and `DeliveryReceiptModal.tsx`
  update `itineraries` as a Driver. This one can't just reuse
  `is_staff()` — it needs to check that the itinerary is actually
  assigned to the logged-in driver via `itinerary_crews`, not a flat role
  check.
- `delivery_receipts` / `delivery_damage_records` — `INSERT` for Drivers
  (`DeliveryReceiptModal.tsx`)
- `issue_reports` — `INSERT` for Drivers (`ReportIssueModal.tsx`)
- `itinerary_expenses` — `INSERT` for Drivers (`AddExpenseModal.tsx`)
- `users` — `UPDATE` for a Client claiming their own pending row on first
  login (the `auth_user_id` auto-link in `AuthContext.tsx`), and
  `INSERT` for staff creating that pending row in the first place
  (`SetUpClientAccountModal.tsx`)

## Rules
- Before any Supabase query, confirm exact table/column names with me — 
  never guess schema
- Build one feature/section at a time, stop after each for testing