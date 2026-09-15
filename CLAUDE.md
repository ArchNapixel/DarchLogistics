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
  never touches bookings/itineraries. QuoteReviewModal also shows a
  profitability side panel once a distance is entered — computes diesel
  cost (`app_settings.diesel_price_per_liter × km`), driver commission,
  and per-trip fee against the proposed rate × delivery count, and flags
  when costs reach ≥50% of contract value. Reads real `app_settings`
  data; informational only, doesn't block Approve/Reject.
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
- Mechanic work orders — fully rebuilt. Maintenance section (staff), 
  Create Work Order modal, Task Board (mechanics self-assign unclaimed 
  orders, race-safe accept), and MechanicTasks (status dropdown) are all 
  wired to real Supabase data.
  Completing a work order (`employee/CompleteWorkOrderModal.tsx`, opened 
  when a mechanic picks "Completed" in MechanicTasks.tsx's status dropdown 
  instead of updating the status directly) requires filling in a form 
  first: description of work done, a repeatable parts-used list, optional 
  labor hours/odometer reading/next service date/notes. Every part used 
  is linked to a real `inventory_items` row (`item_id`) — no free-text 
  parts. The parts-used list is a searchable dropdown over 
  `inventory_items`; typing something with no match offers "+ Add as a 
  new inventory item" (name/type/starting quantity), which stages a 
  brand-new item for that row without touching the DB yet. On submit 
  (steps run in sequence, not in a DB transaction — same known limitation 
  as QuoteReviewModal/payslip.ts — a failure partway surfaces a specific 
  "needs manual review" message naming what was/wasn't saved):
  1. Insert any staged brand-new `inventory_items` rows, capture `item_id`
  2. Insert one `work_order_completions` row (`work_order_id, employee_id, 
     description, labor_hours, odometer_reading, next_service_date, 
     notes, completed_at`)
  3. Insert one `work_order_parts_used` row per part 
     (`completion_id, item_id, item_name_text, quantity` — 
     `item_name_text` is a denormalized snapshot of the item's name at 
     the time it was used, not user-editable free text; new items added 
     inline default to item_type `'Parts'`, not the first dropdown entry)
  4. Re-check current stock fresh from the DB (not the value from when 
     the modal opened) and decrement `inventory_items.quantity` per part 
     — blocks with a clear error instead of going negative if someone 
     else used the same part in the meantime
  5. Update `work_orders.work_order_status` to `'Completed'`
  6. If the work order is for a truck (`plate_number` set, not a 
     trailer): update `truck_profiles.current_odometer` (rejected if not 
     higher than the truck's current recorded value, re-checked fresh at 
     submit time) and, if a next service date was given, 
     `truck_profiles.next_service_date` + `last_service_date` (set to 
     today)
  
  `maintenance_requests` and `inspection_reports` (also mentioned as 
  removed in the old schema cleanup) still don't exist and haven't been 
  rebuilt — only `work_orders` and its two completion-tracking tables.
- Fleet (`/dashboard/fleet`, FleetSection) — Trucks and Trailers tabs, both 
  reading real Supabase data (`truck_profiles`, `trailers`) with loading/
  error states and status badges. Full Add/Edit/Delete for both (AddTruckModal,
  AddTrailerModal), FK-violation-aware delete error handling, plus a
  "Create Work Order" quick action per vehicle.
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
  is the real HR record and covers drivers without a login too). A Helper
  can be assigned the same way, via `itinerary_crews` with
  `crew_role: 'Helper'` (same deactivate-then-insert history pattern,
  assignable list from `users` where `user_role = 'Helper'`). Truck and
  trailer are also assignable per itinerary — `itineraries` has its own
  `plate_number`/`trailer_id` columns, and the Dispatch Board writes to
  them directly (plain overwrite, no assignment-history table, unlike
  the Driver/Helper crew assignment above).
- Employees (`/dashboard/employees`, EmployeesSection + AddEmployeeModal) —
  fully wired to `employees`/`employment_status`/`users`. Search/position/
  status filters, Edit, Delete (FK-violation-aware error handling), and
  "Set Up Account" (SetUpStaffAccountModal, via the `create-user-account`
  Edge Function).
