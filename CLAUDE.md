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
- 4 role trees in `DashboardRouter.tsx`: Admin (full `staffLinks` sidebar),
  **Dispatcher** (its own restricted sidebar: Dispatch Board, Bookings,
  Damage Charges, Quotations, My Payslips — lands on `/dashboard/dispatch`
  directly instead of the KPI page, and can't see Employees/Payroll/Fleet/
  Maintenance/Inventory/Reports/Settings), Employee (Driver/Mechanic/
  Helper), and Client. `isStaff()` covers Admin+Dispatcher, `isEmployee()`
  covers Driver/Mechanic/Helper, for broader checks outside routing.
- StaffDashboard (Admin — full working dashboard)
- Client portal (`ClientDashboard.tsx`, role `Client`) — profile edit, own
  bookings list with itinerary drilldown, a payments-due panel (reuses
  `lib/paymentDue.ts`), submitting a status-change request
  (`ClientStatusRequestModal.tsx` → `client_status_requests`, staff review
  in `staff/ClientStatusRequestsSection.tsx`), a 1–5 star review (upsert
  into `client_reviews`, one per client — staff can "Feature" a review to
  the public landing page in `staff/ClientReviewsSection.tsx`, anonymized
  via the `count_bookings_for_clients` RPC so the public page never reads
  `bookings` directly), and submitting a new quote (`NewQuoteModal.tsx`,
  uses the same `LocationPicker` as the public quote form).
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
    step by step up to **In Transit only**, logs each change to
    `dispatch_status_logs`. Drivers can't mark Delivered — see the
    2026-09-29 receipts-removal note under Dispatch Board)
  - Section 3: Report Issue (inserts into `issue_reports`)
  - Section 4: Add Trip Expense (inserts into `itinerary_expenses`)
  - **2026-09-29 driver-portal audit fixes:** trip lists, History,
    EmployeeDetailModal and driver commission (`payslip.ts`) all filter
    `itinerary_crews.is_active = true` (a reassigned-off driver no
    longer sees or gets paid for the trip). Status advance is one
    "Mark as X" button + confirm, guarded with
    `.eq('itinerary_status', current).select().maybeSingle()`, blocked
    out of Awaiting until a truck is assigned. Truck/trailer are freed on Delivered by the DB trigger
    `free_vehicles_on_delivery` (SECURITY DEFINER, only if still
    `In Transit` and not on another active trip) — the Dispatch Board's
    JS version was removed. Helpers now get the same trip list
    read-only (`DriverTasks crewRole="Helper"`). `ReportIssueModal` was
    deleted — `InspectionReportModal` covers it with a "General issue"
    option, launched from the EmployeeDashboard header for every role.
    Trip expenses show on the driver's trip card and in staff
    `BookingDetailModal`'s trips table. RLS added the same day:
    `delivery_damage_records` SELECT/UPDATE for staff (Damage Charges
    was empty before), `itinerary_expenses` INSERT restricted to the
    active crew member + SELECT for staff + SELECT own rows
    (`itinerary_expenses_select_own`).
    My History trip rows (Driver/Helper) are clickable → `TripDetailModal`
    (inside `HistorySection.tsx`): client name, trip rate, route, dates,
    truck/trailer, own expenses. Client name + rate
    come from the RPC `get_trip_client_and_rate(p_itinerary_id)`
    (SECURITY DEFINER, returns only those 2 fields and only if the
    caller is active crew on that trip) — crew still can't read
    `bookings`/`clients` directly, on purpose (payment balances).
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
  
  `maintenance_requests` and `inspection_reports` — **superseded**: both
  now exist and are built (see "Maintenance Requests & Scheduling" and
  the Inspection Report note below); this bullet's old "don't exist"
  claim is stale.
  Also new since the above was written: `employee/AccessWorkOrderModal.tsx`
  (Mechanic, opened from an in-progress work order, not the Completed
  step) — mid-job progress notes (`work_order_notes`) and logging parts
  *used so far* (`work_order_parts_log`, decrements `inventory_items`
  immediately, fresh-read-before-decrement race guard same as step 4
  above). Deliberately separate from `work_order_parts_used`: at
  Completion, `CompleteWorkOrderModal.tsx` copies the already-logged
  parts into `work_order_parts_used` for the permanent record **without**
  decrementing stock a second time (it was already decremented when
  logged). Read-only admin viewers for history: `WorkOrderAcceptanceLogSection`,
  `WorkOrderStatusLogSection`, `DispatchStatusLogSection`.
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
  null until a payments flow exists). Real bookings are only created via
  the Quotations Approve flow (NewBookingModal no longer exists).
  **2026-09-28 rework:** Approve creates bookings as `Confirmed` (not
  `Draft`); status then follows the trips via the trigger described
  under Dispatch Board. List has status filter (Active/Delivered/
  Cancelled/All) + search (client, place, #id, Q- reference), full
  addresses incl. landmark. Delete was removed — bookings are
  **cancelled** from `BookingDetailModal` instead (`cancellation_reason`,
  `cancelled_at` columns): blocked while a trip is on the road; if no
  trip delivered → booking `Cancelled` + Awaiting trips `Cancelled`; if
  some delivered → only Awaiting trips cancelled and the booking ends
  `Delivered` (so delivered trips still bill — Payments Due/revenue skip
  Cancelled bookings). Freed trucks/trailers set back to `Available`,
  each trip change logged to `dispatch_status_logs`. The detail modal
  also shows cargo, schedule, terms, pin links, and a trips table
  (status/driver/helper/truck/trailer).
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
  **2026-09-29 dispatcher audit — delivery receipts removed:**
  `delivery_receipts` table dropped, `DeliveryReceiptModal` deleted.
  Only Dispatcher/Admin mark a trip Delivered: choosing Delivered on
  the board opens `staff/MarkDeliveredModal.tsx` (cargo condition +
  optional damage → `delivery_damage_records`, which now has
  `itinerary_id` instead of `delivery_receipt_id`; INSERT is staff-only,
  `delivery_damage_records_insert_staff`). The Delivered log row's
  `status_changed_at` is the delivery date for payroll/Payments Due
  (old receipt dates were backfilled into `dispatch_status_logs`).
  Board status changes are guarded (`.eq('itinerary_status', prev)`
  + `.select().maybeSingle()`), Dispatcher's dropdown offers only the
  next step, nobody can leave Awaiting without a truck, and status
  correction requests only offer earlier statuses; approving one is
  guarded the same way (`statusRelogRequests.ts`). The Completed
  (Delivered) table is read-only for crew/truck/trailer (Admin keeps
  the status dropdown) and starts collapsed. Truck/trailer dropdowns
  disable vehicles that are Under Maintenance / Out of Service; one on
  another active trip stays assignable (on purpose — a vehicle can be
  booked on several trips), just labelled "(on booking #X)". Same
  hint-only label for drivers/helpers; Deactivated/Terminated employees
  are left out of the crew dropdowns. Reassigning crew deactivates every
  active row for that role on the trip (not just the one on screen), so
  a trip never ends up with two active drivers. Dispatchers see "My
  Correction Requests" at the bottom of the board
  (`loadMyItineraryRelogRequests`, last 20, with Admin's note), and a
  trip with a Pending request shows "Correction pending" instead of a
  second request button. Board also has a search box (booking #,
  places, crew, plates), a Refresh button, formatted dates, and booking
  numbers link to `/dashboard/bookings?booking=ID` (BookingsSection
  opens that booking's detail on load). The header bell
  (`ComplianceExpiryAlerts`) now shows driver license/medical expiries
  to Dispatchers too. Damage Charges' approve checks the update matched
  a row. **Damage billing:** an approved `charge_to = 'Client'` damage
  record is added ON TOP of the booking's delivery amount everywhere a
  balance is computed (`loadClientDamageChargesByBooking` in
  `lib/damageCharges.ts`, used by paymentDue.ts, BookingsSection,
  ClientBookingHistoryModal, FinancialSection; `Booking.damage_charges`
  / `PaymentDueRow.damage_charges`). `amount_to_pay` stays the delivery
  amount only — Paid Full/Partial write the delivery target there and
  never fold damage in. Clients read their own approved Client damage
  via `delivery_damage_records_select_own_client`. **Reporting damage:**
  Dispatcher/Admin only — either "Mark delivered" (button on In Transit
  board rows, or Delivered in the dropdown → `MarkDeliveredModal`), or
  "Report Damage" on the Damage Charges page (`ReportDamageModal`, any
  of the last 200 delivered trips). Both share `DamageFields.tsx` +
  `damageInputError`/`insertDamageRecord` in `lib/damageCharges.ts`.
  Fleet status changes go
  through `lib/fleetStatus.ts` (`setVehicleStatus` only flips from the
  expected status, `freeVehicleIfIdle` only frees an In Transit vehicle
  with no other active trip) — also used by `BookingDetailModal`'s
  cancel and `workOrderStatusLog.ts`. **Booking status is kept in
  sync by a DB trigger** (`sync_booking_status` on `itineraries`,
  SECURITY DEFINER, added 2026-09-28 — replaced the old
  `lib/bookingStatus.ts` JS helper, which only ever handled Delivered
  and only from two call sites). Rules, over the booking's non-Cancelled
  itineraries: all Delivered → `Delivered`; any past Awaiting →
  `InProgress`; else `Confirmed`. Never touches a `Cancelled` booking,
  and leaves the status alone if every trip is cancelled.
- Employee Detail View (staff-side, Operations → Employees) — clicking an
  employee's name in `EmployeesSection.tsx` is now a link for Driver/
  Mechanic/Helper only (Admin/Dispatcher stay plain text) and opens
  `EmployeeDetailModal.tsx`, read-only. Driver/Helper: current active
  trip (status not in Awaiting/Delivered/Cancelled, via `itinerary_crews`)
  shown prominently at top, plus full trip history, most recent first.
  Mechanic: current non-Completed/non-Cancelled work order, plus full
  `work_order_completions` history. Reuses the Dispatch Board's and
  MechanicTasks's exact status labels/colors (duplicated locally into
  this file, not imported, since those source files are otherwise
  off-limits) — no new status vocabulary invented.
- Issue Reports → Work Order conversion (staff, `IssueReportsSection.tsx`)
  — `issue_reports` gained a `worked_on boolean default false` column;
  the list filters to `worked_on.is.null,worked_on.eq.false`. Staff can
  either "Mark as Worked On" directly, or "Convert to Work Order"
  (`ConvertIssueToWorkOrderModal.tsx`, creates a real `work_orders` row
  pre-filled from the issue report, then marks the issue `worked_on`).
  Both paths use `.select().maybeSingle()` after the `worked_on` update
  to catch a silent RLS no-op instead of trusting a bare "no error".
- Client Booking History (staff, `ClientsSection.tsx` → clicking a client
  name opens `ClientBookingHistoryModal.tsx`) — reuses `BookingDetailModal`
  from `BookingsSection.tsx` rather than duplicating it; Ongoing
  (Draft/Confirmed) and Past sections. Read-only.
- Employees (`/dashboard/employees`, EmployeesSection + AddEmployeeModal) —
  fully wired to `employees`/`employment_status`/`users`. Search/position/
  status filters, Edit, Delete (FK-violation-aware error handling), and
  "Set Up Account" (SetUpStaffAccountModal, via the `create-user-account`
  Edge Function).
- Payroll & Payslips — `lib/payslip.ts` is the shared pay-calculation
  engine, driven by each employee's `employees.rate_type`. Drivers
  (`Commission Per Trip`, Driver-only) earn per delivered trip
  `app_settings.driver_commission_rate`% × `bookings.rate_of_delivery_service`
  (rate is per trip, not per contract) + `app_settings.driver_per_trip_fee`
  — both company-wide, same formula as QuoteReviewModal's profit panel.
  Rate type is **locked by position** in `AddEmployeeModal.tsx` (no
  dropdown): Driver → Commission Per Trip, everyone else → Weekly Salary
  (amount required). Position is chosen only when adding an employee —
  read-only on Edit, no switching. Daily/Monthly/Hourly still work in `payslip.ts` for
  older rows but can't be chosen, and saving such an employee converts
  them to Weekly Salary;
  trip date = latest `dispatch_status_logs` row with
  `new_status = 'Delivered'`, in Manila time. Everyone
  else is paid against attendance: Daily Fixed, Weekly Salary (÷6 × paid
  days — Helpers), Monthly Salary (÷30), Hourly. No daily allowance
  anymore. `commission_basis`/`commission_per_trip` columns are legacy,
  unused since 2026-09-28. In `EditDraftPayslipModal` the admin can override
  any auto line amount or add manual lines; changes are tagged in the
  saved line description ("adjusted by admin, auto: ₱X").
  **Government deductions (2026-09-28):** `lib/governmentContributions.ts`
  (pure math, 2026 rates as constants — self-check:
  `node scripts/check-government-contributions.ts`) computes SSS
  (MSC ₱5k–35k, EE 5% / ER 10% + EC ₱10/₱30), PhilHealth (2.5%/2.5%,
  floor ₱10k, ceiling ₱100k), Pag-IBIG (fund salary cap ₱10k, EE 1% if
  ≤ ₱1,500 else 2%, ER 2%) and BIR weekly withholding tax (TRAIN 2023+
  weekly table on gross − EE contributions; 0 if
  `employees.is_minimum_wage_earner`). Monthly contributions are split
  across the weekly payslips of the month (month = month of
  `payroll_period_end`, N = Saturdays in it): each payslip projects the
  month's pay from month-to-date gross, and deducts its share minus what
  earlier payslips this month already deducted — the last payslip
  settles the month exactly (can be a small refund). EE + ER shares,
  `sss_msc`, `withholding_tax` and `deductions_note` (admin overrides,
  with auto values) are stored on `payroll_payslips`;
  `net_pay = gross − cash advance − EE shares − tax`. No remittance
  report yet.
  **Payslip lifecycle (2026-09-28): Draft → Finalized → Paid.** There's
  no "Issue Payslip" button any more: opening the Payroll page runs
  `generateDraftPayslips()` for the last completed Sun–Sat week
  (Manila time) — one draft per non-Deactivated/Terminated employee with
  gross > 0 and no payslip for that exact period (DB unique constraint
  on `employee_id, payroll_period_start, payroll_period_end` makes two
  admins opening it at once safe). Drafts (`finalized_at` null) are
  staff-only (restrictive RLS policy) and already count their trips/
  attendance as paid. Per draft: **Edit** (`EditDraftPayslipModal.tsx`,
  replaced `IssuePayslipModal.tsx` — edits the saved draft in place via
  `updateDraftPayslip()`, never recalculates), **Regenerate** (discard +
  regenerate that one employee, keeps a hold), **Hold Payslip** (Drivers
  only, `on_hold` — blocks Finalize and "Finalize all"), **Finalize**
  (stamps `finalized_at` → appears on the employee's payslip page). Only
  finalized payslips can be marked Paid. Generation runs for **last week
  and the current week** on every Payroll open; an existing draft is
  **topped up** (`topUpDraft()`) with only what's new — the normal pay
  calculation already skips trips on the employee's payslips and
  attendance already marked paid — so admin edits survive. Deductions
  are recalculated on the new gross unless admin had overridden them
  (then kept, and `deductions_note` gets a "pay went up, check them"
  flag). Removals (deleted attendance, un-delivered trip) aren't
  subtracted — use Regenerate. A draft can't be finalized until its week
  is over (`finalizePayslips` requires `payroll_period_end` < today,
  Manila). Top-up isn't atomic (ponytail comment in payslip.ts). Weeks
  older than last week aren't back-filled. The draft editor lets admin
  apply a cash-advance deduction bounded by outstanding balance.
  **Overlapping-run guard (2026-09-29):** `generateDraftPayslips()` runs
  are queued one after another per browser tab (React StrictMode fired
  Payroll's open-effect twice and double-added trips), and every run
  first calls `healDraft()`, which deletes duplicate trip lines
  (same `itinerary_id` twice) and corrects a draft's gross. Only guards
  one tab — two admins at once still need a Postgres function.
  Cash advances are issued directly by admin (`IssueCashAdvanceModal`,
  inserts into `cash_advances` with `status: 'Approved'` implicitly via
  its DB default, never auto-deducted) — from the **Cash Advance** page
  (see below), no longer from Payroll. PayrollSection
  (`/dashboard/payroll`) lists/finalizes/marks-paid drafts and payslips.
  Employees see their own payslip history
  (`MyPayslipSection`/`MyPayslipPage`), Dispatchers via their own
  restricted view (`DispatcherPayslipSection`). `issuePayslip()` (now
  only called internally by the draft generator) isn't
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
    Requests" panel on the Cash Advance page with Approve/Reject (Reject
    prompts for a reason via `window.prompt`, same pattern as
    `FinancialSection.tsx`). `getOutstandingCashAdvance()` in
    `payslip.ts` was fixed to filter `status = 'Approved'` — a
    `'Pending'` request hasn't actually been given to the employee yet,
    so it must not inflate what gets deducted from their next payslip.
  - "View Cash Advance Ledger" — **superseded**: a real dedicated ledger
    page now exists, `staff/CashAdvanceLedgerSection.tsx`, always shown
    on the Cash Advance page (no toggle).
    **2026-09-30: Cash Advance is its own tab** — Human Resource →
    Cash Advance (`/dashboard/cash-advance`, Admin only,
    `staff/CashAdvanceSection.tsx`). It just composes the Issue Cash
    Advance button/modal, the pending-requests panel and the ledger,
    all of which used to sit on the Payroll page (Payroll no longer has
    any cash-advance UI; payslip cash-advance deductions are unchanged).
    Note for later: `getOutstandingCashAdvance()`
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
  - Attendance (`staff/AttendanceSection.tsx`) — **its own tab** under
    Human Resource → Attendance (`/dashboard/attendance`, Admin only;
    no longer a Payroll panel, moved in the 2026-09-30 "attendance
    overhaul"). One table per Sun–Sat week (arrows to change week): a
    row per current employee (not Deactivated/Terminated, **Drivers
    excluded** — they're paid per trip) and a Present/Leave/Absent
    dropdown per day, saved on change via `saveAttendanceRecord()`
    (upsert on employee+date; Present quietly stores 8 hours,
    `DEFAULT_HOURS`, hours aren't typed any more — only legacy Hourly
    payslips read them). Future days disabled; a finished day with no
    row counts as Absent automatically (no row written — payroll only
    pays Present/Leave rows); never locked, so after correcting a day
    that's already on a draft use Edit/Regenerate on that payslip. "All
    present" per day header. And Payslip Issue
    Reports (`staff/PayslipIssueReportsSection.tsx` on the staff side,
    `employee/ReportPayslipIssueModal.tsx` + `MyPayslipIssueReportsSection.tsx`
    on the employee side, mounted in `MyPayslipPage.tsx`) — an employee
    disputing a payslip line item submits a report, staff review it.
- Maintenance Requests & Scheduling — two distinct concepts, don't
  conflate them: `maintenance_requests` (urgent — Driver/Mechanic submit
  via `employee/IssueMaintenanceRequestModal.tsx`, Admin approve/reject
  in `staff/MaintenanceRequestsSection.tsx`; approving auto-creates a
  real `work_orders` row and flips the vehicle to "Under Maintenance")
  vs `maintenance_schedules` (a future heads-up reminder, no approval
  step — Driver/Mechanic submit via `employee/ScheduleMaintenanceModal.tsx`,
  anyone with access can just "Mark Done", `staff/MaintenanceSchedulesSection.tsx`).
  Both are race-guarded the same way as the cash-advance-request decide
  (`.eq('status', 'Pending')` in the update's WHERE). `employee/InspectionReportModal.tsx`
  covers the "inspection report" half of what used to be a combined gap.
  `staff/TruckMaintenanceMonitoringSection.tsx` (`/dashboard/maintenance-monitoring`,
  its own top-level route, not a tab) layers two tabs on top: "Schedules"
  (embeds `MaintenanceSchedulesSection` plus an "Assign Schedule" action
  scoped to trucks only) and "Odometer Updates" — auto-suggests an
  odometer bump per truck by comparing its `truck_profiles.updated_at`
  against its most recent Delivered trip's distance
  (`bookings.estimated_distance_km`, one-way — what the diesel estimate
  is priced on — PLUS two base legs, since every truck leaves from and
  returns to Brgy. J.P. Laurel, Panabo City: base → pickup and delivery
  → base, worked out on this page only (`baseLegKm()`): cached
  `route_cache` pair, else OSRM from the stop's pin/barangay centre. If
  it can't be routed, the drive out counts as 0 and the drive back as
  the trip distance, both flagged in the table. The quote/booking
  module knows nothing about the base legs), staff click
  "Confirm update" to
  apply it. That confirm write is optimistic-concurrency-guarded
  (`.eq('current_odometer', <value it was suggested against>)`) and now
  checks whether the update actually matched a row via `.select().maybeSingle()`
  — fixed 2026-09-22, it previously trusted a bare "no error" the same
  way the project's documented RLS silent-no-op gotcha describes, so a
  second admin confirming the same suggestion first would have looked
  like it worked without actually updating anything.
- Status Relog Requests — a Dispatcher or Mechanic can't move
  `itineraries.itinerary_status` / `work_orders.work_order_status`
  backward directly; they submit a request (`status_relog_requests`,
  `RequestStatusRelogModal.tsx`, used from both the Dispatch Board and
  Maintenance/MechanicTasks), Admin approves (applies the change + logs
  it) or rejects (`staff/StatusRelogRequestsSection.tsx`).
- Damage Charges (Dispatcher + Admin, `/dashboard/damage-charges`,
  `staff/DamageChargesSection.tsx`) — resolves `delivery_damage_records`
  through `delivery_damage_records.itinerary_id` → `itineraries` → `bookings`/`clients`/
  `places` to let staff decide whether a damage charge goes to the
  Client or stays a Company cost.
- Client Delinquency & Reviews (staff side; the client-facing review
  submission is under "Client portal" above) — `staff/ClientDelinquencySection.tsx`
  is an append-only log (`client_delinquency_log`; "currently delinquent"
  is derived from each client's latest logged action, not a flag column)
  plus an "Overdue Risk" auto-suggestion list (reuses `lib/paymentDue.ts`,
  writes nothing until staff clicks to log it). `staff/ClientReviewsSection.tsx`
  lets Admin feature a submitted review on the public landing page.
- Location Picker (`components/LocationPicker.tsx`) — City/Barangay
  dropdowns sourced from `location_reference` (`lib/locationReference.ts`),
  used in the public `QuoteForm.tsx`, staff `NewQuoteRequestModal.tsx`,
  and client `NewQuoteModal.tsx`. "Pick exact spot on map" shows a Leaflet +
  OpenStreetMap view (`react-leaflet`/`leaflet` — these are real npm
  deps, `npm install` needs to have been run after they were added, they
  aren't declared-but-missing anymore as of 2026-09-22); the clicked
  point is saved as `pickup_lat/lng` / `delivery_lat/lng` on
  `quote_requests` and copied to `bookings` on Approve, and
  QuoteReviewModal routes between the two pins for the distance when
  both exist. The click is reverse-geocoded (all Nominatim calls go
  through `lib/geocoding.ts`, throttled to 1/sec) and matched by
  `matchLocation()` in `lib/locationReference.ts` — structured `city`
  field + whole-word barangay match on area fields only, returns
  barangay `null` rather than guessing. Dropdowns stay editable.
  **2026-09-28 rework:** the 3 quote channels now share
  `lib/quoteRequest.ts` (form state, validation incl. origin≠destination
  and date order, column mapping); the two dashboard modals also share
  `components/QuoteShipmentFields.tsx`. Staff's separate full-screen
  map (`NewQuoteLocationMap.tsx`) was removed in favour of the same
  LocationPicker map as the other channels. `places` is still one row
  per barangay — exact spots live on quotes/bookings, not `places`.
  **Later on 2026-09-28 (UX pass):** public form + client portal use
  `components/QuoteWizard.tsx` (Route → Cargo → Schedule & terms →
  Review, live summary side panel); staff keep one page. Field sections
  live in `QuoteShipmentFields.tsx` (`RouteFields`/`CargoFields`/
  `ScheduleFields`), per-field errors via `validateShipment()` +
  `useShipmentForm()`. On submit, customers see `QuoteSubmitted`
  (`components/QuoteSummary.tsx`) with a `quote_requests.reference_code`
  ("Q-XXXXXX", generated client-side because anon can't read the row
  back — UNIQUE column). Client portal offers recent locations from
  their own past bookings (`loadRecentLocations()`). Map pins are A/B
  brand-colored SVGs on CSS-muted OSM tiles (CARTO/Stadia styled tiles
  were avoided: commercial use needs a paid license).
- Inventory CSV Export (`lib/inventoryReport.ts` + `staff/InventoryReportModal.tsx`,
  from the Inventory page) — a Sun–Sat weekly stock/usage snapshot,
  downloaded client-side as a CSV blob, no server involvement.
- Financial Records / Payments Due — `lib/paymentDue.ts` calculates what
  each client owes from delivered trips, payment terms, and the
  Delivered timestamp in `dispatch_status_logs` (clients read their own
  via `dispatch_status_logs_select_own_client`). FinancialSection (`/dashboard/financial-records`) is
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
- Reports (`/dashboard/reports`, ReportsSection) — fully real, grouped
  tabs (reworked; the old "14 tabs" description is gone): **Overview**
  (clickable cards with live *pending* counts: Issue Reports, Client
  Requests, Payslip Issues, Maintenance Requests, Maintenance Schedules,
  Status Relog Requests, delinquent clients — badges on the other tabs
  use the same numbers, and queues call `onChanged` to re-count),
  **Needs action** (Issue Reports, Client Requests, Payslip Issues,
  Maintenance Requests, Maintenance Schedules, Status Relog Requests),
  **Clients** (Payments Due — reuses `paymentDue.ts`; Reviews; Standing =
  delinquency), **Logs** (Work Orders Completed/Accepted/Status,
  Dispatch Status — read-only, paged with `components/LoadMore.tsx`,
  newest rows first). Uses `lib/useCachedLoad.ts` (show last result
  instantly, refetch quietly; in-memory only).
- Maintenance page **Cost Report** (`staff/MaintenanceCostReportModal.tsx`
  + `lib/maintenanceCostReport.ts`) — pick a month, see fleet
  maintenance cost per vehicle and per work order, CSV download. Cost =
  **parts only** (`work_order_parts_used.quantity × unit_cost`, no labor
  — mechanics are on salary), counted in the month the work order was
  *completed*; parts with null `unit_cost` count as ₱0 but are flagged.
  `unit_cost` is a price column on `inventory_items` (edited in
  AddInventoryItemModal, shown in InventorySection) and is copied onto
  `work_order_parts_log` / `work_order_parts_used` rows when a part is
  used, so later price changes don't rewrite history.
- Dashboard shell/UX helpers (2026-09-29 "nav bar upgrades"/"dynamic ui"):
  `DashboardLayout` sidebar is a phone slide-in drawer with hover/click
  category flyouts (Admin sidebar: Dashboard; Operations = Quotations,
  Bookings, Clients, Dispatch Board; Human Resource = Employees,
  Attendance, Payroll, Cash Advance; Maintenance = Truck Monitoring,
  Fleet, Maintenance, Inventory; Reports; Financial Records; ⚙ Settings
  link in the layout, not the sidebar list). `components/ConfirmDialog.tsx`
  (`confirmDialog()` / `promptDialog()`, `<ConfirmHost />` mounted in
  main.tsx) replaces `window.confirm`/`prompt` in ~14 files — it only
  falls back to the browser's if the host isn't mounted; two spots still
  call `window.prompt` directly (`CashAdvanceRequestsSection`,
  `FinancialSection`). `components/Skeleton.tsx` loading placeholders.
  `components/ComingSoonPage.tsx` is now unused (every sidebar link has
  a real page).

## Currently in progress
Nothing is actively mid-build right now. (Last CLAUDE.md sync: 2026-09-30,
against the code at commit d5982c8 plus the uncommitted Cash Advance tab.)

## Not started yet
- Quotation module beyond public form (approve/reject flow already exists —
  this refers to anything further)

## 2026-09-22 codebase audit
CLAUDE.md had fallen well behind — a teammate merged a large batch of new
features (see git log) across many commits without this file being
updated. A full read-through + diff against this file found the
corrections above (marked **superseded**) plus two errors, both now
fixed:
- `npx tsc -b` / `npm run build` were failing: `react-leaflet` and
  `leaflet` were listed in `package.json` but not actually present in
  `node_modules` (nobody had re-run `npm install` after they were added)
  — fixed by running `npm install`. This also resolved an implicit-`any`
  TS error on the map click handler in `LocationPicker.tsx`, since TS
  could now infer the event type from the package's own types once it
  actually resolved.
- The odometer-confirm silent-no-op bug in
  `TruckMaintenanceMonitoringSection.tsx` described above — fixed.
Everything else audited (~44 files: Client portal, Dispatcher role,
Maintenance Requests/Scheduling, Work Order Logs, Status Relog Requests,
Client Delinquency & Reviews, Attendance, Cash Advance Ledger, Payslip
Issue Reports, Damage Charges, Location Picker, Inventory CSV Export)
was clean — real Supabase data throughout, no mock markers, no
console.log leftovers, every other write correctly checks its result.

## Schema reality check
Live DB is a snake_case subset of the full design doc (see memory) — not
all 88 tables exist yet. Tables actually queried by the app right now
(confirmed via grep of `.from(...)` calls in `src/`):
`bookings`, `clients`, `delivery_damage_records`,
`dispatch_status_logs`, `employees`, `issue_reports`, `itineraries`,
`itinerary_crews`, `itinerary_expenses`, `places`, `quote_requests`,
`trailers`, `truck_profiles`, `users`, `work_orders`,
`work_order_completions`, `work_order_parts_used`, `inventory_items`,
`app_settings`, `cash_advances`, `employment_status`,
`payroll_payslips`, `payslip_line_items`, `route_cache`.

Added by the 2026-09-22 audit (teammate-built, previously undocumented
here, all confirmed reachable and in real use — see the feature bullets
above for which file queries each one): `client_delinquency_log`,
`client_reviews`, `client_status_requests`, `employee_attendance`,
`location_reference`, `maintenance_requests`, `maintenance_schedules`,
`named_locations`, `payslip_issue_reports`, `status_relog_requests`,
`work_order_acceptance_log`, `work_order_notes`, `work_order_parts_log`,
`work_order_status_log`. Plus one RPC: `count_bookings_for_clients`
(used by the public landing page's featured-reviews section to get a
booking count per client without exposing raw `bookings` rows).

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

**Update, 2026-09-22:** most of the two lists below ("given as a fix, not
yet re-tested" and "known gaps") are now stale — the Dispatch Board,
cash advance requests, quote Approve/Reject, and Driver
delivery/issue/expense flows have all been built on top of and used
successfully in many sessions since they were written, so their
underlying policies clearly work now even though nobody went back to
edit the "not yet confirmed" wording at the time. Treat entries below as
historical record of *how* each gap was found and fixed, not as a
current to-do list — nothing in this file's "Not started yet" section
depends on any of them. Separately: the full 2026-09-22 codebase audit
(~44 files covering all the teammate-added features listed earlier in
this file) found **zero missing-policy bugs** among the newer tables
(`client_reviews`, `client_delinquency_log`, `maintenance_requests`,
`maintenance_schedules`, `status_relog_requests`,
`work_order_acceptance_log`, `work_order_notes`, `work_order_parts_log`,
`work_order_status_log`, `client_status_requests`, `employee_attendance`,
`payslip_issue_reports`, `location_reference`, `named_locations`) — RLS
on those appears to have been set up correctly from the start by
whoever built them, unlike the older tables below which needed live
debugging.

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
- ~~`delivery_receipts` / `delivery_damage_records` INSERT for Drivers~~
  — obsolete: `delivery_receipts` was dropped 2026-09-29, damage is
  staff-only now
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
- For schema changes and any DB write/DDL (`CREATE TABLE`, `ALTER`, RLS
  policies, `INSERT`/`UPDATE`/`DELETE`) — give raw SQL in chat for me to
  run in the Supabase SQL Editor myself, don't run it yourself via the
  CLI. Read-only queries (`SELECT`, `information_schema`, `pg_policies`)
  are fine to run directly.
- Default to backend-only work (schema, RLS, SQL, data access) unless a
  request explicitly names a UI/frontend change — then build that
  specific change directly without re-asking permission each time.
- After asking a confirming question or stating a plan, stop and wait
  for my explicit go-ahead before editing files — don't answer your own
  question and start implementing.
- Match existing codebase conventions/patterns exactly (including
  pre-existing lint warnings) instead of introducing a "more correct"
  novel pattern in just the new file.