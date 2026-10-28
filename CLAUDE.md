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
  `bookings` directly), and submitting a new quote (the New Quote Request page, `ClientNewQuotePage` in `client/ClientPages.tsx`,
  uses the same `LocationPicker` as the public quote form).
- Quotations (`/dashboard/quotations`, QuoteRequestsSection +
  QuoteReviewModal) — tabs Pending / Approved / Rejected (2026-10-22).
  Approved lists each approved quote with its booking (found via
  `bookings.quote_request_id`, client name from that booking's
  `clients` row, link to `/dashboard/bookings?booking=ID`, booking
  status; "No booking found — needs manual review" if Approve failed
  halfway). Rejected shows the tag + reason. Both read-only, newest 200.
  Approve finds-or-creates the `clients` row, creates 2
  `places` rows, marks the quote `Approved`, creates the `bookings` row
  (`booking_status: 'Draft'`, `rate_of_delivery_service` set from the
  approved rate), then creates a matching `itineraries` row
  (`itinerary_status: 'Awaiting'`) linked to that booking. The
  itinerary's `trip_date_from` = the quote's preferred pickup date.
  **Since 2026-10-22 staff can't edit the rate, payment terms or trip
  start date in the modal** (read-only; only distance is editable) — a
  wrong one is sent back with a Reject preset for the client to fix.
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
  by the separate **Mark Complete** button -- on the task card and in the
  Open Work Order panel; "Completed" isn't in the status dropdown) requires filling in a form 
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
  `Delivered` (so delivered trips still bill). **Payments Due / AR Aging
  include Cancelled bookings** (2026-10-19, `lib/paymentDue.ts`), billed
  only for delivered trips — same cap as the Cancelled tab in Bills
  Receivable; the dashboard revenue card was not changed. Freed trucks/trailers set back to `Available`,
  each trip change logged to `dispatch_status_logs`. The detail modal
  also shows cargo, schedule, terms, pin links, and a trips table
  (status/driver/helper/truck/trailer). **Find trip #** box (2026-10-22)
  on Bookings: looks up `itineraries.booking_id` for that trip number
  and opens `?booking=ID&trip=N`, which highlights + scrolls to that
  trip's row (`highlightTripId` prop). Trip number = `itinerary_id`, one
  running number across all bookings (user's choice — no "trip 1 of
  booking 12" numbering).
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
  another active trip stays assignable only if the time slots don't
  overlap (labelled "(on booking #X)"); an overlapping one is disabled
  "(on trip #X, <slot>)" and refused by the DB trigger
  `itinerary_vehicle_slot_check` (since 2026-10-24 — before that,
  double-booking a vehicle was allowed on purpose). Same
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
  "Report Damage" on the Damage Charges page (`ReportDamageForm`, any
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
  Edge Function). Active/Deactivated tabs (Deactivate/Reactivate flips
  `employment_status_id`). The Edit form also has a login section:
  no login yet → creates one via `create-user-account`; existing login →
  changing email/username/password calls the **`update-user-account`**
  Edge Function (`supabase/functions/update-user-account/`, Admin-only —
  it checks the caller's token and `users.user_role = 'Admin'` itself, so
  it's deployed with JWT verification OFF, same as `create-user-account`).
  **As of 2026-10-19 it was NOT deployed** (Supabase returned "Requested
  function was not found") — the employee row saves but the account
  change fails with "Employee saved, but the account change failed".
  Deploy: `npx supabase login`, then
  `npx supabase functions deploy update-user-account --project-ref dycefsqhtxwagbmwpgpo --no-verify-jwt`.
  `supabase/config.toml` has a `[functions.create-user-account]` block
  (`verify_jwt = false`) but none for `update-user-account` yet.
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
  its DB default) — from the **Cash Advance** page (see below), no longer
  from Payroll. **They ARE auto-deducted now** (since 2026-10-04): each
  generated/topped-up draft deducts `cash_advance_deduction_rate`% of its
  gross pay (`app_settings` key, editable on Settings if the row exists;
  `DEFAULT_CASH_ADVANCE_DEDUCTION_RATE = 10` if not), capped at the
  outstanding balance (`autoCashAdvanceDeduction()` in `payslip.ts`).
  Admin can still change the amount in `EditDraftPayslipModal`.
  `MyCashAdvanceRequestsSection` shows employees the rate. The comment at
  the top of `payslip.ts` still says "never auto-deducted" — stale. PayrollSection
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
    present" per day header. **My Attendance** (2026-09-30,
    `employee/MyAttendanceSection.tsx`, `/dashboard/attendance` in the
    Mechanic/Helper/Dispatcher trees, sidebar link "My Attendance";
    **Drivers get no link or route**) — read-only week view of the
    logged-in employee's own days, same auto-Absent rule, uses
    `loadAttendanceRecords(start, end, onlyEmployeeId)`. Needs the
    `employee_attendance_select_own` RLS policy (SQL given in chat).
    And Payslip Issue
    Reports (`staff/PayslipIssueReportsSection.tsx` on the staff side,
    `employee/ReportPayslipIssueModal.tsx` + `MyPayslipIssueReportsSection.tsx`
    on the employee side, mounted in `MyPayslipPage.tsx`) — an employee
    disputing a payslip line item submits a report, staff review it.
- Employee personal info (2026-10-11) — `AddEmployeeModal` now collects
  First / Middle (optional) / Last name (`full_name` = "First Middle
  Last", blank middle skipped), **phone number (required, add and edit)**,
  and an optional "More details" section: date_of_birth, personal email
  (`employees.email`, separate from the login email), address/city/
  province/zip_code, emergency_contact_name/number, tin_number,
  sss_number, philhealth_number, pagibig_number (last 3 added by SQL
  2026-10-11; the rest already existed in the live table). Shown
  read-only at the top of `EmployeeDetailModal`. Admin-only because the
  Employees page isn't in the Dispatcher's routes — no extra gating.
  Stored only; `governmentContributions.ts` doesn't read the IDs.
  `gender`/`civil_status` (DB enums) deliberately not collected.
- My Profile (2026-10-11, `/dashboard/profile`, `employee/MyProfileSection.tsx`
  + `lib/myProfile.ts`) — Driver/Mechanic/Helper/Dispatcher edit their OWN
  phone (required), DOB, personal email, address, emergency contact and
  TIN/SSS/PhilHealth/Pag-IBIG; name/position/hire date read-only. Goes
  through SECURITY DEFINER functions `get_my_profile()` /
  `update_my_profile(p_changes jsonb)` (RLS can't restrict columns, and a
  plain own-row UPDATE policy would let them edit their own salary).
  **Stress-tested 2026-10-11:** length caps, phone/email/gov-ID format and
  DOB range live in `lib/myProfile.ts` AND are mirrored in the SQL
  function — change both together. Save sends only changed fields (so it
  can't overwrite an Admin edit to an untouched field); control
  characters are stripped; the page is a real `<form>` (type="email"
  only validates inside one). Admin's AddEmployeeModal does NOT have
  these checks yet.
  **Typing is filtered, not just validated on Save** (`filterInput()` in
  `lib/myProfile.ts`: phone = digits/space/()-, leading + only; IDs/zip
  = letters/digits/space/dash; names/city/province = letters + space .'-;
  email = no spaces; address free). `type="tel"` does NOT block letters.
  Name/city/province character rules are client-only (no SQL mirror) —
  everything else is mirrored in `update_my_profile`. Same filters +
  `validateProfileForm` now also run in the Admin `AddEmployeeModal`.
- Leave Requests (2026-10-11) — `leave_requests` table (SQL run by user;
  RLS: insert/select own, `is_staff()` select all, `is_admin()` update).
  Every employee role incl. Driver files from **My Leave**
  (`/dashboard/leave`, `employee/MyLeaveSection.tsx` +
  `RequestLeaveModal.tsx`); Admin approves/rejects in
  `staff/LeaveRequestsSection.tsx` (mounted on the Attendance page).
  All logic in `lib/leaveRequests.ts`. Balance = 5 paid days/yr
  (`ANNUAL_PAID_LEAVE_DAYS`, Mon–Sat only, shown to non-drivers).
  Approving a non-driver writes `Leave` rows to `employee_attendance`
  (skips Sundays, Present days and already-paid days); drivers are paid
  per trip so approval is record-only. Approve warns if the person is
  already crewed on an overlapping active trip. **Dispatch Board:**
  drivers/helpers with Approved leave overlapping a trip's dates stay
  listed but disabled as "Name — on leave <range>" (current assignee
  stays selectable; Pending leave doesn't block; UI-only, no DB rule).
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
  its own top-level route, not a tab; **rebuilt 2026-10-25, see below** —
  the "Schedules" tab and Assign Schedule moved to the Maintenance page)
  has "Confirm odometer readings" (was the "Odometer Updates" tab) — auto-suggests an
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
  and the client quote form (`ClientQuoteForm`). "Pick exact spot on map" shows a Leaflet +
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
  category flyouts. Admin sidebar as of 2026-10-19 ("Bookings" → "Bookings & Trips" 2026-10-22; labels renamed in the
  "nav bar adjustments" commit): Dashboard; Reports; Operations = Client
  Quotations, Client Bookings, Client Accounts, Dispatch Board; Human
  Resource = Employee List, Attendance, Payroll Master, Cash Advance;
  Accounting = Bills Receivable (`/dashboard/financial-records`,
  FinancialSection), Bills Payable, Collections, Billing, Statements,
  Revenue Reconciliation, Profit & Loss, AR Aging, Payroll & Remittances,
  Trip Profitability; Maintenance = Truck Monitoring, Fleet Master,
  Maintenance, Inventory; ⚙ Settings link in the layout, not the sidebar
  list. Dispatcher sidebar: Dispatch Board, Bookings, Damage Charges,
  Quotations, My Attendance, My Leave, My Payslips, My Profile. Employee
  sidebar: Dashboard, My History (Drivers: "My Trips History"), My
  Attendance (not Drivers), My Leave, My Payslips, My Profile.
  `components/ConfirmDialog.tsx`
  (`confirmDialog()` / `promptDialog()`, `<ConfirmHost />` mounted in
  main.tsx) replaces `window.confirm`/`prompt` in ~14 files — it only
  falls back to the browser's if the host isn't mounted; two spots still
  call `window.prompt` directly (`CashAdvanceRequestsSection`,
  `FinancialSection`). `components/Skeleton.tsx` loading placeholders,
  `components/Toast.tsx` toast messages (host mounted in main.tsx),
  `components/Reveal.tsx` scroll-in animation (landing page only),
  `components/DateRangePicker.tsx` (Admin dashboard period picker).
  `components/ComingSoonPage.tsx` is now unused (every sidebar link has
  a real page).
- Admin dashboard expense cards (`StaffDashboard.tsx`):
  `OperationalExpensesCard` (payroll, trip expenses, diesel, Company
  damage), `MaintenanceExpensesCard`, `PayrollExpensesCard` — all from
  `lib/dashboardExpenses.ts` (comments there explain what's counted and
  why nothing is double-counted) — plus `TopCreditorsCard` ("Top Unpaid
  Clients"). Reload when the date-range period changes.
- Trip documents (2026-10-12, `staff/TripDocuments.tsx`) — delivery
  orders, photos, PDFs attached to one trip. Files go in the **private
  Storage bucket `trip-documents`** at `<itinerary_id>/<file>`, one row
  each in `itinerary_documents` (`itinerary_id, file_path, file_name,
  file_type`); images shown via 1-hour signed URLs; a failed row insert
  removes the uploaded file. Shown in `MarkDeliveredModal` (editable)
  and `BookingDetailModal`'s trips table (editable when the modal is
  opened with `onChanged`, i.e. from staff Bookings). The file's header
  comment says drivers and clients get it read-only, but no driver or
  client screen renders it yet. Bucket + Storage policies were set up by
  hand — not in the repo, not verified in the 2026-10-19 review.
- Work Order detail (`staff/WorkOrderDetailModal.tsx`) — Admin clicks a
  row on the Maintenance page: shows the mechanic's progress notes and
  mid-job parts log, lets Admin reassign or unassign (back to the Task
  Board), and (since 2026-10-24) **Complete work order…** — opens the
  mechanic's `CompleteWorkOrderModal` so Admin can finish a job the same
  way (description, parts, odometer); Admin is recorded as the completer.
  Needs staff INSERT/SELECT policies on `work_order_completions` and INSERT
  on `work_order_parts_used` (SQL given in chat).
- Client "My Quote Requests" (`client/MyQuoteRequestsSection.tsx`, in
  `ClientDashboard.tsx`) — the client's Pending and Rejected (with reason)
  quotes; Approved ones show under My Bookings instead.
- My Attendance month calendar (`employee/MyAttendanceCalendar.tsx`) —
  shown next to the weekly table on My Attendance; Present days green,
  read-only.
- Login & password (public): `/forgot-password` (`ForgotPasswordPage`,
  Supabase Auth emails a reset link) → `/reset-password`
  (`ResetPasswordPage`, set new password). `LoginPage` accepts a username
  OR an email — anything without "@" is turned into the account email by
  the `get_login_email(p_username)` RPC first.
- Client login & sign-up (2026-10-21, public) — "Client Login" link
  left of "Staff Login" in `NavBar.tsx` → `/client-login`
  (`ClientLoginPage.tsx`): log in with username OR email (same
  `get_login_email` lookup as staff). Sign-up form order: Username,
  Password, Confirm password, Name or company (= `clients.client_name`,
  shown in the portal), Email, Phone. Sign-up:
  - **Email:** `supabase.auth.signUp` with metadata
    (`sign_up_as_client`, `username`, `client_name`, `phone_number`);
    DB trigger `on_client_signup` on `auth.users` →
    `handle_client_signup()` (SECURITY DEFINER) validates and creates
    the `clients` + `users` (role `Client`) rows. Supabase hides the
    trigger's error text ("Database error saving new user") — the page
    maps it to "username may already be taken". Confirmation link
    returns to `/client-login`.
  **Login pages are role-separated (2026-10-22):** Client Login refuses
  staff accounts and Staff Login refuses Client accounts (signs them
  back out with "use the other login"). A saved session of the wrong
  kind shows `components/SignedInPanel.tsx` ("logged in as X — Log out /
  Go to dashboard") instead of redirecting. Public NavBar shows
  Dashboard / Log out when logged in; `logOut()` lives in AuthContext.
  `ProtectedRoute` still sends logged-out users to `/login` (staff).
  Google login was removed 2026-10-22 (`/client-setup` page + route deleted;
  the `complete_client_signup` RPC is now unused and can be dropped).
  Supabase redirect URL: `/client-login` for
  localhost:5173 and darch-logistics.vercel.app. SQL run by user, no
  migration file. **Known gap, partly fixed 2026-10-24 (SQL given in chat):**
  `handle_client_signup()` now links a new sign-up to an existing
  `clients` row with the same email that has no login yet (keeps its name,
  fills a missing phone) instead of creating a second row. Duplicates that
  already exist still need the Merge clients tool (Phase F, not built).
  `users.client_id` is a plain nullable column, so several logins for one
  client (#23) = several `users` rows with the same `client_id`.
- **Payment tracking (#12) + driver paid status (#13), 2026-10-22; SQL
  given in chat.** GCash / Bank Transfer / Check payments need a
  reference no. (`referenceRequired` / `paymentDetailsError` in
  `lib/bookingPayments.ts`; DB check `booking_payments_reference_required`,
  NOT VALID). Optional proof (JPG/PNG/WEBP/PDF, 5 MB) uploaded to private
  bucket `payment-proofs` at `<booking_id>/<ts>-<name>` BEFORE the payment
  is saved, then linked via RPC `attach_payment_proof(payment_id, path)`
  (Admin only) to `booking_payments.proof_path` -- the row is found as the
  newest matching payment because `record_booking_payment` doesn't return
  its id (ponytail comment). A failed attach is only a toast, never an
  error (re-saving would record the payment twice). 📎 Proof link in
  Collections. Stress-test fixes (same day): every payment amount box
  uses `lib/amountInput.ts` (filter: digits + one dot, 2 decimals, 12
  chars; `parseAmount`; compare in centavos with `cents()`; self-check
  `node scripts/check-amount-input.ts`), incl. Manage -> Record payment;
  a reused reference no. (non-voided, case-insensitive) asks "Record
  anyway?" inside `recordBookingPayment`; OR no./note trimmed; date
  received can't be before the booking's `created_at`; HEIC proofs get
  their own message; proof picker has Remove; the downpayment amount is
  capped at contract - paid. #13: RPC `get_trip_payment_status(itinerary_id)` (active
  crew only) returns 'paid' / 'terms' / 'unpaid' -- no amounts; shown by
  `employee/TripPaymentBanner.tsx` on Picked Up / In Transit trip cards.
- **Downpayment (#9–#11, 2026-10-22; SQL given in chat).** Before ANY
  trip of a booking may leave Awaiting, the client must have paid
  `cost + 25% x (contract - cost)` (cost = `bookings.cost_per_trip` x
  non-cancelled trips; contract = rate x those trips) -- or an Admin
  waived it. `cost_per_trip` is saved at Approve (QuoteReviewModal: the
  profitability panel's diesel + commission + per-trip fee at today's
  Settings; Approve is blocked if those Settings are missing). Old
  bookings (no cost_per_trip) aren't gated. Formula in
  `lib/downpayment.ts` (self-check `node scripts/check-downpayment.ts`)
  mirrored by SQL `booking_downpayment(booking_id)`; trigger
  `require_downpayment` (BEFORE UPDATE OF itinerary_status on
  itineraries, Awaiting -> anything but Cancelled) enforces it for the
  board AND drivers. Admin override: RPC `waive_downpayment(booking_id,
  reason)` (uses `current_admin_employee_id()`) -> `bookings.
  downpayment_waived_at/_by/_waive_reason`, button in BookingDetailModal.
  Bills Receivable (Action column tidied 2026-10-22: one primary button --
  Record downpayment / Record payment (replaced Partial Payment + Paid Full;
  "Full remaining" quick-fill inside) / Mark refunded -- plus Manage and
  Billing as matching secondary buttons): Downpayment column + `DownpaymentModal` that records
  the payment WITHOUT locking amount_to_pay, so billing still follows
  delivered trips and the payment terms count from delivery with less
  left; a negative balance on a booking with trips still to come shows
  "Paid ahead", not "Refund". Dispatch Board: "Awaiting downpayment"
  badge + next status disabled "(downpayment first)". Client portal My
  Bookings shows required / paid / to go. #9: the 25%/50% partial-payment
  buttons were removed (only "Full remaining" left).
- **Cancelled trips (2026-10-22):** trip counts everywhere ("x/y trips")
  leave cancelled trips out and show them separately ("1/1 · 2
  cancelled") -- Bills Receivable, Bookings & Trips, BookingDetailModal,
  ClientBookingHistoryModal (Payments Due already excluded them). Billing:
  `deliveryAmountFor()` in `lib/paymentDue.ts` is the one rule -- once a
  booking had ANY cancellation (status Cancelled OR `cancelled_at` set,
  i.e. cancelled partway and ended Delivered), a locked `amount_to_pay`
  is capped at rate x delivered trips. Before this, a partway-cancelled
  booking with an earlier payment (which locks the full contract) kept
  billing the cancelled trips (booking #44 billed ₱30,000 for 1 trip).
- Client Login & Security (2026-10-22, #7) — "Login & Security" under
  My Profile in the client portal (`client/ClientAccountSection.tsx`):
  change username via RPC `change_my_username(p_username)` (SECURITY
  DEFINER, Client role only, own `users` row, format + case-insensitive
  uniqueness; SQL run by user), change password (re-checks the current
  one with signInWithPassword, then `auth.updateUser`). Username/password
  rules shared with sign-up in `lib/clientAccount.ts` — the SQL function
  repeats the username rule, change both together.
- Quotes need a client account (2026-10-22) — the public anonymous
  quote form (`components/QuoteForm.tsx`) was deleted. `/quote-request`
  shows a sign up / log in panel when logged out (links to
  `/client-login?next=/quote-request[&mode=signup]`; ClientLoginPage
  honours `next`, same-site paths only) and `client/ClientQuoteForm.tsx`
  when logged in as a Client — the same form the portal's
  New Quote Request page (`/dashboard/quotes/new`) now shows. Rejected quotes get **Edit & resubmit** in
  `MyQuoteRequestsSection` (pre-filled via `quoteToForm()` /
  `SHIPMENT_COLUMNS` in `lib/quoteRequest.ts`) → RPC
  `resubmit_quote_request(p_quote_id, p_changes)` (SECURITY DEFINER,
  own quote only, only while `Rejected`; same row + reference code back
  to `Pending`, moves the reason to `previous_rejection_reason`,
  `resubmit_count + 1`, clears `rejection_tag`). **Reject presets**
  (QuoteReviewModal): staff must pick Trip rate too low / Too heavy /
  Schedule unavailable / Payment terms not accepted / Other →
  `quote_requests.rejection_tag`
  (`Rate`/`Weight`/`Schedule`/`Terms`/`Other`, CHECK; `REJECTION_TAGS` in
  `lib/quoteRequest.ts` keeps the field mapping). On resubmit,
  `rejectionErrors()` marks those fields red (staff's reason as the
  message) and QuoteWizard opens on the first step holding one, with
  every step clickable. Staff see a "Resubmitted" badge in Quotations
  and "Previously rejected: …" in QuoteReviewModal. Staff's own
  NewQuoteRequestModal (phone/walk-in) is unchanged.
- **Paged tables (2026-10-22):** admin lists show 10 rows per page (5 for
  side panels) with `components/Pager.tsx` instead of growing/scrolling --
  via `usePaged(rows, resetKey, perPage?)` in `lib/usePaged.ts` (back to
  page 1 when `resetKey` -- tab/search/filters -- changes; clamps when the
  list shrinks) over `lib/pageSlice.ts`. Applied to Quotations (3 tabs),
  Bookings & Trips (both views) + Payments Due panel (5), Clients,
  Dispatch Board (per tab), Employees, Attendance (week table), Leave
  requests (5), Payroll (employee groups), Cash Advance requests (5) +
  ledger, Bills Receivable, Collections, Truck Monitoring odometer
  suggestions, Maintenance requests/schedules (5), Fleet (trucks,
  trailers), Maintenance work orders, Inventory; Dashboard's Today's
  Deliveries pages 5 inline. Totals/tab counts still use the full list.
  NOT paged: Billing/Statements (printable documents), Reports logs (still
  "Load more"), Driver Schedule.
- Hosting: `vercel.json` (Vite build to `dist`, every path rewritten to
  `index.html` so refreshing a `/dashboard/...` URL works on Vercel).
- Design (2026-10-25): the whole app follows the claude.ai canvas
  **"Darch Logistics Dashboard Redesign"**
  (https://claude.ai/artifact/GqASavTXDwSNAA1mHaboSP, 19 Admin boards +
  its "Darch Logistics" token file). Tokens live in `index.css` `@theme`:
  `navy` sidebar, `primary` steel blue (active nav, selected tab/row, main
  button), `ink` / `ink-metric` / `ink-secondary` / `ink-muted` text,
  `line-card` (2px card/panel/modal outline), `line-control` (inputs,
  buttons), `line` (rules inside a card). Rules: cards = `.card` (white,
  2px outline, square, no shadow); buttons/inputs/badges 2px corners and
  44px tall (`min-h-11` built into `.btn-*`); `.btn-danger` is outlined
  red; tabs = outlined buttons, the chosen one filled `primary`, count
  badge inside; selected list row = `bg-primary-soft` + 4px inset
  `primary` bar; modal backdrop `bg-slate-900/50`. Table header rows are
  styled globally (`thead th` in `index.css`, unlayered so it beats each
  table's own classes). Tailwind v4's slate-500/700/300 already equal
  ink-muted / ink-secondary / line, so those text classes are fine as is.
  **Page layouts follow the boards too (2026-10-25).** Dispatch Board:
  one day at a time (‹ date › arrows, 'all' = every trip not delivered),
  five status tiles (click = filter), Status / Driver / Booking ID filters,
  a flat trip table with Update Status (`staff/UpdateStatusModal.tsx`,
  step list + "When did it happen?") and View (`TripPanel` in the same
  file: crew/vehicle pickers, edit time, breakdown, correction, logs,
  downpayment, "Use suggested crew"), "Resources Today" panel; a notice
  links to unassigned trips on other days. Bookings & Trips: bookings
  table + `staff/BookingSummaryPane.tsx` (Full Details opens
  BookingDetailModal). Clients / Employees / Payroll / Billing: list +
  detail panel. Schedule Overview: one Resources timeline (Drivers,
  Helpers, Trucks, Trailers sections) + Trips / Bookings views. Cash
  Advances: tiles + ledger + inline Issue form. Bills Receivable: owed
  tiles (Payments Due rules) + Client/Terms filters + due-date panel;
  `?pay=ID` opens Record payment (used by Bookings and Collections).
  Board features left out on purpose: helper pay per trip (Payroll -- no
  such module; a trip line's amount is already editable in Edit Payslip),
  and on the Maintenance boards anything the app has no data for
  (urgency / estimated cost on requests, labor rate, maintenance
  templates, brand / OR-CR / registration expiry, reorder level, stock
  adjustments, Acknowledge on alerts). The rest was built 2026-10-25 (see
  "2026-10-25: board features" below). Inter everywhere,
  Oswald only for the DARCH LOGISTICS wordmark. Number inputs have no
  spinner arrows and ignore the mouse wheel (`index.css` + `main.tsx`).

- **Accounting module (2026-10-19, Admin only — no Accountant role).** A
  sidebar group below Human Resource, **labelled "Expenses" in the nav
  since 2026-10-22** (the group heading only; its pages keep their names).
  **Also 2026-10-22: the sidebar group shows only Bills Receivable,
  Collections (un-hidden the same day -- it has the 📎 proof links),
  Billing and Statements.** Accounts Payable, Revenue
  Reconciliation, Profit & Loss, AR Aging, Remittances and Trip
  Profitability are hidden (commented out in `staffLinks`, routes and
  files untouched, still reachable by URL) -- planned for removal, user
  said not to delete them yet.
  **Money Summary** (`/dashboard/money-summary`, top of the Expenses
  group, `staff/MoneySummarySection.tsx`, 2026-10-22): one month --
  Revenue / Expenses / Net profit (Net loss when negative, with % of
  revenue), Collected this month, a Revenue breakdown by client (from
  `loadProfitLoss().revenueRows`, i.e. Revenue Reconciliation's per-booking
  trip revenue + adjustments) and an Expenses breakdown (Salaries, Diesel,
  Trip expenses, Truck repairs, Damage we paid for). Built on `loadProfitLoss()` (which now also
  returns `tripCount` and plain `parts`) via `buildMoneySummary()` in
  `lib/moneySummary.ts` (self-check `node scripts/check-money-summary.ts`).
  Supplier bills left out (Accounts Payable hidden). Replaces the hidden
  Profit & Loss page for day-to-day use (user found P&L too complex). Built so far:
  - **Bills Receivable** moved here (was a top-level link).
  - **AR Aging** (`/dashboard/ar-aging`, `staff/ArAgingSection.tsx` +
    `lib/arAging.ts`, self-check `node scripts/check-ar-aging.ts`) —
    read-only; takes `loadPaymentDueReport()` rows and buckets positive
    balances by days past due (Current / 1–30 / 31–60 / 61–90 / 90+, plus
    "No due date" only when non-empty). Per-client rows expand to
    bookings. Nothing is billable until a trip is Delivered (unless a
    payment locked `amount_to_pay` at the contract value).
  - **Invoice number** — `bookings.invoice_number` (text, SQL run by user).
    Just stores the number from the printed invoice booklet: edited in
    Bills Receivable's financial modal, shown in the list, in
    `BookingDetailModal`, and searchable on Client Bookings. The app does
    NOT generate or print invoices; no uniqueness constraint. Deliberately
    kept manual (BIR-registered booklet is the official invoice).
  - **Payroll & Remittances** (`/dashboard/payroll-remittances`,
    `staff/PayrollRemittanceSection.tsx`, `lib/remittanceReport.ts` loader +
    CSV, `lib/remittanceTotals.ts` pure math, self-check
    `node scripts/check-remittance-totals.ts`) — month picker; counts only
    FINALIZED `payroll_payslips` whose `payroll_period_end` is in the month
    (drafts are counted and shown as a warning, not included). Tab 1:
    amount to remit per agency (SSS = EE+ER+EC, PhilHealth, Pag-IBIG =
    EE+ER, BIR = withholding tax) + per-employee shares. Tab 2: gross,
    cash advance deducted, net, employer shares, company cost (gross +
    employer shares). One CSV with both. Reads the stored payslip columns
    only — nothing recalculated. No new tables.
  - **Trip Profitability** (`/dashboard/trip-profitability`,
    `staff/TripProfitSection.tsx`, `lib/tripProfit.ts` loader + CSV,
    `lib/tripProfitTotals.ts` pure per-trip math, self-check
    `node scripts/check-trip-profit-totals.ts`) — Delivered trips of a
    month (latest Delivered log, Manila; still Delivered now), filter by
    client/truck. Per trip: revenue = booking `rate_of_delivery_service`;
    costs = driver pay (commission % × rate + per-trip fee at TODAY's
    `app_settings` rates, not actual payslip lines), diesel (logged Fuel,
    else distance × price — `dieselForTrip`), other logged expenses,
    approved Company damage. Client damage charges are NOT in revenue;
    helpers' salary and maintenance aren't split per trip. Warns on
    missing settings / missing distance. Exports `fetchAll`/`fetchIn`
    from `dashboardExpenses.ts` for reuse. No new tables.
  - **Phase 4a — payment history (2026-10-19; SQL run by user, existing
    totals turned into one "Opening balance (before payment history)"
    row each).** `booking_payments` (`payment_id, booking_id, amount,
    paid_on, method, reference_no, or_number, note, recorded_by,
    created_at, voided_at, voided_by, void_reason`; negative amount =
    refund with method `Refund`; admin SELECT policy only, NO insert/update
    policy). Writes go only through SECURITY DEFINER functions
    `record_booking_payment(...)` (also optionally locks `amount_to_pay`
    in the same transaction) and `void_booking_payment(id, reason)`, both
    Admin-only via an inline `users` check. Trigger
    `booking_payments_sync` keeps `bookings.amount_paid` = sum of
    non-voided payments — **never write `amount_paid` directly again**.
    `lib/bookingPayments.ts` is the app side. Bills Receivable
    (`FinancialSection.tsx`): Partial Payment and Paid Full open the same
    form (Paid Full pre-fills the remaining balance; both lock
    `amount_to_pay`), the Manage modal's "Record payment" and "Mark
    Refunded" also create rows; forms collect method, date received,
    reference no., OR number, note.
  - **Phase 4b — Collections** (`/dashboard/collections`,
    `staff/CollectionsSection.tsx`; `loadPayments`/`voidBookingPayment`/
    `buildCollectionsCsv` in `lib/bookingPayments.ts`, totals in
    `lib/paymentTotals.ts`, self-check `node scripts/check-payment-totals.ts`)
    — every payment/refund by date received (default: this month), filter
    by method/client, "Show voided" toggle (voided rows stay, dimmed and
    struck through, excluded from totals), Void button (reason required →
    `void_booking_payment`), CSV. Note: the one-time "Opening balance"
    rows are dated the day they were created, so they show as collected
    on that day.
  - **Phase 4c — Statements of Account** (`/dashboard/statements`,
    `staff/StatementsSection.tsx`, `lib/statement.ts` loader,
    `lib/statementTotals.ts` pure ledger, self-check
    `node scripts/check-statement-totals.ts`) — pick client + period,
    printable (browser Print / Save as PDF; `print:` classes added to
    `DashboardLayout` hide the header/sidebar and let the page flow).
    Ledger: delivered trips bill the booking rate on the delivery date;
    one "Adjustment" line per booking = billable − rate × delivered trips
    (client damage, discounts/override, advance lock; dated the booking's
    last delivery, else booking date); payments by `paid_on`, refunds add
    back. Opening = everything before the period; closing with the period
    ending today equals Bills Receivable's balance. Billable amounts come
    from `loadPaymentDueReport(clientId, { includeSettled: true })`
    (new option; `PaymentDueRow` also gained `booking_date`). Because old
    payments were converted to dated-today "Opening balance" rows,
    statements for periods before that date show old bookings as unpaid
    and the payment inside the period of the backfill. Not built: payment
    history in the client portal / BookingDetailModal, invoice numbering.
  - **Planned, in order** (decided with the user; each needs go-ahead):
    Phase 4 (all of 4a–4c built, see above; original design:)
    `booking_payments` payment history
    (+ trigger keeping `bookings.amount_paid` = sum of non-voided
    payments, Collections page, Statements of Account; no backfill —
    past records get wiped first), **Phase 5 Revenue Reconciliation**
    (BUILT 2026-10-19, see below), Phase 6 Payables & Expenses
    (`suppliers`, `bills`, `bill_payments`), Petty Cash, Profit & Loss.
    Chart of Accounts / journal entries deliberately skipped.
  - **Why Revenue Reconciliation exists:** the dashboard "Revenue" card and
    Trip Profitability's revenue never match, by design. Dashboard =
    CASH COLLECTED (`bookings.amount_paid`, by `booking_date`, rolling
    window, Cancelled bookings excluded, includes advance payments and paid
    damage, reflects discounts). Trip Profitability = BILLED (rate × trips
    delivered, by delivery date, calendar month, Cancelled bookings'
    delivered trips included, ignores `amount_to_pay` overrides, no damage).
    **Changed 2026-10-22:** the dashboard card is now non-voided
    `booking_payments` by `paid_on` in the period, net of refunds (= the
    Collections page), incl. Cancelled bookings -- the description above
    is the old rule. Same day: Today's Deliveries uses the Manila date and
    skips Cancelled trips, Trucks/Trailers Operational read Fleet
    `current_status`, Drivers Available excludes approved leave, Refresh
    reloads every card, and `loadCashAdvanceTotals` counts only finalized
    payslips' deductions and pages past 1000 rows.
    The dashboard card and Trip Profitability are NOT relabelled (user
    chose a reconciliation page instead).
  - **Billing (per booking, 2026-10-19)** — Accounting → Billing,
    `/dashboard/billing` (client dropdown → booking dropdown → Print, like
    Statements) and `/dashboard/billing/:bookingId` (deep link that
    pre-fills both dropdowns) (`staff/BillingPage.tsx`, `lib/billing.ts`;
    Admin route only). The
    printable bill to hand a client for ONE booking (Print / Save as PDF,
    same `print:` setup as Statements): client, route, cargo, terms, trips
    delivered, the dated ledger lines (delivered trips, adjustment,
    payments) with running balance, total billed / paid / amount due (or
    PAID), due date, invoice no. if typed. It is `loadLedgerInputs(clientId)`
    narrowed to the booking, so it matches Bills Receivable and the
    Statement. Trips not delivered yet are listed too (greyed, no amount, "Trip #N (not delivered yet): route · cargo", in date order, `pendingTrips` in `lib/billing.ts`) and are billed on delivery, like the statement's trip lines. Titled "Billing" — NOT a BIR invoice. "Billing" link in
    Bills Receivable's Action column and in `BookingDetailModal` (Admin
    only). No company address/TIN in the header yet. No self-check script
    (no new math).
  - **Company details** for client-facing documents live in
    `lib/company.ts` (name, "Brgy. J.P. Laurel, Panabo City",
    0966 047 5467; no TIN yet) — shown on Billing, Statements, P&L.
  - **Phase 6a — Bills Payable (2026-10-19; SQL run by user the same
    day)** (`/dashboard/bills-payable`, `staff/BillsPayableSection.tsx`,
    `lib/payables.ts`, rules in `lib/payableTotals.ts`, self-check
    `node scripts/check-payable-totals.ts`). Tables `creditors`
    (`creditor_id, creditor_name, contact_person, phone, tin_number, note`;
    unique lower(name); Admin insert/update policies, plain writes),
    `bills` (`category` CHECK list = `BILL_CATEGORIES`, keep in sync;
    `amount_paid` kept by trigger `bill_payments_sync`; voidable) and
    `bill_payments` (voidable). Bill/payment writes ONLY via SECURITY
    DEFINER functions `create_bill` (optional pay-in-full = one-off
    expense), `record_bill_payment` (row-locked, refuses overpaying),
    `void_bill_payment`, `void_bill` (only with no active payments); all
    use `current_admin_employee_id()` (raises "Admins only"). Creditor
    (`bills.creditor_id`) is optional on a bill. Named "creditor"
    everywhere, DB included (user's choice 2026-10-19, was "supplier"
    before the SQL was ever run). The dashboard card
    `TopCreditorsCard.tsx` (clients who owe us) is titled **"Top Unpaid
    Clients"** so "creditor" only means people WE owe. Tabs Open/Paid/Voided/Creditors; cards owed /
    overdue / due in 7 days / paid this month. Petty Cash (6b) skipped
    for now by the user.
  - **Phase 6c — Profit & Loss** (`/dashboard/profit-loss`,
    `staff/ProfitLossSection.tsx`, `lib/profitLoss.ts`, pure
    `lib/profitLossTotals.ts`, self-check
    `node scripts/check-profit-loss-totals.ts`) — one month, accrual,
    printable. Revenue = Revenue Reconciliation's trip revenue +
    adjustments. Costs = payroll gross + employer shares (payslips by
    `payroll_period_end`, drafts included and noted), diesel LOGGED on the
    month's delivered trips, other trip expenses, company damage (all from
    `loadTripProfitReport`), maintenance parts used
    (`loadMaintenanceCostReport`), non-voided bills by `bill_date` per
    category. Deliberately excluded (memo lines): "Parts" bills (inventory
    purchase, expensed when used), estimated diesel, and the trip
    calculator's driver commission (already in payroll).
  - **Phase 5 — Revenue Reconciliation** (`/dashboard/revenue-reconciliation`,
    `staff/RevenueReconciliationSection.tsx`, `lib/revenueReconciliation.ts`
    loader, `lib/revenueReconTotals.ts` pure math, self-check
    `node scripts/check-revenue-recon-totals.ts`) — month picker. Reuses
    the Statement ledger for ALL clients (`loadLedgerInputs()` in
    `lib/statement.ts`, now exported; `loadStatement` wraps it). Cards:
    Trip revenue (= Trip Profitability), Adjustments, Billed, Collected
    (= Collections net of refunds), Dashboard card (bookings created that
    month, `amount_paid` to date, non-Cancelled). Receivables line: start +
    billed − collected = end. Per-booking table with a "Why" tag (Not
    fully paid yet / Paid in another month / Paid ahead of delivery /
    Paying earlier months / Matches). Read-only, no schema. The "Opening
    balance" rows (dated the backfill day) show as collected that day.

- **Phone number format (2026-10-19)** — every phone input is digits only,
  exactly 11, starting `09`, shown spaced as `0966 047 5467` and SAVED
  without spaces (`09660475467`). Shared helpers in `lib/quoteRequest.ts`:
  `phoneInput` (onChange filter/formatter), `phoneDigits` (strip for
  save), `phoneError` (validation). Used by the public `QuoteForm`, staff
  `NewQuoteRequestModal`, `AddEmployeeModal`, My Profile (via
  `lib/myProfile.ts`, phone + emergency number) and the client portal
  profile. The client portal's New Quote reuses the account's saved
  number. DB: `clients.phone_number`, `employees.phone_number` and
  `quote_requests.contact_number` have a `CHECK (~ '^09[0-9]{9}$')`
  added `NOT VALID` (run by user; `validate constraint` once old rows are
  clean). Not done yet: `update_my_profile()` still has the old loose
  phone rule, and `employees.emergency_contact_number` has no cleanup or
  constraint.

- **Driver time slots (#5/#6) — built 2026-10-22 (SQL run by user,
  untested in the browser at time of writing).**
  - Schema: `app_settings.default_trip_start_time` (minutes after
    midnight, unit `time`, 360 = 6 AM); `bookings.hours_per_trip`;
    `itineraries.trip_start_at` / `trip_end_at` (timestamptz). Triggers:
    `itinerary_slot_defaults` (BEFORE; end = start + hours_per_trip when
    missing, moving the start keeps the length, syncs `trip_date_from/to`
    to Manila dates), `itinerary_crews_check_slot` (BEFORE; refuses an
    active Driver/Helper in an overlapping slot via `crew_slot_conflict()`,
    advisory lock per employee; a started trip is busy until now even past
    its end; trips with no start time are skipped — the UI requires one),
    `itineraries_after_reschedule` (AFTER; re-checks crew, logs to
    `itinerary_schedule_logs`, notifies crew), `itinerary_crews_notify`
    (assigned/removed). Tables `itinerary_schedule_logs` (staff SELECT),
    `notifications` (`employee_id, kind assigned|removed|rescheduled,
    itinerary_id, read_at`; own SELECT/UPDATE). Time changes are NOT
    logged to `dispatch_status_logs` on purpose (its latest Delivered row
    is the payroll delivery date). Booking cancel (2026-10-22) now
    deactivates the cancelled trips' crew rows, so drivers DO get
    "removed"; it also re-reads the trips fresh before deciding.
  - **A booking's trips run back to back** (no gap, no night cut-off):
    `chainSlots()` in `lib/tripSchedule.ts`. Approve chains them from the
    default start; saving a trip's time in EditTripTimeModal re-chains the
    booking's LATER Awaiting trips (incl. ones with no time yet), each
    keeping its own length; changing hours per trip re-chains from the
    first timed Awaiting trip. Started/delivered trips never move.
  - Rules live in `lib/tripSchedule.ts` (self-check
    `node scripts/check-trip-schedule.ts`): overlap (back-to-back OK),
    `isOverdue`, `lateEarlierTrip`, `rankCandidates` (free first, then
    longest since their last trip; top 3 = Suggested -- no hours-per-week
    counting, removed at the user's request). 12-hour display helpers in `lib/format.ts`
    (`formatClock` 12 NN / 12 MN, `formatTime`, `formatSlot`,
    `manilaTimestamp`, `splitManila`; self-check
    `node scripts/check-time-format.ts`). `components/TimeInput12.tsx` =
    hour/minute/AM-PM selects (browser time inputs can show 24-hour).
  - Screens: Settings (time picker for unit-`time` rows); QuoteReviewModal
    requires Hours per trip, trips created at pickup date + default start;
    Dispatch Board "Time Slot" column with Set/Edit time
    (`staff/EditTripTimeModal.tsx`, end can be extended), Overdue badge,
    `CrewSelect` (locked until a slot exists; Suggested / Other free /
    Unavailable groups; "Assign X" one-click; "running late — reassign?"),
    trip can't leave Awaiting without a slot; BookingDetailModal shows
    slots + edits Hours per trip (re-times Awaiting trips);
    `staff/ScheduleOverviewSection.tsx` (**Schedule Overview**,
    `/dashboard/schedule-overview` since 2026-10-24, replaced Driver
    Schedule; old URL redirects; Admin + Dispatcher; read-only; tabs
    Drivers / Helpers / Trucks (Trucks|Trailers switch, bands for open
    work orders, pending `maintenance_schedules`, `next_service_date`) /
    Trips (+ "Needs assignment" list of open trips missing slot/driver/
    truck/trailer) / Bookings; search box; Day/Week; bars link to
    `?booking=&trip=`). Drawing = `staff/ScheduleTimeline.tsx`, loaders =
    `lib/scheduleData.ts` (one per tab, same row/bar/band shape); driver portal: slots on My Tasks / History
    detail, `employee/MyScheduleSection.tsx` (`/dashboard/schedule`,
    Driver + Helper only), `components/TripNotifications.tsx` bell in the
    header (Driver/Helper; polls every minute, opening marks read). It is
    separate from `ComplianceExpiryAlerts` (licence/medical bell).

## 2026-10-24: scheduling rules, Capacity Check (SQL given in chat)
- **Crew can't start a second trip while one is on the road.** A trip
  can't leave Awaiting while its driver or helper has another trip
  Dispatched / PickedUp / InTransit: `tripOnRoad()` in `lib/tripSchedule.ts`
  (self-check `node scripts/check-trip-schedule.ts`), greyed-out status box on
  the Dispatch Board (`crewOnRoadReason`), disabled "Mark as" button in the
  driver app (`UpdateStatusControl busyOnTripId`), and the DB trigger
  `require_crew_free_of_road` (BEFORE UPDATE OF itinerary_status). Trucks
  are NOT covered on purpose. Admin has no override.
- **Delivering re-times the booking.** `lib/tripRetime.ts`
  `retimeAfterDelivery()`, called by `MarkDeliveredModal` after Delivered is
  saved: the trip's `trip_end_at` becomes the real delivery time and the
  booking's later Awaiting trips chain after it, each keeping its length.
  Skipped for storage-deadline bookings (other trips untouched) and when
  within a minute of plan. Board reloads afterwards. The "Mark delivered"
  link on In Transit rows was removed (pick Delivered in the dropdown).
- **Schedule Overview** (`/dashboard/schedule-overview`, replaced Driver
  Schedule): see the Driver time slots bullet. "Needs assignment" on its
  Trips tab is just a one-line notice linking to the Dispatch Board.
- **Capacity Check** (can we actually run a quote's trips?). Rules:
  `lib/capacity.ts` (pure, self-check `node scripts/check-capacity.ts`):
  drivers/trucks/trailers (trailer type per trip) with busy windows; result
  fits / later (before deadline) / late (after) / none; later starts are
  tried once a day at the default start time, up to 14 days past the
  deadline; chain vs parallel (storage-deadline); helpers not counted;
  offered-but-unaccepted quotes count as tentative holds
  (`withTentativeHolds`), and booked Awaiting trips with no driver /
  truck / trailer picked yet still hold one of each for their slot
  (`withUnassignedTrips`, RPC field `unassigned`). Re-timing a booking
  later saves its trips last-first (EditTripTimeModal, tripRetime) so the
  crew/vehicle overlap triggers never see a trip overlap its own next one. Loading: `lib/capacityLoad.ts` calls the read-only
  RPC **`get_capacity_inputs(p_from, p_to, p_exclude_quote)`** (SECURITY
  DEFINER, authenticated; names/plates/reasons only for `is_staff()`, so
  clients see dates only). Screens: staff `CapacityCard` in Review Quote
  (Use earliest date / Reject: schedule unavailable; sending an offer that
  doesn't fit asks first — advisory), client `QuoteAvailabilityNote` on the
  quote form's schedule step (assumes 6 h per trip, never blocks), client
  `QuoteOfferCard` re-checks on Accept and refuses if the date was taken.
  Not hard-blocked in the database (`accept_quote_counter` /
  `respond_to_quote_offer` untouched): two clients accepting in the same
  second can still double-book. Dispatch Board **At-risk trips** notice
  (`atRiskReasons`): approved leave over the trip, licence expiring, truck/
  trailer in the shop, driver's earlier trip running late. Review Quote's
  explanation lines under distance / hours / pricing guide were removed.

- **Fleet Match** (truck / trailer suggestions). Rules: `lib/fleetMatch.ts`
  (pure, self-check `node scripts/check-fleet-match.ts`): `rankVehicles`
  blocks Under Maintenance / Out of Service / in the shop (a work order In
  Progress or On Hold) / a Created or Scheduled work order whose
  scheduled date falls on a trip day / an overlapping trip, leaves out the
  wrong trailer type, then ranks free ones same booking first → no service
  due during the trip (pending `maintenance_schedules`, truck
  `next_service_date`) and no work order waiting to start (labelled
  "service due …" / "work order pending", not blocked) → idle longest.
  (2026-10-24: any open work order used to block — a Created, undated
  WO-TR3 on the only Flatbed blocked all of booking #52.) Capacity's
  `get_capacity_inputs` uses the same work-order rule. `earliestFreeStart` for "Move to".
  Dispatch Board: `VehicleSelect` (Suggested / Other free / Unavailable +
  "Use X", same as CrewSelect; replaced TruckSelect/TrailerSelect and
  `vehicleHint`); the booking button is now **Use Suggested Crew &
  Vehicles for All N Trips**; `handleTruckChange` / `handleTrailerChange`
  return success. At-risk notice adds "No truck / <type> trailer free for
  this time" with **Move to <slot>** (opens Edit time pre-filled — Edit
  time now decides "moving later" from the next trip's current start) and
  **Replace <truck/trailer> on remaining trips** for a vehicle in the shop
  or with an open work order. Capacity card shows a breakdown table
  (`availabilityBreakdown`: needed at once / free at that time / earliest
  free, per driver, truck, trailer type) and "Our fleet is too small"
  when a quote needs more at once than we own. No driver–truck pairing,
  no trailer size / payload columns (user: the 45 t max on quotes covers
  it). Booking Detail has no breakdown — the board's At-risk notice
  covers booked trips.

## 2026-10-24: operations scenarios, Phase A (quote hygiene; SQL given in chat)
Plan of 22 scenarios decided with the user (phases A → D → E → B → C → F;
multi-stop trips deliberately out; no DO requirement; truck ban hours
6–8 AM and 6–8 PM for EVERY trip -- note the default start is 6 AM, inside
that ban -- DECIDED 2026-10-24: move `default_trip_start_time` to 8 AM
(Settings; user does it) and, in Phase C, a chained trip whose start would
land inside a ban window waits for the window to end; absent = unpaid; returned trips are billed, re-delivery is an
extra charge; no-work days only block STARTING a trip). Phase A built:
- **Offer timing** (`lib/offerTiming.ts`, self-check
  `node scripts/check-offer-timing.ts`): an Offered quote is `pickup-passed`
  once its pickup date is over (client can't Accept -- must counter with a
  new date; `respond_to_quote_offer` refuses too) and `expired` 3 days
  later (staff list chip "Offer expired", no capacity hold). Worked out
  from the date, no stored status. `QuoteOfferCard` hides Accept and says
  why; Capacity's tentative holds skip non-open offers.
- **Withdraw** (`withdraw_quote_request(p_quote_id)`, new enum value
  `Withdrawn` on `request_status_enum`): client's "Withdraw this quote"
  while Pending / Offered / Countered (`lib/quoteOffers.ts`).
- **QuoteWarnings** (`staff/QuoteWarnings.tsx`, top of Review Quote,
  advisory): similar quote (same client + pickup/delivery barangays,
  pickup within 2 days, open or Approved) and delinquent / overdue client
  (delinquency log + Payments Due). Needs `quote.client_id`.
- **#1 same-day approvals** (SQL given in chat 2026-10-24):
  `create_booking_from_quote` (called by both `accept_quote_counter` and
  `respond_to_quote_offer`) now starts the first trip at the NEXT HALF HOUR
  when pickup date + default start is already in the past, and chains the
  rest from there; its fallback default start is 480 (8 AM) when the
  Settings row is missing. Existing bookings aren't touched.

**Phase D (day-of disruptions; SQL given in chat):**
- **#19 "When did it happen?"** — a forward status move on the Dispatch
  Board (Awaiting → Dispatched → Picked Up → In Transit) opens
  `staff/StatusTimeModal.tsx` first (`StatusWhenField`, defaults to now in
  5-minute steps, can't be in the future or before the trip's last log row,
  `lib/statusTime.ts`); `applyStatusChange(…, atMs)` writes it as the log
  row's `status_changed_at`. `MarkDeliveredModal` has the same field
  ("When was it delivered?"): that time is the delivery date for payroll /
  Payments Due and what `retimeAfterDelivery` re-times from. Backward
  moves and the driver app still use now().
- **#14 Overdue bell** — `ComplianceExpiryAlerts` (Admin + Dispatcher) also
  lists trips past their end by more than `app_settings.overdue_alert_hours`
  (default 2 if the row is missing), linking to the trip; reloads every 5 min.
- **#13 Mark absent today** — board button → `MarkAbsentModal` → RPC
  `mark_absent_today(p_employee_id, p_reason)` (staff only): approved
  one-day Emergency `leave_requests` row for today + `Unpaid Leave`
  attendance for non-drivers. Everything that reads leave (board dropdowns,
  At-risk, Capacity, Schedule Overview) reacts with no new rule. At-risk
  trips whose driver / helper is on leave get **Use <name> as driver** /
  **helper** (top free suggestion).
- **#12 Report breakdown** — ⋮ menu on a trip on the road →
  `BreakdownModal`: swap in a free truck / trailer (board handlers, overlap
  rules apply), open a Corrective work order for the broken one and set it
  Under Maintenance (its other trips show under At-risk), optional cost as a
  trip expense (`itinerary_expenses`, category Other, on the trip's driver).
  Not one transaction: failures say which steps are done. Needs staff INSERT
  policies on `itinerary_expenses` (and `work_orders` for Dispatchers).

## 2026-10-23 stress-test fixes (tabs #7–#22; SQL given in chat)
- **Payroll** no longer rebuilds every draft on page open (that wiped
  admin edits) — opening Payroll only creates/tops up drafts; Regenerate
  is the manual button. `discardDraftPayslip()` now calls RPC
  `discard_draft_payslip(p_payroll_id)` (one transaction, checks "still a
  draft" first) — Regenerate fails until that SQL is run. Payroll list,
  cash-advance ledger (finalized deductions only), Bills Receivable,
  `paymentDue.ts`, Truck Monitoring odometer data all page past 1000 rows.
- **Leave:** `paidLeaveSplit()` in `lib/leaveRequests.ts` — approving
  leave writes `Leave` (paid) only up to ANNUAL_PAID_LEAVE_DAYS for the
  year, the rest as new attendance status **`Unpaid Leave`** (not paid;
  needs the SQL that allows that value). Admin confirms first.
  Attendance: no "All present" on Sundays; changing a day already on a
  payslip asks first.
- **Crew lists come from `employees.position`** (Driver / Helper), not
  `users.user_role` — Dispatch Board dropdowns and Driver Schedule show
  drivers without a login. Expired-licence drivers are Unavailable in the
  board's driver dropdown. Driver Schedule shows on-road trips whenever
  they started; its Today/tab buttons no longer stick on "Loading".
- **Fleet status:** new work orders only flip Available → Under
  Maintenance (never Out of Service); closing one uses
  `releaseVehicleFromShop()` (`lib/fleetStatus.ts`) — back to Available
  only if still Under Maintenance with no other open work order (also
  used by CompleteWorkOrderModal).
- Smaller: Employees (deactivate warns about open trips, no delete for
  someone with a login, Terminated in the Deactivated tab), Settings
  (validated first, no negatives, % ≤ 100, saves only changed rows),
  inventory edit won't overwrite stock used meanwhile, Mark refunded
  re-reads the booking, plates uppercase/single-spaced + duplicate check,
  Money Summary notes estimated diesel / draft salaries, expiry bell skips
  inactive drivers and flags missing licences.

## 2026-10-25: board features + Maintenance boards (SQL given in chat)
- **Attendance time in / out + overtime.** `employee_attendance.time_in` /
  `time_out` (time). Rules in `lib/attendanceHours.ts` (pure, self-check
  `node scripts/check-attendance-hours.ts`): hours = out − in − 1 h lunch
  (no lunch off a day of 5 h or less; out before in = past midnight),
  overtime = hours above 8, paid (day rate ÷ 8) × 1.25 (weekly ÷ 6,
  monthly ÷ 30 = day rate). Attendance page has a **Day** view
  (`staff/AttendanceDayTable.tsx`: Time In / Time Out via TimeInput12,
  Total Hours, Overtime, Status, one Save Attendance) next to the Week
  view; a Present day with no times = 8 h, no overtime; the week view
  keeps a day's times when Present is re-picked and shows "X h · OT Y".
  Payroll: `sumPaidOvertimeHours()` (`lib/employeeAttendance.ts`) adds an
  "Overtime" line to Daily / Weekly / Monthly payslips and an "Overtime
  premium" (the extra 0.25) to Hourly ones; draft top-up picks it up for
  new days. Drivers still aren't on the sheet.
- **Add / Edit Client** (`staff/AddClientModal.tsx`, Clients page header +
  panel): name, contact person, email, phone (same 09 rule), address,
  notes; warns on a duplicate name / phone / email. Needs a staff UPDATE
  policy on `clients`.
- **Add Charge on a bill** (`staff/BillingCharges.tsx` on Billing,
  `lib/bookingCharges.ts`): table `booking_charges` (description, amount
  > 0, voidable with a reason). `loadExtraChargesByBooking()` = approved
  Client damage + non-voided charges and replaced
  `loadClientDamageChargesByBooking` in paymentDue.ts, BookingsSection,
  ClientBookingHistoryModal and FinancialSection -- so every balance,
  Payments Due, Statement adjustment, Billing and the client portal
  include them. The field is still called `damage_charges` (now "extra
  charges"). `amount_to_pay` stays the delivery amount.
- **Money Summary Export** -- CSV of the month (`buildMoneySummaryCsv` in
  `lib/moneySummary.ts`).
- **Three medical exams** (`lib/medicalExams.ts`): Physical (the old
  `medical_exam_date` / `medical_exam_expiry_date` + `physical_exam_result`),
  Drug Test (`drug_test_*`), Psychological (`psych_exam_*`), each date +
  expiry + result Passed/Failed. Drivers only, in AddEmployeeModal and the
  Employees panel; the header bell warns on each expiry (30 days) and on a
  Failed result. Queries list the columns literally (typed select).
- **Maintenance boards rebuilt with existing data only.** Truck Monitoring:
  tiles, Trucks table (status, odometer, last 2 trips, next maintenance =
  next service date or earliest pending schedule), Alerts (truck / trailer
  not operational, service date within 14 days, schedule due within 14
  days, Created/Scheduled work order past its date) with Open Work Order /
  Create Work Order / Open Schedules, and Confirm odometer readings (new
  reading optional, must be higher than current; same optimistic guard).
  Maintenance: tiles (requests waiting, in progress, trucks not
  operational, parts cost this month), tabs Requests / Work Orders (Show:
  open or completed & cancelled) / Schedules, each with a side panel
  (Approve / Reject…, Open Work Order -> WorkOrderDetailModal, Mark Done);
  Assign Schedule (`staff/AssignScheduleModal.tsx`, trucks only) lives on
  the Schedules tab; `?tab=Requests|Schedules|Completed` and `?wo=ID`.
  Fleet: Trucks / Trailers tabs with counts + plate search, side panel
  (details, open work orders + pending schedules, last 5 trips with
  driver), Delete… / Create Work Order / Assign Schedule / Edit.
  Inventory: tiles (items, out of stock, stock value, parts cost this
  month), Type / Stock / Search filters, side panel (details, last
  completed work orders it was used on), Delete… / Edit.
  `MaintenanceRequestsSection` / `MaintenanceSchedulesSection` are now
  only used by Reports. `PendingMaintenanceSchedule` gained
  `plate_number` / `trailer_id`.

## 2026-10-27: Driver / Helper portal redesign (canvas driver boards)
Rebuilt to the canvas's Driver boards with existing data only (no schema).
- Sidebar: Driver/Helper links are two groups, **Trips** (Dashboard, My
  Schedule, My Trips History / My History) and **My Account** (My
  Attendance -- Helpers only, My Leave, My Payslips, My Profile)
  (`helperLinks` / `driverLinks` in DashboardRouter.tsx). Mechanic links
  unchanged (flat `employeeLinks`).
- Dashboard (`DriverTasks.tsx`, no box around it any more): "On the road"
  wide cards, "Upcoming" two per row (Trip # · Booking #, route, slot,
  truck · trailer, cargo, your expenses, storage / payment banners --
  restyled, no emoji), side panels "Trip steps" and "Recent trips" (last 2
  delivered). **Mark as X** opens `StatusStepsModal` (in
  UpdateStatusControl.tsx: Done / Now / Next / Later steps) instead of a
  plain confirm; "+ Add Expense" sits next to it (`children` prop).
- Pop-ups restyled: AddExpenseModal (amount via lib/amountInput, category
  radios, still no default; closes with a toast), InspectionReportModal
  ("About: A vehicle / A general issue", severity radios, now required),
  IssueMaintenanceRequestModal (type now required, "Send Request"),
  ReportPayslipIssueModal (optional `line` -- the payslip line it's about
  is prefixed to the description; still one report per payslip).
- My Schedule: table grouped by day (Time Slot, Trip · Booking, Route,
  Truck · Trailer, Status) + "Trip updates" panel. The bell's loader moved
  to `lib/tripNotifications.ts` (`fetchNotifications`, `message`).
- My Trips History: Status filter (All / Delivered / Cancelled), paged
  table, TripDetailModal restyled (expenses show category). Mechanic
  history keeps its simple table.
- My Leave: table (Dates, Type, Days, Reason / Admin note, Status) + an
  inline Request Leave form (RequestLeaveModal.tsx deleted); drivers see
  "no leave balance", others their paid balance.
- My Payslips: payslip list (6 per page) + selected payslip (earnings,
  deductions, net, "Report an Issue" per line) in MyPayslipSection (also
  the Dispatcher's page) + aside `RequestCashAdvanceForm.tsx` (was
  MyCashAdvanceRequestsSection + RequestCashAdvanceModal) and
  `MyRequestsSection.tsx` (cash advances + payslip reports in one list;
  was MyPayslipIssueReportsSection).
- My Profile: Employment card + Contact / Emergency contact / Government
  IDs cards, Discard Changes + Save Changes (shared by all employee roles).
- Left out (no such data): the board's emergency-contact "Relationship".
  The welcome line still shows the username, not the employee's name.

## 2026-10-27: Mechanic portal redesign (canvas Mech boards)
Same rules as the driver redesign: existing data only, no schema.
- Sidebar: `employeeLinks` (Mechanic) = groups **Work** (Dashboard, My
  History) and **My Account** (My Attendance, My Leave, My Payslips, My
  Profile).
- Dashboard: header buttons Issue Maintenance Request (primary for
  Mechanics), Schedule Maintenance, Submit Inspection Report. Left:
  MechanicTasks -- "My Tasks · n open" cards two per row (type, problem,
  scheduled, Open Work Order / Mark Complete) and a **Recently Completed**
  table (work done + completed date from `work_order_completions`,
  Request Correction / Correction Requested). Right: **TaskBoard** is now a
  panel beside them (was a slide-out drawer), opens by itself when there's
  work, Hide / Show.
- Open Work Order (AccessWorkOrderModal): a right-hand panel -- details,
  Status dropdown, three columns Inventory (+ Log 1 / Out of stock) / Used
  (↩ Return 1) / Notes (Add Note), footer Close / Mark Complete. Same logic.
- Mark Complete (CompleteWorkOrderModal, also Admin's): two columns --
  description, "Truck only" odometer / next service, notes | parts already
  logged, other parts used (Part / Qty rows, + Add new inventory item,
  + Add Part). New optional `subtitle` prop. Submit steps unchanged.
- Schedule Maintenance: vehicle optgroups, "What's needed?" (SCHEDULE_TYPES,
  now required, no default), Due in radios (default 3 months), "Save Schedule".
- Inspection pop-up subtitle differs for Mechanics.
- My History (Mechanic): Status (All / Completed / Cancelled) + Search,
  paged table Work Order / Vehicle / Maintenance Type / Work Done /
  Completed On / Status.
- My Attendance (Mechanic, Helper, Dispatcher): month tiles (Present /
  Leave / Absent so far), the week as a list (time in / out, hours, OT when
  recorded), month calendar with each day's status + legend.
- My Leave (non-drivers): three balance tiles instead of the banner.
  My Payslips: "Paid weekly by attendance" / "Paid per delivered trip".

## 2026-10-27: Dispatcher redesign (canvas Dispatcher boards)
The Dispatcher's Dispatch Board, Schedule Overview, Bookings & Trips and
Quotations are the Admin pages (already rebuilt 2026-10-25); My Attendance /
Leave / Payslips / Profile are the employee pages. Changed for this pass,
existing data only:
- Sidebar: `dispatcherLinks` = groups **Operations** (Dispatch Board,
  Schedule Overview, Bookings & Trips, Damage Charges, Quotations) and
  **My Account** (My Attendance, My Leave, My Payslips, My Profile).
- Dispatch Board: **My Correction Requests** is a side panel above
  Resources Today (Dispatcher only, always shown, empty state). The trip
  panel (View) has a **Ready to dispatch?** checklist for Awaiting trips:
  time slot, driver, truck, trailer, downpayment (only when the booking has
  one), crew not out on another trip -- the same rules as
  `blockedReasonFor` / `crewOnRoadReason`, display only.
- Mark Delivered (`MarkDeliveredModal`, new optional `subtitle`): canvas
  layout, cargo condition as radio choices (Good / Damaged / Partial /
  Missing -- all four kept), amber damage box, documents. Same save steps.
- `DamageFields` no longer asks "Charge to": who pays is decided on Damage
  Charges (a new record is 'Reported' and its pre-set `charge_to` was never
  read before approval). Cost uses `filterAmountInput`; `damageInputError`
  rejects a lone ".".
- Damage Charges: table (Booking + Trip # · date, Client, Route, Damage,
  Est. Cost, Who Pays Client | Company segmented -- picking approves, "Not
  decided yet" until then), search by booking # / client, 10 per page;
  side panel **Report Damage** form (`ReportDamageForm.tsx`, was
  ReportDamageModal; photos / documents via TripDocuments once a trip is
  picked) + a "Who pays" explainer.

## 2026-10-27: Client portal redesign (canvas Client boards)
Existing features only, no schema. Every page is shared by all clients.
- Sidebar: `clientLinks` = groups **Shipping** (Home, My Quotes, My
  Bookings, Payments, My Requests) and **Account** (My Profile).
- Data loaders moved to `lib/clientPortal.ts` (`loadClientBookings` -- now
  also trip_start_at / trip_end_at and the quote reference via
  `bookings.quote_request_id`; `loadClientPaymentCards` -- Payments Due rows
  incl. settled ones + downpayment + state; `loadOpenQuoteCounts`;
  `isActiveBooking`, `billableTrips`, `bookingDownpayment`). Payment state
  words in `lib/clientPaymentState.ts` (Downpayment due / Downpayment paid
  / Overdue / Paid in full; self-check
  `node scripts/check-client-payment-state.ts`).
- Home: welcome line with the date, tiles (active bookings, balance due,
  next payment due), "n offers to answer" banner, Active bookings and Next
  payments due previews (the quote list is no longer on Home).
- My Quotes: "Needs your answer" (Offered, click to show) + "Other quotes"
  cards; the selected offer's panel (`QuoteOfferCard`, new props
  reference / route / cargo / terms) with **Decline…** and
  **Counter-offer…** as pop-ups, **Accept Offer**. Same RPC logic.
- New Quote Request is a page now: `/dashboard/quotes/new`
  (`ClientNewQuotePage` in ClientPages.tsx); `?resubmit=<id>` = Edit &
  Resubmit (only while Rejected). `NewQuoteModal.tsx` became
  `NewQuoteButton.tsx` (a link). QuoteWizard (also the public
  /quote-request page): step bar with "Done", step card, "Fix N things
  before you continue" box, footer Cancel (portal only) / ‹ Back / "Next:
  <step> ›"; Review shows Route / Cargo / Schedule boxes with Edit;
  QuoteSubmitted = "Quote request sent" (+ optional second button).
  Kept on purpose although the canvas doesn't show them: several cargo
  lines, last-free-storage-day, the live summary panel. Left out: the
  canvas's "Your price / proposed rate" (clients don't set a rate since
  the offer flow).
- My Bookings: Active / Past tabs with counts, booking rows (ref, route,
  date, rate, trips, total, Payment state), Show trips -> trips table
  (date, time window, cargo, status, **Ask About This Trip** =
  ClientStatusRequestModal restyled, now takes date / timeWindow). The
  canvas's Driver column is left out (clients can't read the crew, on
  purpose).
- Payments: tiles (balance due, next payment due, paid in full n of n) +
  one card per booking with its state and due line.
- My Requests: question cards with Dispatch's answer ("Waiting for
  Dispatch" until answered) and a note on where to ask.
- My Profile: three cards -- Contact details (always editable, now incl.
  the existing `clients.address`; Discard / Save Changes), Login & Security
  (username and password forms always open), Rate Us (star buttons).
- Client Login: public NavBar, "Your shipments, in one place" panel, Log In
  / Sign Up tabs. Sign-up field order kept as before (Username first), not
  the canvas order.

## 2026-10-27: Rates are PER CARGO LINE (SQL run by user, all 5 phases built)
A quote prices each cargo line on its own; **everything that used to be
"rate x trips" now adds up each trip's own rate.** This supersedes every
older line above that says the booking has one rate per trip.
- **Data.** `itineraries.trip_rate` (a trip's own rate; trips of one cargo
  line share it; backfilled from the booking, and a BEFORE INSERT trigger
  `itinerary_trip_rate_default` fills a missing one),
  `quote_requests.line_rates` and `quote_rate_offers.line_rates` (jsonb
  array, one rate per cargo line in `cargo_lines` order; backfilled only for
  Pending / Offered / Countered quotes -- closed quotes keep just
  `proposed_rate`). `quote_requests.proposed_rate` and
  `bookings.rate_of_delivery_service` are now only the AVERAGE rate per trip
  (`quote_average_rate(cargo_lines, line_rates)` in SQL, `averageRate()` in
  `lib/lineRates.ts` -- change both together); screens that show one number
  use it, or a "₱A – ₱B" range via `rateLabel` / `bookingRateLabel`.
  `bookings.cost_per_trip` is still total cost / trips (average), so after
  cancelling trips of a mixed-cost booking the downpayment is approximate.
- **SQL functions** (run by hand, no migration file): `send_quote_offer`,
  `respond_to_quote_offer` take `p_line_rates jsonb` (an old `p_rate` alone
  is still accepted = the same rate on every line);
  `accept_quote_counter`, `create_booking_from_quote` (writes `trip_rate`
  per trip, booking rate = average), `booking_downpayment` (contract = sum
  of live trips' `trip_rate`), `get_trip_payment_status`,
  `get_trip_client_and_rate` (returns the trip's own rate, same column
  name). `record_booking_payment` never computed the contract -- the app
  passes it (`getDeliveryTarget` in FinancialSection).
- **App rules live in `lib/lineRates.ts`** (self-check
  `node scripts/check-line-rates.ts`): `parseLineRates`, `contractTotal`,
  `expandLineRates`, `estimateLineCosts` (commission follows each line's
  rate), `lineRateError`, and for booking money `groupTripRates` /
  `sumRates` (contract = sum of live trips' rates, billed so far = sum of
  delivered trips' rates). `downpayment.ts` gained `downpaymentForContract`;
  `downpaymentStatus` takes `contract` (not `ratePerTrip`).
- **Screens.** Review Quote (QuoteReviewModal): one rate box per cargo line
  + "Same rate for all lines"; profitability, downpayment and offer messages
  sum across lines; a phone / walk-in counter has per-line boxes (the old
  `promptDialog` is gone). Client side: QuoteOfferCard shows per-line rates
  and its Counter-offer pop-up has one box per line;
  `respondToQuoteOffer({ lineRates })`. `OfferComparison` compares line by
  line when lines differ. Money: `paymentDue.ts` (`PaymentDueRow.trip_rates`),
  Bookings, Client Booking History, Bills Receivable, Billing / Statements
  (`StatementTrip.rate` -- each delivered trip bills its own rate; the
  "adjustment" = billable - delivered trips' rates), client My Bookings /
  Payments, Dispatch Board downpayment, BookingDetailModal (Rate column in
  the trips table), `payslip.ts` driver commission, `tripProfit.ts`,
  Today's Deliveries. Revenue Reconciliation / P&L / Money Summary read
  through those loaders (no change of their own).
- Not done: re-pricing an already-booked quote (a booking keeps the rates it
  was made with); a Statement for a client with closed-quote history shows
  the average (those quotes have no `line_rates`).
- Other 2026-10-27 changes: the Bookings & Trips side panel no longer
  shows each trip's driver / helper / truck / trailer (and no longer loads
  them); `booking_charges` SQL (table + RLS: staff / own-client SELECT,
  Admin INSERT / UPDATE) was run -- it had been missing, so Add Charge on
  Billing failed until now.

## 2026-10-27: Lint is at zero -- keep it there
`npx eslint src scripts` reports 0 problems (was 68). New code must not add
any. The patterns used to get there:
- **Loading data in an effect.** React's lint forbids setting state
  synchronously inside an effect and calling a function before it's
  declared. Pages load like this, placed AFTER the loader function and
  before any early `return`:
  ```ts
  const loadNow = useEffectEvent(() => { void load() })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [deps])
  ```
  `useEffectEvent` (React 19.2) always calls the latest `load` (so it isn't
  a dependency); the 0 ms timer moves load()'s state updates out of the
  effect's own run. Buttons that refresh still call `load()` directly.
  Simple one-off fetches can instead set state inside `.then(...)` with a
  `cancelled` flag (MyStatusRequestsSection, useClientProfile).
- **"Loading" derived, not set.** When an effect re-fetches on a pick
  (Billing, Statements, CapacityCard, QuoteAvailabilityNote), the result
  is stored with the key it was loaded for; loading = "no result for the
  current key yet". No `setLoading(true)` / reset inside the effect.
- **Opening a form from a URL link** (Employees `?employee=`, Bills
  Receivable `?downpayment=` / `?pay=`): done while rendering, once per
  link (`openedLink` state); the effect only clears the URL.
- **Component files export only components.** Shared constants/helpers
  live in lib: `lib/mechanicWorkOrders.ts` (WorkOrder, WORK_ORDER_COLUMNS,
  ALL_STATUSES, withVehicleLabels -- were in MechanicTasks),
  `lib/driverTripStatus.ts` (DRIVER_TRIP_STATUS_LABELS -- the driver
  wording, was TRIP_STATUS_LABELS in UpdateStatusControl; staff wording
  stays in lib/tripList.ts), `lib/employeeRateTypes.ts` (RATE_TYPES),
  `lib/inventoryItemTypes.ts` (ITEM_TYPES), `lib/maintenanceTypes.ts`
  (MAINTENANCE_TYPES), `client/useClientProfile.ts`. The auth provider is
  `context/AuthProvider.tsx`; `context/AuthContext.tsx` keeps the context,
  `useAuth()` and `logOut()` (imports of useAuth are unchanged).
- No components declared inside other components (ClientBookingHistoryModal's
  BookingTable is at file level), and no helper named `use...` unless it's
  a hook.

## Currently in progress
Accounting module Phases 1–6 built except Petty Cash (6b, skipped for
now), awaiting user testing (6a SQL has been run). Not built: payment history in the client
portal / BookingDetailModal, company TIN. (Last CLAUDE.md sync:
2026-10-19.)

Open items from the 2026-10-19 review of the teammate's 67 commits
(Sep 24 – Oct 19; `tsc` and `npm run build` both clean):
- Deploy the `update-user-account` Edge Function (see the Employees
  bullet for the command) — until then, editing an existing login's
  email/username/password fails.
- `payslip.ts`'s header comment says cash advances are "never
  auto-deducted"; the code deducts 10% by default (see Payroll).
- `trip-documents` Storage bucket/policies aren't in the repo.
- None of the Sep 24 – Oct 19 schema work (6 tables, triggers, RPCs,
  RLS) has a migration file — see "Schema reality check".

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

Added Sep 24 – Oct 19 (confirmed live 2026-10-19 by REST probe — each
answered with no "table not found" error): `booking_payments`, `bills`,
`bill_payments`, `creditors`, `leave_requests`, `itinerary_documents`.
**Removed:** `delivery_receipts` (dropped 2026-09-29, PostgREST now
answers PGRST205 for it). RPCs called by the app now:
`count_bookings_for_clients`, `get_login_email`, `get_my_profile`,
`update_my_profile`, `get_trip_client_and_rate`, `record_booking_payment`,
`void_booking_payment`, `create_bill`, `record_bill_payment`, `void_bill`,
`void_bill_payment`, `complete_client_signup` (2026-10-21). Trigger on
`auth.users`: `on_client_signup` → `handle_client_signup()`. Storage bucket: `trip-documents` (private). Edge
Functions: `create-user-account` (deployed), `update-user-account` (NOT
deployed as of 2026-10-19). **No migration files after
`20260918130000_add_employee_attendance.sql`** — every table, column,
trigger (`sync_booking_status`, `free_vehicles_on_delivery`,
`booking_payments_sync`, `bill_payments_sync`), RPC and RLS policy since
then was run by hand in the SQL Editor, so the live DB is the only
record; a fresh Supabase project could not be rebuilt from this repo.

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
- Match existing codebase conventions/patterns exactly instead of
  introducing a "more correct" novel pattern in just the new file. Lint
  is at 0 problems since 2026-10-27 -- keep it there (see that section).
## 2026-10-28: trailer substitution + capacity waves
- **Containers may use either trailer type** (`lib/trailerRules.ts`, self-check
  `node scripts/check-trailer-rules.ts`): `trailerAllowed(cargoType, asked, vehicle)`
  -- Container: Flatbed or Skeletal whichever the client asked for; Loose: the
  asked type only (Flatbed). Lowbed is ignored. `trailerRank` puts a Skeletal
  first for containers (keeps Flatbeds for loose cargo). Used by `capacity.ts`,
  `fleetMatch.ts` (`RankedVehicle.substitute`), the Dispatch Board
  (`DispatchRow.cargo_type`, "(substitute: Skeletal)" label + "Using a …" note,
  `handleTrailerChange` guard), `EditTripCargo` and the Capacity card.
  Capacity breakdown pools container trips as "Flatbed or Skeletal".
- **Parallel (storage-deadline) quotes run in waves** (`placeAt`): trips that
  find no free driver / truck / trailer at the start wait until one of the
  quote's own earlier trips ends. `checkCapacity` is `fits` if the last trip
  ends by the deadline, else `late`. The "fleet too small" card only shows
  when result is late / none. `get_capacity_inputs`' `unassigned` trips don't
  return `cargo_type` yet (optional -- until then they're held to their asked type).
  Approve (`create_booking_from_quote`) still starts storage-deadline trips
  at the same time -- not changed.