- Payroll & Payslips — `lib/payslip.ts` is the shared pay-calculation
  engine: Drivers earn a commission % + per-trip fee on delivered trips
  (`bookings.rate_of_delivery_service` via `delivery_receipts` in the pay
  period), Mechanic/Dispatcher/Helper get a flat weekly salary, everyone
  gets a daily allowance — all configurable via `app_settings`. Admin
  issues payslips (`IssuePayslipModal`, previews line items, lets admin
  apply a cash-advance deduction bounded by outstanding balance) and cash
  advances directly (`IssueCashAdvanceModal`, inserts into
  `cash_advances` with `status: 'Approved'` implicitly via its DB
  default, never auto-deducted). PayrollSection (`/dashboard/payroll`)
  lists/marks-paid. Employees see their own payslip history
  (`MyPayslipSection`/`MyPayslipPage`), Dispatchers via their own
  restricted view (`DispatcherPayslipSection`). `issuePayslip()` isn't
  wrapped in a DB transaction — a failure partway surfaces a "needs
  manual review" error naming the created `payroll_id` instead of
  failing silently.
  - Driver-initiated cash advance requests — `cash_advances` gained
    `status` (`'Pending'`/`'Approved'`/`'Rejected'`, `text` + `CHECK`,
    not an enum — default `'Approved'` so `IssueCashAdvanceModal`
    needed zero code changes and every pre-existing row stayed valid),
    `approved_by`, `approved_at`, `rejection_reason`. New shared lib
    `lib/cashAdvanceRequests.ts`: `requestCashAdvance()` (inserts
    `status: 'Pending'`, reuses the existing `note` column for the
    employee's reason), `loadCashAdvanceRequestsForEmployee()`,
    `loadPendingCashAdvanceRequests()`, `decideCashAdvanceRequest()`
    (race-guarded the same way `TaskBoard.tsx`'s accept is — only
    updates if still `Pending`, tells the caller if someone else
    already decided it). Employee side (Driver/Mechanic/Helper only,
    NOT Dispatcher): `employee/RequestCashAdvanceModal.tsx` (amount +
    reason) and `employee/MyCashAdvanceRequestsSection.tsx` ("My
    Requests" list with status badges), mounted in `MyPayslipPage.tsx`
    only — `DispatcherPayslipSection.tsx` is untouched. Staff side:
    `staff/CashAdvanceRequestsSection.tsx`, a "Pending Cash Advance
    Requests" panel on the Payroll page with Approve/Reject (Reject
    prompts for a reason via `window.prompt`, same pattern as
    `FinancialSection.tsx`). `getOutstandingCashAdvance()` in
    `payslip.ts` was fixed to filter `status = 'Approved'` — a
    `'Pending'` request hasn't actually been given to the employee yet,
    so it must not inflate what gets deducted from their next payslip.
  - "View Cash Advance Ledger" — effectively covered, not a gap, per
    team decision. No dedicated all-employees ledger page exists, and
    none is needed: outstanding balance per employee is available via
    `IssuePayslipModal` (calls `getOutstandingCashAdvance()`), the
    "Pending Cash Advance Requests" panel handles approve/reject, and
    each employee's payslip table shows historical cash advance
    deductions per pay period. Note for later: `getOutstandingCashAdvance()`
    is a pooled running balance (`sum of Approved cash_advances.amount`
    minus `sum of payroll_payslips.cash_advance_deducted`, both summed
    across the employee's whole history) — it does NOT track which
    specific `cash_advances` row a given deduction paid off, since
    `payslip_line_items` has no reference back to `cash_advances` at
    all. That's fine for the aggregate balance this feature needs, but
    if a future feature ever needs *per-advance* settlement status
    (e.g. "is this specific ₱500 advance paid off"), that can't be
    read from existing data and would need new tracking (FIFO
    attribution would be the natural choice).
- Financial Records / Payments Due — `lib/paymentDue.ts` calculates what
  each client owes from delivered trips, payment terms, and delivery
  receipt dates. FinancialSection (`/dashboard/financial-records`) is
  where staff record/override payments on `bookings.amount_to_pay` /
  `amount_paid`. `PaymentDuePanel` (read-only, shown beside Bookings) and
  the Reports "Payments Due" tab reuse the same calculation.
- Inventory (`/dashboard/inventory`, InventorySection + 
  AddInventoryItemModal) — CRUD over `inventory_items` 
  (Tools/Parts/Supplies/Equipment/Other), same FK-violation-aware delete
  pattern as Employees.
- "My History" (`/dashboard/history`, HistorySection) — Driver/Helper see
  real trip history via `itinerary_crews` → `itineraries` (filtered by
  `crew_role`), Mechanic sees real work order history via `work_orders`.
- Reports (`/dashboard/reports`, ReportsSection) — partially real: the
  "Payments Due" tab reuses `paymentDue.ts` (same as above) and is fully
  real. The "Overview" tab (Revenue/Delivery Performance/Fleet
  Utilization cards) is still hardcoded `// MOCK DATA`.

## Currently in progress
Nothing is actively mid-build right now.

## Not started yet
- Quotation module beyond public form (approve/reject flow already exists —
  this refers to anything further)
- Reports "Overview" tab — still hardcoded mock (see above); wiring it to
  real revenue/delivery/fleet data is still to be done.

## Schema reality check
Live DB is a snake_case subset of the full design doc (see memory) — not
all 88 tables exist yet. Tables actually queried by the app right now
(confirmed via grep of `.from(...)` calls in `src/`):
`bookings`, `clients`, `delivery_damage_records`, `delivery_receipts`,
`dispatch_status_logs`, `employees`, `issue_reports`, `itineraries`,
`itinerary_crews`, `itinerary_expenses`, `places`, `quote_requests`,
`trailers`, `truck_profiles`, `users`, `work_orders`,
`work_order_completions`, `work_order_parts_used`, `inventory_items`,
`app_settings`, `cash_advances`, `employment_status`,
`payroll_payslips`, `payslip_line_items`, `route_cache`.

`work_orders`, `work_order_completions`, `work_order_parts_used`,
`truck_profiles`, and `inventory_items` had their exact column names
confirmed live via the REST API (probing `?select=col1,col2,...` — a
bad column name gets an immediate `42703` error from PostgREST
regardless of RLS, so this works even when RLS blocks the actual rows)
before the Mechanic work-order-completion flow was built against them.

`cash_advances` gained `status`, `approved_by`, `approved_at`, and
`rejection_reason` columns this session (added directly in Supabase, no
tracked migration file) to support employee-initiated requests — see
the Payroll & Payslips bullet above. Original columns
(`cash_advance_id, employee_id, amount, note, created_at`) confirmed
live the same REST-probing way before the change.

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

**The "INSERT + `.select()` needs a SELECT policy too" trap:** if code
does `.insert({...}).select('col').single()` (asking Postgres to
`RETURNING` the new row), the insert can be fully permitted by its
`WITH CHECK` and still fail with **the exact same error text** as a
`WITH CHECK` failure — `"new row violates row-level security policy for
table X"` — if there's no `SELECT` policy letting that row be read back.
Hit this on `work_order_completions`: the `INSERT` policy's `EXISTS`
check was proven true (role and `auth_user_id` both matched), but the
insert still failed until a `SELECT` policy was added. **If an insert
with `.select()` fails this way, check for a missing SELECT policy
before re-checking the WITH CHECK logic** — plain `.insert({...})` with
no `.select()` chained doesn't need one (matches `work_order_parts_used`,
which only ever does a bare insert).

**The "staff account with no linked `employees` row" trap:** this isn't
RLS at all, but looks similar — a write can go through fine at the
database level and still silently do nothing in the app if code checks
`if (!employeeId) return` before calling Supabase, since `employeeId`
comes from `users.employee_id` (see AuthContext.tsx) and can be `NULL`
for an old/seed account. Hit this with the original `admin` account
(`user_id: 1`) when building cash advance Approve/Reject — the button
did *nothing at all* (no error, no loading state) because `employeeId`
was `null`, not because of a missing policy. **If a button does
literally nothing (not even an error), check whether the logged-in
staff account actually has an `employees` row linked via
`users.employee_id` before assuming it's an RLS or code bug** — fixed
by adding a real `employees` row for that account (via the Employees
page) and running `update public.users set employee_id = <id> where
user_id = <id>`. Worth checking other Admin/Dispatcher test accounts
for the same gap, since anything that records "who did this"
(`changed_by`, `approved_by`, etc.) depends on it.

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
- `cash_advances` — `INSERT` for an employee inserting their own
  `Pending` request (`cash_advances_insert_own_employee`, employee-side
  request submission confirmed working) and `UPDATE` for staff to
  Approve/Reject (`cash_advances_update_staff`, `is_staff()`) — the
  Approve/Reject action itself was still blocked by the missing-
  `employees`-link trap above as of end of session; hasn't been
  re-tested since that account was fixed
- `inventory_items` — `SELECT`/`INSERT`/`UPDATE` for Mechanics + staff,
  `work_order_completions` — `INSERT` + `SELECT` for Mechanics (needed
  the `.insert().select()` RETURNING policy from the gotcha above —
  this is exactly where that gotcha was hit and fixed), `work_order_parts_used`
  — `INSERT` for Mechanics (no `SELECT` needed, no `.select()` chained) —
  confirmed working end-to-end via a real completion of a work order
- `cash_advances` — `SELECT` for staff (`is_staff()`) and `SELECT` for
  an employee's own rows (both pre-existing, already in place before
  this session) confirmed still correct

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