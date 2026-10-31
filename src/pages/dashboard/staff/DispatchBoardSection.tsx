// DispatchBoardSection: board of itineraries -- every active trip, plus
// trips delivered in the last COMPLETED_DAYS days -- for staff to advance
// status and assign crew and vehicles. Three tabs: Needs Assignment
// (missing time slot, driver, truck or trailer) and Assigned -- In
// Progress (fully crewed, not delivered yet) show one block per booking
// (route, Open Booking, "Use Suggested Crew for All N Trips", the
// downpayment banner), earliest trip first; Completed (Delivered) is one
// flat read-only table, newest first. Time, logs and corrections are in
// each row's ⋮ menu. Crew/truck/trailer changes re-check that the trip is
// still active first (the board can be minutes old), and an Admin moving
// a trip back out of Delivered is asked to confirm.
//
// Status editing: Admin gets the full free-choice dropdown (any status,
// any direction) and can go backward directly. Dispatcher's dropdown
// only offers the current status plus the very next step in
// STATUS_FLOW (no skipping, no going backward). For both roles, a trip
// can't leave Awaiting without a driver, truck and trailer (helper is
// optional), and picking "Delivered" opens
// MarkDeliveredModal (confirm + optional damage report) -- only
// Dispatcher/Admin mark trips Delivered; drivers stop at In Transit.
// Instead of going backward,
// Dispatcher gets a "Request
// Correction" button that submits a status_relog_requests row (see
// statusRelogRequests.ts / RequestStatusRelogModal.tsx) for Admin to
// approve or reject from Reports -> Status Relog Requests -- Admin
// approving it is what actually applies the change.
//
// Status changes write directly to itineraries.itinerary_status and log
// to dispatch_status_logs (same pattern as the Driver's own
// UpdateStatusControl.tsx). Driver assignment writes to itinerary_crews:
// assigning a new driver deactivates the previous active "Driver" crew row
// (is_active: false, completed_at set) instead of deleting it, so there's
// a history of who was assigned when. Driver names come from `employees`
// (full_name), and who counts as a driver / helper is the employee's
// position (employees.position) -- so someone added on the Employees page
// can be assigned before they have a login (changed 2026-10-23; it used
// to be users.user_role, which left login-less drivers out).
//
// Time slots (#5/#6): every trip has a slot (itineraries.trip_start_at ->
// trip_end_at, set on quote approval, edited here via EditTripTimeModal).
// A driver/helper can't be picked until the trip has a slot; people busy
// on an overlapping trip (or on leave) are greyed out, free people are
// ranked "Suggested" (lib/tripSchedule.ts: longest since their last trip), and a trip past its end shows "Overdue" with a
// "running late -- reassign?" note on the same person's next trip. The
// database enforces the no-overlap rule too (itinerary_crews_check_slot),
// so its refusal message is what shows if two people race.
//
// Downpayment (#10/#11): no trip of a booking can leave Awaiting until the
// client's downpayment (lib/downpayment.ts) is paid or an Admin waived it.
// The row shows "Awaiting downpayment" and the next status is disabled;
// the database (require_downpayment trigger) enforces the same rule for
// drivers' phones too.
import { Fragment, useEffect, useRef, useState } from 'react'
import { usePaged } from '../../../lib/usePaged'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { isAdmin, isDispatcher } from '../../../lib/roles'
import RequestStatusRelogModal from '../../../components/RequestStatusRelogModal'
import {
  loadMyItineraryRelogRequests,
  type MyItineraryRelogRequest,
} from '../../../lib/statusRelogRequests'
import ItineraryLogModal from './ItineraryLogModal'
import MarkDeliveredModal from './MarkDeliveredModal'
import UpdateStatusModal from './UpdateStatusModal'
import MarkAbsentModal from './MarkAbsentModal'
import BreakdownModal from './BreakdownModal'
import SwapDriverModal, { type SwapChoice } from './SwapDriverModal'
import { freeVehicleIfIdle, setVehicleStatus } from '../../../lib/fleetStatus'
import { showToast } from '../../../components/Toast'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { fetchAll, fetchIn } from '../../../lib/dashboardExpenses'
import { loadApprovedLeave, rangesOverlap, type LeaveRange } from '../../../lib/leaveRequests'
import { loadPayrollSettings, toManilaDate, type PayrollSettings } from '../../../lib/payslip'
import { retimeTrips } from '../../../lib/tripRetime'
import { STEP_MS, planTrips } from '../../../lib/capacity'
import { planRebalance } from '../../../lib/rebalance'
import { loadCapacityInputs } from '../../../lib/capacityLoad'
import PageHeader from '../../../components/PageHeader'
import { formatDate, formatMoney, formatSlot, manilaTimestamp, slotLines } from '../../../lib/format'
import StatusBadge from '../../../components/StatusBadge'
import EditTripTimeModal from './EditTripTimeModal'
import { downpaymentStatus, tripsMayStart, type DownpaymentStatus } from '../../../lib/downpayment'
import { groupTripRates, sumRates } from '../../../lib/lineRates'
import { STORAGE_BADGE, storageState } from '../../../lib/storageDeadline'
import { tripCargoLabel } from '../../../lib/quoteRequest'
import { earliestFreeStart, rankVehicles, type VehicleCandidate } from '../../../lib/fleetMatch'
import { substituteNote, trailerAllowed } from '../../../lib/trailerRules'
import {
  SUGGESTED_COUNT,
  findClash,
  hoursLate,
  isOutNow,
  isOverdue,
  lateEarlierTrip,
  manilaWeek,
  rankCandidates,
  tripOnRoad,
  type ScheduledTrip,
} from '../../../lib/tripSchedule'

// The Completed tab shows trips delivered (by trip date) in the last this-many days.
const COMPLETED_DAYS = 30

// Not Delivered and not Cancelled (null status counts as Awaiting). Used to
// load the board and to refuse changes to a trip that finished meanwhile.
const ACTIVE_TRIP_FILTER = 'itinerary_status.is.null,itinerary_status.not.in.(Delivered,Cancelled)'

const ITINERARY_COLUMNS =
  'itinerary_id, booking_id, trip_date_from, trip_date_to, trip_start_at, trip_end_at, place_of_pickup_id, place_of_delivery_id, itinerary_status, plate_number, trailer_id, cargo_type, container_type, trailer_type, weight, cargo_description, trip_rate'

// One row of ITINERARY_COLUMNS.
type BoardItineraryRow = {
  itinerary_id: number
  booking_id: number
  trip_date_from: string
  trip_date_to: string | null
  trip_start_at: string | null
  trip_end_at: string | null
  place_of_pickup_id: number
  place_of_delivery_id: number
  itinerary_status: string | null
  plate_number: string | null
  trailer_id: number | null
  // This trip's own cargo (cargo per trip since 2026-10-23).
  cargo_type: string | null
  container_type: string | null
  trailer_type: string | null
  weight: number | null
  cargo_description: string | null
  trip_rate: number | string | null
}

type BoardBookingRow = {
  booking_id: number
  hours_per_trip: number | null
  rate_of_delivery_service: number | null
  cost_per_trip: number | null
  amount_paid: number | null
  downpayment_waived_at: string | null
  storage_deadline: string | null
  quote_request_id: number | null
}

type DispatchRow = {
  itinerary_id: number
  booking_id: number
  pickup_location: string
  delivery_location: string
  trip_date_from: string
  trip_date_to: string | null
  // The trip's time slot (null on trips from before slots existed).
  trip_start_at: string | null
  trip_end_at: string | null
  // The booking's hours per trip -- length of a newly set slot.
  hours_per_trip: number | null
  // The booking's downpayment (null = no requirement, older bookings).
  downpayment: DownpaymentStatus | null
  status: string
  assigned_employee_id: number | null
  assigned_driver_name: string | null
  assigned_helper_employee_id: number | null
  assigned_helper_name: string | null
  plate_number: string | null
  trailer_id: number | null
  // This trip's trailer type (Flatbed/Skeletal) -- the trailer dropdown only
  // offers that type. null = no requirement (very old trips).
  required_trailer_type: string | null
  // 'Container' / 'Loose': a container may also ride the other trailer type.
  cargo_type: string | null
  // This trip's cargo, shown under the route ("Loose cargo · 20ft flatbed · 18 t").
  cargo_label: string
  cargo_description: string | null
  // Last free storage day (bookings.storage_deadline): must be Picked Up by
  // 11:59 PM that day. null = not an urgent booking.
  storage_deadline: string | null
  // The quote's Deadline date (delivery by, YYYY-MM-DD), or null.
  delivery_by: string | null
  // This trip's own rate -- the driver's commission (fairness by pesos).
  trip_rate: number | null
}

// Not picked up yet on a storage-deadline booking: 'pending' (still time)
// or 'missed' (day over). null otherwise -- the board only flags trips
// still at the port; met/late shows in the booking's details.
function storagePending(row: DispatchRow, now: number) {
  const state = storageState({ deadline: row.storage_deadline, status: row.status, pickedUpAt: null, now })
  return state === 'pending' || state === 'missed' ? state : null
}

// A trip is "Assigned" (vs "Needs Assignment") once it has a driver,
// truck and trailer -- this is what decides which board table it's in.
function isFullyAssigned(r: DispatchRow) {
  return (
    r.trip_start_at !== null &&
    r.assigned_employee_id !== null &&
    r.plate_number !== null &&
    r.trailer_id !== null
  )
}

// What a trip still needs before it can leave Awaiting. Helper is optional.
function missingForDispatch(r: DispatchRow): string {
  const missing = []
  if (r.trip_start_at === null) missing.push('time slot')
  if (r.assigned_employee_id === null) missing.push('driver')
  if (r.plate_number === null) missing.push('truck')
  if (r.trailer_id === null) missing.push('trailer')
  return missing.join(', ')
}

// Pop-up when a change moves a trip from Needs Assignment to Assigned,
// since the row just jumps tables and is easy to miss.
function toastIfNowAssigned(before: DispatchRow | undefined, change: Partial<DispatchRow>) {
  if (before && !isFullyAssigned(before) && isFullyAssigned({ ...before, ...change })) {
    showToast(`Booking #${before.booking_id} has been Assigned.`)
  }
}

type DriverOption = {
  employee_id: number
  full_name: string
  // Drivers only: licence expiry (YYYY-MM-DD) -- an expired one can't be
  // picked for a trip on/after that date.
  license_expiry?: string | null
  // Drivers only: his assigned truck (employees.assigned_plate_number).
  truck?: string | null
}

type TruckOption = {
  plate_number: string
  current_status: string | null
  next_service_date: string | null
}

// Per vehicle ('T:<plate>' / 'R:<trailer_id>'): open work order, service due dates.
type VehicleService = Map<string, { workOrders: VehicleCandidate['workOrders']; serviceDue: string[] }>

type TrailerOption = {
  trailer_id: number
  plate_number: string | null
  trailer_type: string | null
  current_status: string | null
}

// Dropdown look for the crew / truck / trailer pickers. Orange while
// nothing is picked, so what's still missing stands out.
function pickerClasses(unassigned: boolean) {
  return `min-h-11 w-full min-w-40 rounded-[2px] border border-line-control bg-white px-3 py-2.5 text-sm focus:border-primary disabled:opacity-60 ${
    unassigned ? 'font-medium text-orange-700' : 'text-slate-900'
  }`
}

// People for one trip's driver/helper slot, best first: free people (no
// overlapping trip, not on leave, licence valid), then those blocked with
// the reason (lib/tripSchedule.ts rankCandidates). Shared by the dropdown
// and "Use Suggested Crew for All".
function rankPeople(
  row: DispatchRow,
  people: DriverOption[],
  allRows: DispatchRow[],
  leaveByEmployee: Map<number, LeaveRange[]>,
  now: number,
  pay: PayrollSettings | null = null,
) {
  // A person's trips = every trip they're the active driver or helper on.
  const tripsOf = (employeeId: number): ScheduledTrip[] =>
    allRows.filter((r) => r.assigned_employee_id === employeeId || r.assigned_helper_employee_id === employeeId)
  return {
    tripsOf,
    ranked: rankCandidates(
      row,
      people,
      tripsOf,
      now,
      (clash) => ` — busy ${formatSlot(clash.trip_start_at, clash.trip_end_at)} (trip #${clash.itinerary_id})`,
      (employeeId) => leaveHint(row, employeeId, false, leaveByEmployee) ?? licenceHint(row, people, employeeId),
      (employeeId) => weekEarnings(employeeId, row, allRows, pay),
    ),
  }
}

// What a driver earns that Sun-Sat week (the week of `row`): driver
// commission % x each of his trips' rate + the per-trip fee (payslip.ts
// formula), delivered and planned trips on the board. Helpers earn nothing
// here (salaried), so they keep the old "rested longest" order.
function weekEarnings(employeeId: number, row: DispatchRow, allRows: DispatchRow[], pay: PayrollSettings | null): number {
  if (!pay || !row.trip_start_at) return 0
  const week = manilaWeek(Date.parse(row.trip_start_at))
  return allRows
    .filter((r) => r.assigned_employee_id === employeeId && r.status !== 'Cancelled' && r.trip_start_at)
    .filter((r) => Date.parse(r.trip_start_at!) >= week.from && Date.parse(r.trip_start_at!) < week.to)
    .reduce((sum, r) => sum + (pay.driverCommissionRate / 100) * (r.trip_rate ?? 0) + pay.driverPerTripFee, 0)
}

// Driver or helper picker for one trip. Locked until the trip has a time
// slot. Options are grouped: Suggested (the top free people), Other free,
// and Unavailable (busy on an overlapping trip, or on leave -- disabled,
// except whoever is already assigned so the dropdown still shows them).
// Under it: "Use <top suggestion>" while nobody is picked.
function CrewSelect({
  row,
  crewRole,
  people,
  allRows,
  leaveByEmployee,
  now,
  disabled,
  pay = null,
  onChange,
  onSwap,
}: {
  row: DispatchRow
  crewRole: 'Driver' | 'Helper'
  people: DriverOption[]
  allRows: DispatchRow[]
  leaveByEmployee: Map<number, LeaveRange[]>
  now: number
  disabled: boolean
  pay?: PayrollSettings | null
  onChange: (employeeId: number | null) => void
  // Drivers: pick someone planned on another trip that hasn't started (SwapDriverModal).
  onSwap?: (employeeId: number, otherTripId: number) => void
}) {
  const currentId = crewRole === 'Driver' ? row.assigned_employee_id : row.assigned_helper_employee_id
  const currentName = crewRole === 'Driver' ? row.assigned_driver_name : row.assigned_helper_name

  if (!row.trip_start_at) {
    return (
      <div className="flex flex-col gap-1">
        <select disabled className={pickerClasses(currentId === null)} value="">
          <option value="">{currentName ?? 'Unassigned'}</option>
        </select>
        <span className="text-xs text-amber-700">Set the trip time first (Schedule above)</span>
      </div>
    )
  }

  const { ranked, tripsOf } = rankPeople(row, people, allRows, leaveByEmployee, now, pay)
  const free = ranked.filter((p) => p.blockedBy === null)
  const suggested = free.slice(0, SUGGESTED_COUNT)
  const otherFree = free.slice(SUGGESTED_COUNT)
  // Busy only because of ONE trip that hasn't started (not leave / licence):
  // can be swapped in (drivers).
  const swapTripOf = (employeeId: number) => {
    if (!onSwap || employeeId === currentId) return null
    if (leaveHint(row, employeeId, false, leaveByEmployee) ?? licenceHint(row, people, employeeId)) return null
    const theirs = tripsOf(employeeId).filter((t) => t.itinerary_id !== row.itinerary_id)
    const clash = findClash(row, theirs, now)
    if (!clash || clash.status !== 'Awaiting') return null
    return findClash(row, theirs.filter((t) => t.itinerary_id !== clash.itinerary_id), now) ? null : clash
  }
  const swappable = ranked.filter((p) => p.blockedBy !== null && swapTripOf(p.employee_id))
  const unavailable = ranked.filter((p) => p.blockedBy !== null && !swapTripOf(p.employee_id))

  // The assigned person's earlier trip running late into this one (#6).
  const late = currentId !== null ? lateEarlierTrip(row, tripsOf(currentId), now) : null
  const topPick = currentId === null ? suggested[0] : undefined

  return (
    <div className="flex flex-col gap-1">
      <select
        value={currentId ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const value = e.target.value
          if (value.startsWith('swap:')) {
            const id = Number(value.slice(5))
            onSwap?.(id, swapTripOf(id)!.itinerary_id)
          } else onChange(value ? Number(value) : null)
        }}
        className={pickerClasses(currentId === null)}
      >
        <option value="">Unassigned</option>
        {suggested.length > 0 && (
          <optgroup label="★ Suggested">
            {suggested.map((p) => (
              <option key={p.employee_id} value={p.employee_id}>
                {p.full_name}
              </option>
            ))}
          </optgroup>
        )}
        {otherFree.length > 0 && (
          <optgroup label="Other free">
            {otherFree.map((p) => (
              <option key={p.employee_id} value={p.employee_id}>
                {p.full_name}
              </option>
            ))}
          </optgroup>
        )}
        {swappable.length > 0 && (
          <optgroup label="Planned on another trip (swap)">
            {swappable.map((p) => (
              <option key={p.employee_id} value={`swap:${p.employee_id}`}>
                {p.full_name}
                {p.blockedBy}
              </option>
            ))}
          </optgroup>
        )}
        {unavailable.length > 0 && (
          <optgroup label="Unavailable">
            {unavailable.map((p) => (
              <option key={p.employee_id} value={p.employee_id} disabled={p.employee_id !== currentId}>
                {p.full_name}
                {p.blockedBy}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {topPick && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(topPick.employee_id)}
          className="w-fit text-left text-xs font-semibold text-primary underline hover:no-underline disabled:opacity-50"
        >
          Use {topPick.full_name}
        </button>
      )}
      {late && (
        <span className="text-xs font-medium text-amber-700">
          ⚠ {currentName ?? 'They'}'s trip #{late.itinerary_id} is running late — reassign?
        </span>
      )}
    </div>
  )
}

// A driver whose licence has expired by this trip's date can't be picked
// (the header bell warns ahead of time; this stops the actual assignment).
// Returns the " — licence expired Oct 14" label, or null.
function licenceHint(row: DispatchRow, people: DriverOption[], employeeId: number): string | null {
  const expiry = people.find((p) => p.employee_id === employeeId)?.license_expiry
  if (!expiry || expiry >= row.trip_date_from) return null
  return ` — licence expired ${formatDate(expiry)}`
}

// A driver/helper on approved leave during this trip's dates can't be
// picked. Returns the " — on leave Oct 14 – Oct 16" label, or null if they
// are free (or it's the row's current assignee, who stays selectable so
// the dropdown still shows who is assigned).
function leaveHint(
  row: DispatchRow,
  employeeId: number,
  isCurrent: boolean,
  leaveByEmployee: Map<number, LeaveRange[]>,
): string | null {
  if (isCurrent) return null
  const clash = (leaveByEmployee.get(employeeId) ?? []).find((l) =>
    rangesOverlap(row.trip_date_from, row.trip_date_to, l.start_date, l.end_date),
  )
  if (!clash) return null
  return clash.start_date === clash.end_date
    ? ` — on leave ${formatDate(clash.start_date)}`
    : ` — on leave ${formatDate(clash.start_date)} – ${formatDate(clash.end_date)}`
}

// Fleet Match (lib/fleetMatch.ts): trucks / trailers for one trip, best
// first -- free ones (same booking first, then no service due, then idle
// longest), then Unavailable with the reason (in the shop, open work order,
// on an overlapping trip). Shared by the dropdowns, "Use Suggested Crew &
// Vehicles" and the At-risk notice. The database refuses overlaps too
// (itinerary_vehicle_slot_check).
function truckCandidates(trucks: TruckOption[], service: VehicleService): VehicleCandidate[] {
  return trucks.map((t) => {
    const s = service.get(`T:${t.plate_number}`)
    return {
      id: `T:${t.plate_number}`,
      label: t.plate_number,
      current_status: t.current_status,
      workOrders: s?.workOrders ?? [],
      serviceDue: [...(s?.serviceDue ?? []), ...(t.next_service_date ? [t.next_service_date] : [])],
    }
  })
}

function trailerCandidates(trailers: TrailerOption[], service: VehicleService): VehicleCandidate[] {
  return trailers.map((t) => {
    const s = service.get(`R:${t.trailer_id}`)
    return {
      id: `R:${t.trailer_id}`,
      label: t.plate_number ?? `#${t.trailer_id}`,
      current_status: t.current_status,
      trailer_type: t.trailer_type,
      workOrders: s?.workOrders ?? [],
      serviceDue: s?.serviceDue ?? [],
    }
  })
}

const vehicleIdOf = (kind: 'Truck' | 'Trailer', r: DispatchRow) =>
  kind === 'Truck' ? (r.plate_number ? `T:${r.plate_number}` : null) : r.trailer_id !== null ? `R:${r.trailer_id}` : null

function rankFleet(
  kind: 'Truck' | 'Trailer',
  row: DispatchRow,
  candidates: VehicleCandidate[],
  allRows: DispatchRow[],
  now: number,
) {
  const tripsOf = (id: string): ScheduledTrip[] => allRows.filter((r) => vehicleIdOf(kind, r) === id)
  return {
    tripsOf,
    ranked: rankVehicles(row, candidates, tripsOf, now, (t) => formatSlot(t.trip_start_at!, t.trip_end_at), formatDate),
  }
}

const STATUS_FLOW = ['Awaiting', 'Dispatched', 'PickedUp', 'InTransit', 'Delivered']

const STATUS_LABELS: Record<string, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked Up',
  InTransit: 'In Transit',
  Delivered: 'Delivered',
}

// Everything the trip tables need from the board.
type BoardContext = {
  allRows: DispatchRow[]
  leaveByEmployee: Map<number, LeaveRange[]>
  drivers: DriverOption[]
  helpers: DriverOption[]
  trucks: TruckOption[]
  trailers: TrailerOption[]
  truckCandidates: VehicleCandidate[]
  trailerCandidates: VehicleCandidate[]
  // Dispatcher or Admin.
  canEditStatus: boolean
  // Admin: any status, any direction.
  canFreelyEditStatus: boolean
  savingId: number | null
  // Current time (ms), ticking each minute -- drives Overdue / busy checks.
  now: number
  // Trips with a Pending correction request from this Dispatcher.
  pendingCorrectionIds: Set<number>
  onStatusChange: (itineraryId: number, previousStatus: string, newStatus: string) => void
  onRequestCorrection: (row: DispatchRow) => void
  onCrewChange: (
    itineraryId: number,
    crewRole: 'Driver' | 'Helper',
    previousEmployeeId: number | null,
    newEmployeeId: number | null,
  ) => void
  onTruckChange: (itineraryId: number, previousPlateNumber: string | null, plateNumber: string | null) => Promise<boolean>
  onTrailerChange: (itineraryId: number, previousTrailerId: number | null, trailerId: number | null) => Promise<boolean>
  onViewLogs: (itineraryId: number) => void
  onEditTime: (row: DispatchRow) => void
  onBreakdown: (row: DispatchRow) => void
  // Fairness by pesos (driver commission settings), null until loaded.
  pay: PayrollSettings | null
  onSwap: (row: DispatchRow, employeeId: number, otherTripId: number) => void
}

// Table spacing from the canvas board: 20px at the edges, 16px between
// columns, rows at least 60px tall.
const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
// The canvas's small tag (2px corners, 12px semibold).
const CHIP = 'inline-flex w-fit items-center gap-1.5 rounded-[2px] px-2 py-0.5 text-xs font-semibold whitespace-nowrap'
// Small grey line under a cell's main value.
const SUB = 'block text-[13px] leading-[18px] text-ink-muted'

// Trips on the road right now.
const ON_ROAD = ['Dispatched', 'PickedUp', 'InTransit']

// The day a trip belongs to on the day view: its slot's start (Manila),
// else its trip date.
function tripDay(r: DispatchRow): string {
  return r.trip_start_at ? toManilaDate(new Date(r.trip_start_at)) : r.trip_date_from
}

// 'YYYY-MM-DD' moved by n days (noon UTC, so no timezone edge).
function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// "Today · Fri, Oct 23, 2026"
function dayLabel(day: string, today: string): string {
  const text = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  if (day === today) return `Today · ${text}`
  if (day === shiftDay(today, 1)) return `Tomorrow · ${text}`
  if (day === shiftDay(today, -1)) return `Yesterday · ${text}`
  return text
}

// Small outline icons (24x24 paths, same style as the sidebar's).
const ICONS = {
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
  truck: 'M2 6h11v10H2z M13 9h5l4 4v3h-9z M6 18.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M16 18.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  check: 'M5 12l5 5 9-10',
  wrench: 'M14.5 6.5a4 4 0 0 0 4.5 5L9 21.5a2 2 0 0 1-3-3l10-10 M14.5 6.5l3-3 2 2-3 3',
  calendar: 'M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9h16 M8 2v4 M16 2v4',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  close: 'M6 6l12 12 M18 6L6 18',
  warning: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
}

function Icon({ name, size = 16, className = '' }: { name: keyof typeof ICONS; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

// The five status tiles (and their chip colors), in order.
const FLOW_TILES: { status: string; label: string; icon: keyof typeof ICONS; chip: string }[] = [
  { status: 'Awaiting', label: 'Awaiting', icon: 'clock', chip: 'bg-amber-100 text-amber-900' },
  { status: 'Dispatched', label: 'Dispatched', icon: 'truck', chip: 'bg-primary-soft text-primary' },
  { status: 'PickedUp', label: 'Picked up', icon: 'box', chip: 'bg-violet-100 text-violet-800' },
  { status: 'InTransit', label: 'In transit', icon: 'arrow', chip: 'bg-orange-100 text-orange-800' },
  { status: 'Delivered', label: 'Delivered', icon: 'check', chip: 'bg-green-100 text-green-800' },
]

// Time slot (date above it when the trip isn't on the day being shown),
// plus Overdue / storage-deadline flags.
function SlotCell({ row, now, showDate }: { row: DispatchRow; now: number; showDate: boolean }) {
  const slot = row.trip_start_at ? slotLines(row.trip_start_at, row.trip_end_at) : null
  const storage = storagePending(row, now)
  return (
    <div className="flex flex-col items-start gap-1">
      {slot ? (
        <span className="tabular-nums">
          {showDate && <span className={SUB}>{slot.date}</span>}
          {slot.time}
        </span>
      ) : (
        <span>
          {showDate && <span className={SUB}>{formatDate(row.trip_date_from)}</span>}
          <span className="text-[13px] font-semibold text-orange-700">No time set</span>
        </span>
      )}
      {/* Storage-deadline trip still at the port: that deadline is what
          matters until pickup, so it replaces "Overdue". */}
      {storage ? (
        // Two lines so it stays inside the narrow Time Slot column.
        <span className={`${CHIP} ${STORAGE_BADGE[storage].className} flex-col items-start gap-0`}>
          {storage === 'missed' ? (
            STORAGE_BADGE.missed.label
          ) : (
            <>
              <span>Pick up by</span>
              <span>{formatDate(row.storage_deadline!)} 11:59 PM</span>
            </>
          )}
        </span>
      ) : (
        isOverdue(row, now) && <span className={`${CHIP} bg-red-100 text-red-800`}>Overdue</span>
      )}
    </div>
  )
}

function CargoCell({ row }: { row: DispatchRow }) {
  return (
    <span>
      {row.cargo_label}
      {row.cargo_description && (
        <span className={SUB} title={row.cargo_description}>
          {row.cargo_description}
        </span>
      )}
    </span>
  )
}

// An Awaiting trip can't start while its driver or helper is still on the
// road with another trip. Returns why ("Roy Estoperes is on trip #97"), or
// null when the crew is free. The database enforces it too
// (require_crew_free_of_road).
function crewOnRoadReason(row: DispatchRow, allRows: DispatchRow[]): string | null {
  if (row.status !== 'Awaiting') return null
  const people = [
    { id: row.assigned_employee_id, name: row.assigned_driver_name, helper: false },
    { id: row.assigned_helper_employee_id, name: row.assigned_helper_name, helper: true },
  ]
  for (const p of people) {
    if (p.id === null) continue
    const theirs = allRows
      .filter((r) => (p.helper ? r.assigned_helper_employee_id : r.assigned_employee_id) === p.id)
      .map((r) => ({ itinerary_id: r.itinerary_id, status: r.status }))
    const onRoad = tripOnRoad(theirs, row.itinerary_id)
    if (onRoad) return `${p.name ?? 'The crew'} is on trip #${onRoad.itinerary_id}`
  }
  return null
}

// Why an assigned trip may not happen as planned (the "At-risk trips" notice):
// its driver or helper went on approved leave, the driver's licence ran out,
// its truck/trailer went into the shop, or the driver's earlier trip is
// running late into it. Only trips still to start are checked; the fix is
// reassigning on this board.
function atRiskReasons(
  row: DispatchRow,
  allRows: DispatchRow[],
  leaveByEmployee: Map<number, LeaveRange[]>,
  drivers: DriverOption[],
  trucks: TruckOption[],
  trailers: TrailerOption[],
  now: number,
): string[] {
  if (row.status !== 'Awaiting' && row.status !== 'Dispatched') return []
  const reasons: string[] = []
  const onLeave = (id: number | null, name: string | null) => {
    if (id === null) return
    const leave = (leaveByEmployee.get(id) ?? []).find((l) => rangesOverlap(row.trip_date_from, row.trip_date_to, l.start_date, l.end_date))
    if (leave) reasons.push(`${name ?? 'Crew'} is on leave ${formatDate(leave.start_date)}${leave.end_date !== leave.start_date ? ` – ${formatDate(leave.end_date)}` : ''}`)
  }
  onLeave(row.assigned_employee_id, row.assigned_driver_name)
  onLeave(row.assigned_helper_employee_id, row.assigned_helper_name)
  const expiry = drivers.find((d) => d.employee_id === row.assigned_employee_id)?.license_expiry
  if (expiry && expiry < row.trip_date_from) reasons.push(`${row.assigned_driver_name ?? 'Driver'}'s licence expires before this trip`)
  // Only while the trip hasn't left: a truck that goes in the shop later isn't this trip's problem.
  if (row.status === 'Awaiting') {
    const truck = trucks.find((t) => t.plate_number === row.plate_number)
    if (truck && (truck.current_status === 'Under Maintenance' || truck.current_status === 'Out of Service')) {
      reasons.push(`Truck ${truck.plate_number} is ${truck.current_status}`)
    }
    const trailer = trailers.find((t) => t.trailer_id === row.trailer_id)
    if (trailer && (trailer.current_status === 'Under Maintenance' || trailer.current_status === 'Out of Service')) {
      reasons.push(`Trailer ${trailer.plate_number ?? `#${trailer.trailer_id}`} is ${trailer.current_status}`)
    }
    if (row.assigned_employee_id !== null) {
      const theirs = allRows.filter((r) => r.assigned_employee_id === row.assigned_employee_id && r.itinerary_id !== row.itinerary_id)
      const late = lateEarlierTrip(row, theirs, now)
      if (late) reasons.push(`${row.assigned_driver_name ?? 'Driver'}'s trip #${late.itinerary_id} is running late`)
    }
  }
  // The booking's last trip ends after its delivery-by date: late at this pace (shown on that trip).
  if (row.delivery_by && !row.storage_deadline && row.trip_end_at) {
    const lastEnd = Math.max(...allRows.filter((r) => r.booking_id === row.booking_id && r.trip_end_at).map((r) => Date.parse(r.trip_end_at!)))
    const hours = hoursLate(lastEnd, Date.parse(manilaTimestamp(row.delivery_by, 24 * 60)) - 1)
    if (hours > 0 && Date.parse(row.trip_end_at) === lastEnd) {
      reasons.push(`Booking #${row.booking_id} will be late by ${hours} h at the current pace (delivery-by ${formatDate(row.delivery_by)}) -- speed up the remaining trips`)
    }
  }
  return reasons
}

// Truck or trailer picker for one trip, grouped like the crew pickers:
// Suggested (top free), Other free, Unavailable (with the reason --
// disabled, except the one already on the row). Under it: "Use <top pick>"
// while nothing is picked.
function VehicleSelect({ kind, row, ctx }: { kind: 'Truck' | 'Trailer'; row: DispatchRow; ctx: BoardContext }) {
  const currentId = vehicleIdOf(kind, row)
  const candidates = kind === 'Truck' ? ctx.truckCandidates : ctx.trailerCandidates
  const { ranked } = rankFleet(kind, row, candidates, ctx.allRows, ctx.now)
  const free = ranked.filter((v) => v.blockedBy === null)
  const suggested = free.slice(0, SUGGESTED_COUNT)
  const otherFree = free.slice(SUGGESTED_COUNT)
  const unavailable = ranked.filter((v) => v.blockedBy !== null)
  const topPick = currentId === null && row.trip_start_at ? suggested[0] : undefined
  // "Skeletal instead of the Flatbed asked for" when the assigned trailer isn't the asked type.
  const usingNote =
    kind === 'Trailer' ? substituteNote(row.required_trailer_type, ranked.find((v) => v.id === currentId)?.trailer_type) : null

  // Option value -> what the handlers take (plate / trailer id).
  const pick = (id: string | null) =>
    kind === 'Truck'
      ? ctx.onTruckChange(row.itinerary_id, row.plate_number, id ? id.slice(2) : null)
      : ctx.onTrailerChange(row.itinerary_id, row.trailer_id, id ? Number(id.slice(2)) : null)
  // Just the plate: the "this booking" / "service due" / "work order
  // pending" hints only decide the order, and the Unavailable group is
  // greyed out. The reason shows as a tooltip on hover (title).
  // A container on the other trailer type than asked for says so.
  const label = (v: (typeof ranked)[number]) => (v.substitute ? `${v.label} (substitute: ${v.trailer_type})` : v.label)

  return (
    <div className="flex flex-col gap-1">
      <select
        value={currentId ?? ''}
        disabled={ctx.savingId === row.itinerary_id}
        onChange={(e) => pick(e.target.value || null)}
        className={pickerClasses(currentId === null)}
      >
        <option value="">Unassigned</option>
        {suggested.length > 0 && (
          <optgroup label="★ Suggested">
            {suggested.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </optgroup>
        )}
        {otherFree.length > 0 && (
          <optgroup label="Other free">
            {otherFree.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
          </optgroup>
        )}
        {unavailable.length > 0 && (
          <optgroup label="Unavailable">
            {unavailable.map((v) => (
              <option key={v.id} value={v.id} disabled={v.id !== currentId} title={v.blockedBy ?? undefined}>
                {label(v)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {topPick && (
        <button
          type="button"
          disabled={ctx.savingId === row.itinerary_id}
          onClick={() => pick(topPick.id)}
          className="w-fit text-left text-xs font-semibold text-primary underline hover:no-underline disabled:opacity-50"
        >
          Use {topPick.label}
        </button>
      )}
      {usingNote && <span className="text-xs text-slate-600">Using a {usingNote}</span>}
    </div>
  )
}

// What a trip still needs or is waiting on, as small tags under its status.
// `auto` marks a fix "Fix all at-risk" may run without asking per trip (same key = same fix).
type AtRiskAction = { label: string; onClick: () => void; auto?: { key: string; run: () => Promise<unknown> } }
type AtRisk = { reasons: string[]; actions: AtRiskAction[] }

function TripStatusCell({ row, risk, pendingCorrection }: { row: DispatchRow; risk: AtRisk | undefined; pendingCorrection: boolean }) {
  const needs = row.status === 'Awaiting' && !isFullyAssigned(row) ? missingForDispatch(row) : null
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} icon />
      {needs && <span className="text-[13px] leading-[18px] font-semibold text-orange-700">Needs {needs}</span>}
      {row.status === 'Awaiting' && row.downpayment && !tripsMayStart(row.downpayment) && (
        <span className={`${CHIP} bg-amber-100 text-amber-900`}>Awaiting downpayment</span>
      )}
      {risk && <span className={`${CHIP} bg-red-100 text-red-800`}>At risk</span>}
      {pendingCorrection && <span className={`${CHIP} bg-slate-200 text-ink-secondary`}>Correction pending</span>}
    </div>
  )
}

// One label + value pair in the trip panel.
function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[13px] leading-[18px] font-medium text-ink-muted">{label}</span>
      <div className="text-[15px] leading-[22px] font-medium text-ink">{children}</div>
    </div>
  )
}

const PANEL_HEADING = 'mb-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink'

// "View" on a trip: everything about it in a panel that slides in from the
// right -- schedule (edit time), crew and vehicles (the pickers with
// suggestions), cargo, the booking (downpayment, "Use suggested crew for all
// trips"), at-risk reasons with their one-click fixes, and the logs /
// breakdown / correction actions.
function TripPanel({
  row,
  ctx,
  bookingTrips,
  risk,
  pendingCorrection,
  bulkBusy,
  onClose,
  onUpdateStatus,
  onAssignSuggested,
}: {
  row: DispatchRow
  ctx: BoardContext
  // Every loaded trip of the same booking (this one included).
  bookingTrips: DispatchRow[]
  risk: AtRisk | undefined
  pendingCorrection: boolean
  // "Use suggested crew" is running for this booking.
  bulkBusy: boolean
  onClose: () => void
  onUpdateStatus: (row: DispatchRow) => void
  onAssignSuggested: (trips: DispatchRow[]) => void
}) {
  const done = row.status === 'Delivered'
  const onRoad = ON_ROAD.includes(row.status)
  const trailerPlate =
    row.trailer_id === null ? null : (ctx.trailers.find((t) => t.trailer_id === row.trailer_id)?.plate_number ?? `#${row.trailer_id}`)
  const openTrips = bookingTrips.filter((r) => r.status !== 'Delivered')
  // Trips of this booking with a slot but someone / something still missing.
  const missingCrew = openTrips.filter(
    (r) =>
      r.trip_start_at &&
      (r.assigned_employee_id === null || r.assigned_helper_employee_id === null || r.plate_number === null || r.trailer_id === null),
  )
  // Same downpayment for every trip of a booking.
  const downpaymentDue =
    row.downpayment && !tripsMayStart(row.downpayment) && bookingTrips.some((r) => r.status === 'Awaiting') ? row.downpayment : null
  const canUpdate = ctx.canEditStatus && (!done || ctx.canFreelyEditStatus)
  // "Ready to dispatch?" -- the same rules that keep a trip in Awaiting
  // (isFullyAssigned, the downpayment, crew out on another trip).
  const onRoadReason = crewOnRoadReason(row, ctx.allRows)
  const readyChecks = [
    { label: 'Time slot set', ok: row.trip_start_at !== null },
    { label: 'Driver assigned', ok: row.assigned_employee_id !== null },
    { label: 'Truck assigned', ok: row.plate_number !== null },
    { label: 'Trailer assigned', ok: row.trailer_id !== null },
    // Older bookings have no downpayment rule (downpayment null).
    ...(row.downpayment
      ? [
          {
            label: row.downpayment.waived
              ? 'Downpayment waived'
              : row.downpayment.met
                ? 'Downpayment paid'
                : `Downpayment paid · ${formatMoney(row.downpayment.missing)} to go`,
            ok: tripsMayStart(row.downpayment),
          },
        ]
      : []),
    { label: onRoadReason ? `Crew not out on another trip · ${onRoadReason}` : 'Crew not out on another trip', ok: !onRoadReason },
  ]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40">
      {/* Dim backdrop over the board; clicking it closes the panel. */}
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-panel-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[720px] flex-col border-l-2 border-line-card bg-white"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id="trip-panel-title" className="text-xl leading-7 font-bold text-ink">
                Trip #{row.itinerary_id}
              </h2>
              <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} icon />
            </div>
            <p className="mt-0.5 text-sm text-ink-secondary">
              <Link
                to={`/dashboard/bookings?booking=${row.booking_id}&trip=${row.itinerary_id}`}
                className="font-semibold text-primary hover:underline"
              >
                Booking #{row.booking_id}
              </Link>
              {' · '}
              {row.pickup_location} → {row.delivery_location}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trip"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          {risk && (
            <section className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p className="flex items-center gap-2 font-semibold">
                <Icon name="warning" />
                At risk
              </p>
              <ul className="mt-1 list-disc pl-6">
                {risk.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {ctx.canEditStatus && risk.actions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {risk.actions.map((a) => (
                    <button key={a.label} type="button" onClick={a.onClick} className="btn-secondary px-4 text-sm font-medium">
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {downpaymentDue && (
            <section className="flex flex-wrap items-center justify-between gap-3 border border-amber-600 bg-amber-100 px-4 py-3 text-sm text-amber-900">
              <p>
                <span className="font-semibold">Awaiting downpayment: {formatMoney(downpaymentDue.missing)} to go</span>
                {' · '}
                {formatMoney(downpaymentDue.paid)} of {formatMoney(downpaymentDue.required)} paid. No trip can start until it is paid.
              </p>
              {/* Bills Receivable exists only in the Admin routes. */}
              {ctx.canFreelyEditStatus && (
                <Link to={`/dashboard/financial-records?downpayment=${row.booking_id}`} className="font-semibold underline">
                  Record Downpayment
                </Link>
              )}
            </section>
          )}

          {row.status === 'Awaiting' && (
            <section aria-labelledby="ready-h" className="border-2 border-line-card px-4 py-3">
              <h3 id="ready-h" className="mb-1 text-sm font-semibold text-ink">
                Ready to dispatch?
              </h3>
              <ul className="text-sm">
                {readyChecks.map((check) => (
                  <li key={check.label} className="flex min-h-10 items-center gap-2.5 border-b border-slate-200 last:border-0">
                    {check.ok ? (
                      <Icon name="check" className="text-green-700" />
                    ) : (
                      <Icon name="clock" className="text-ink-muted" />
                    )}
                    <span className="sr-only">{check.ok ? 'Done:' : 'Missing:'}</span>
                    <span className={check.ok ? 'text-ink' : 'text-ink-secondary'}>{check.label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-ink-muted">
                The trip can't leave Awaiting until every item is ticked.
                {row.downpayment ? ' Admin can waive the downpayment.' : ''}
              </p>
            </section>
          )}

          <section>
            <h3 className={PANEL_HEADING}>Schedule</h3>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <PanelField label="Time slot">
                <SlotCell row={row} now={ctx.now} showDate />
              </PanelField>
              {ctx.canEditStatus && !done && (
                <button type="button" onClick={() => ctx.onEditTime(row)} className="btn-secondary px-4 text-sm font-medium">
                  {row.trip_start_at ? 'Edit time' : 'Set time'}
                </button>
              )}
            </div>
          </section>

          <section>
            <h3 className={PANEL_HEADING}>Crew &amp; Vehicles</h3>
            {done ? (
              // Delivered trips are read-only here: changing the driver would
              // move the trip's pay, assigning a truck would put it back on the road.
              <div className="grid gap-4 sm:grid-cols-2">
                <PanelField label="Driver">{row.assigned_driver_name ?? '—'}</PanelField>
                <PanelField label="Helper">{row.assigned_helper_name ?? '—'}</PanelField>
                <PanelField label="Truck">{row.plate_number ?? '—'}</PanelField>
                <PanelField label="Trailer">{trailerPlate ?? '—'}</PanelField>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <PanelField label="Driver">
                  <CrewSelect
                    row={row}
                    crewRole="Driver"
                    people={ctx.drivers}
                    allRows={ctx.allRows}
                    leaveByEmployee={ctx.leaveByEmployee}
                    now={ctx.now}
                    disabled={!ctx.canEditStatus || ctx.savingId === row.itinerary_id}
                    pay={ctx.pay}
                    onChange={(id) => ctx.onCrewChange(row.itinerary_id, 'Driver', row.assigned_employee_id, id)}
                    onSwap={(id, otherTripId) => ctx.onSwap(row, id, otherTripId)}
                  />
                </PanelField>
                <PanelField label="Helper (optional)">
                  <CrewSelect
                    row={row}
                    crewRole="Helper"
                    people={ctx.helpers}
                    allRows={ctx.allRows}
                    leaveByEmployee={ctx.leaveByEmployee}
                    now={ctx.now}
                    disabled={!ctx.canEditStatus || ctx.savingId === row.itinerary_id}
                    onChange={(id) => ctx.onCrewChange(row.itinerary_id, 'Helper', row.assigned_helper_employee_id, id)}
                  />
                </PanelField>
                <PanelField label="Truck">
                  <VehicleSelect kind="Truck" row={row} ctx={ctx} />
                </PanelField>
                <PanelField label={row.required_trailer_type ? `Trailer (${row.required_trailer_type})` : 'Trailer'}>
                  <VehicleSelect kind="Trailer" row={row} ctx={ctx} />
                </PanelField>
              </div>
            )}
          </section>

          <section>
            <h3 className={PANEL_HEADING}>Cargo</h3>
            <div className="text-[15px] font-medium text-ink">
              <CargoCell row={row} />
            </div>
          </section>

          <section>
            <h3 className={PANEL_HEADING}>Booking</h3>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-secondary">
                {bookingTrips.length} {bookingTrips.length === 1 ? 'trip' : 'trips'} on this board · {openTrips.length} not delivered
              </p>
              <div className="flex flex-wrap gap-2">
                {ctx.canEditStatus && missingCrew.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onAssignSuggested(bookingTrips)}
                    disabled={bulkBusy}
                    className="btn-secondary px-4 text-sm font-semibold text-primary"
                  >
                    {bulkBusy
                      ? 'Assigning…'
                      : `Use Suggested Crew & Vehicles for ${missingCrew.length === 1 ? '1 Trip' : `All ${missingCrew.length} Trips`}`}
                  </button>
                )}
                <Link
                  to={`/dashboard/bookings?booking=${row.booking_id}`}
                  className="btn-secondary inline-flex items-center px-4 text-sm font-medium"
                >
                  Open Booking
                </Link>
              </div>
            </div>
          </section>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => ctx.onViewLogs(row.itinerary_id)} className="btn-secondary px-4 text-sm font-medium">
              Status History
            </button>
            {/* A trip on the road whose truck / trailer broke down. */}
            {ctx.canEditStatus && onRoad && (row.plate_number || row.trailer_id !== null) && (
              <button type="button" onClick={() => ctx.onBreakdown(row)} className="btn-secondary px-4 text-sm font-medium">
                Report Breakdown
              </button>
            )}
            {/* Dispatcher: backward moves go through Admin. */}
            {ctx.canEditStatus && !ctx.canFreelyEditStatus && row.status !== 'Awaiting' && (
              <button
                type="button"
                onClick={() => ctx.onRequestCorrection(row)}
                disabled={pendingCorrection}
                className="btn-secondary px-4 text-sm font-medium"
              >
                {pendingCorrection ? 'Correction Pending' : 'Request Correction'}
              </button>
            )}
          </div>
          {canUpdate && (
            <button type="button" onClick={() => onUpdateStatus(row)} className="btn-primary px-6 text-sm">
              Update Status
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

// One line of the Resources Today panel: name, its trips, a status chip.
type ResourceLine = { key: string; name: string; sub: string; chip: { label: string; icon: keyof typeof ICONS; className: string }; muted?: boolean }

const RESOURCE_CHIP = {
  available: { label: 'Available', icon: 'check' as const, className: 'bg-green-100 text-green-800' },
  onTrip: { label: 'On a trip', icon: 'truck' as const, className: 'bg-orange-100 text-orange-800' },
  // On another day than today: it has a trip that day (not out on the road now).
  scheduled: { label: 'Scheduled', icon: 'calendar' as const, className: 'bg-primary-soft text-primary' },
  down: { label: 'Not operational', icon: 'wrench' as const, className: 'bg-amber-100 text-amber-900' },
  leave: { label: 'On leave', icon: 'user' as const, className: 'bg-amber-100 text-amber-900' },
}

function ResourceGroup({ title, summary, lines }: { title: string; summary: string; lines: ResourceLine[] }) {
  return (
    <section>
      <h3 className="mb-1 flex justify-between gap-3 border-b border-line pb-2 text-sm font-semibold text-ink">
        <span>{title}</span>
        <span className="font-medium text-ink-secondary">{summary}</span>
      </h3>
      {lines.length === 0 ? (
        <p className="py-3 text-sm text-ink-muted">None on file.</p>
      ) : (
        lines.map((line) => (
          <div key={line.key} className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 text-sm">
            <div className="min-w-0">
              <div className={`truncate font-semibold ${line.muted ? 'text-ink-muted' : 'text-ink'}`}>{line.name}</div>
              <div className={SUB}>{line.sub}</div>
            </div>
            <span className={`${CHIP} ${line.chip.className}`}>
              <Icon name={line.chip.icon} size={14} />
              {line.chip.label}
            </span>
          </div>
        ))
      )}
    </section>
  )
}

// "Trips #91, #93" / "No trips today"
function tripList(ids: number[], noneText: string): string {
  if (ids.length === 0) return noneText
  return `${ids.length === 1 ? 'Trip' : 'Trips'} ${ids.map((id) => `#${id}`).join(', ')}`
}

// Resources Today: every truck, trailer, driver and helper with the trips
// they have on the day shown and whether they can work (in the shop, on
// leave). "On a trip" is about RIGHT NOW (isOutNow), so it only shows when
// the day shown is today; on another day a resource with a trip that day
// shows "Scheduled" instead.
function ResourcesPanel({
  day,
  isToday,
  dayRows,
  ctx,
}: {
  day: string
  isToday: boolean
  // The trips on the day shown.
  dayRows: DispatchRow[]
  ctx: BoardContext
}) {
  const noTrips = isToday ? 'No trips today' : 'No trips this day'
  const outNow = isToday ? ctx.allRows.filter((r) => isOutNow(r, ctx.now)) : []
  const isDown = (status: string | null) => status === 'Under Maintenance' || status === 'Out of Service'
  // Today: out on the road at this moment. Another day: has a trip that day.
  const busyChip = isToday ? RESOURCE_CHIP.onTrip : RESOURCE_CHIP.scheduled
  const isBusy = (matches: (r: DispatchRow) => boolean) =>
    isToday ? outNow.some(matches) : dayRows.some((r) => r.status !== 'Cancelled' && matches(r))

  const truckLines: ResourceLine[] = ctx.trucks.map((t) => {
    const ids = dayRows.filter((r) => r.plate_number === t.plate_number).map((r) => r.itinerary_id)
    const down = isDown(t.current_status)
    const busy = isBusy((r) => r.plate_number === t.plate_number)
    return {
      key: t.plate_number,
      name: t.plate_number,
      sub: down && ids.length === 0 ? `${t.current_status} · see Truck Monitoring` : tripList(ids, noTrips),
      chip: down ? RESOURCE_CHIP.down : busy ? busyChip : RESOURCE_CHIP.available,
      muted: down,
    }
  })
  const trailerLines: ResourceLine[] = ctx.trailers.map((t) => {
    const ids = dayRows.filter((r) => r.trailer_id === t.trailer_id).map((r) => r.itinerary_id)
    const down = isDown(t.current_status)
    const busy = isBusy((r) => r.trailer_id === t.trailer_id)
    return {
      key: String(t.trailer_id),
      name: `${t.plate_number ?? `#${t.trailer_id}`}${t.trailer_type ? ` · ${t.trailer_type}` : ''}`,
      sub: down && ids.length === 0 ? `${t.current_status} · see Truck Monitoring` : tripList(ids, noTrips),
      chip: down ? RESOURCE_CHIP.down : busy ? busyChip : RESOURCE_CHIP.available,
      muted: down,
    }
  })
  const personLines = (people: DriverOption[], helper: boolean): ResourceLine[] =>
    people.map((p) => {
      const crewId = (r: DispatchRow) => (helper ? r.assigned_helper_employee_id : r.assigned_employee_id)
      const ids = dayRows.filter((r) => crewId(r) === p.employee_id).map((r) => r.itinerary_id)
      const onLeave = (ctx.leaveByEmployee.get(p.employee_id) ?? []).some((l) => l.start_date <= day && day <= l.end_date)
      const busy = isBusy((r) => crewId(r) === p.employee_id)
      return {
        key: String(p.employee_id),
        name: p.full_name,
        sub: tripList(ids, noTrips),
        chip: onLeave ? RESOURCE_CHIP.leave : busy ? busyChip : RESOURCE_CHIP.available,
        muted: onLeave,
      }
    })
  const driverLines = personLines(ctx.drivers, false)
  const helperLines = personLines(ctx.helpers, true)
  const count = (lines: ResourceLine[], chip: ResourceLine['chip'][]) => lines.filter((l) => !chip.includes(l.chip)).length

  return (
    <aside aria-labelledby="res-h" className="card flex flex-col gap-[18px] px-5 py-4">
      <h2 id="res-h" className="text-base leading-6 font-semibold text-ink">
        Resources {isToday ? 'Today' : `· ${dayLabel(day, day)}`}
      </h2>
      <ResourceGroup
        title="Trucks"
        summary={`${count(truckLines, [RESOURCE_CHIP.down])} of ${truckLines.length} operational`}
        lines={truckLines}
      />
      <ResourceGroup
        title="Trailers"
        summary={`${count(trailerLines, [RESOURCE_CHIP.down])} of ${trailerLines.length} operational`}
        lines={trailerLines}
      />
      <ResourceGroup
        title="Drivers"
        summary={`${count(driverLines, [RESOURCE_CHIP.leave, busyChip])} of ${driverLines.length} available`}
        lines={driverLines}
      />
      {helperLines.length > 0 && (
        <ResourceGroup
          title="Helpers"
          summary={`${count(helperLines, [RESOURCE_CHIP.leave, busyChip])} of ${helperLines.length} available`}
          lines={helperLines}
        />
      )}
      <Link
        to="/dashboard/schedule-overview"
        className="mt-auto inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline"
      >
        Open Schedule Overview
        <Icon name="arrow" />
      </Link>
    </aside>
  )
}

function DispatchBoardSection() {
  const { employeeId, role } = useAuth()
  const canFreelyEditStatus = isAdmin(role)
  const canEditStatus = isAdmin(role) || isDispatcher(role)
  const [relogRequestRow, setRelogRequestRow] = useState<DispatchRow | null>(null)
  const [deliveryRow, setDeliveryRow] = useState<DispatchRow | null>(null)
  // A forward status move waiting for "when did it happen?" (StatusTimeModal).
  const [showAbsent, setShowAbsent] = useState(false)
  // The trip whose truck / trailer broke down (BreakdownModal).
  const [breakdownRow, setBreakdownRow] = useState<DispatchRow | null>(null)
  // The day shown ('YYYY-MM-DD', Manila), or 'all' = every trip not delivered yet.
  const [day, setDay] = useState<string>(() => toManilaDate(new Date()))
  // Day view or the Sun-Sat week (the payroll week) around `day`.
  const [view, setView] = useState<'day' | 'week'>('day')
  const dateInputRef = useRef<HTMLInputElement>(null)
  // Filters: status ('all' | 'needs' | 'atrisk' | a status), driver ('all' | 'none' | employee id), booking / trip #.
  // Starts on "Needs assignment" -- what dispatch has to deal with first.
  const [statusFilter, setStatusFilter] = useState('all')
  const [driverFilter, setDriverFilter] = useState('all')
  const [bookingFilter, setBookingFilter] = useState('')
  // The trip open in the View panel, and the one in the Update Status pop-up.
  const [panelRowId, setPanelRowId] = useState<number | null>(null)
  const [statusRowId, setStatusRowId] = useState<number | null>(null)
  const [logsItineraryId, setLogsItineraryId] = useState<number | null>(null)
  const [rows, setRows] = useState<DispatchRow[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [helpers, setHelpers] = useState<DriverOption[]>([])
  // Approved leave that hasn't ended, per employee -- greys out their dropdown option.
  const [leaveByEmployee, setLeaveByEmployee] = useState<Map<number, LeaveRange[]>>(new Map())
  const [trucks, setTrucks] = useState<TruckOption[]>([])
  const [trailers, setTrailers] = useState<TrailerOption[]>([])
  const [vehicleService, setVehicleService] = useState<VehicleService>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  // Booking whose "Use Suggested Crew" is running (null = none).
  const [bulkBookingId, setBulkBookingId] = useState<number | null>(null)
  const [myRequests, setMyRequests] = useState<MyItineraryRelogRequest[]>([])
  // Trip whose time slot is being edited (EditTripTimeModal).
  const [editTimeRow, setEditTimeRow] = useState<DispatchRow | null>(null)
  // Driver commission settings, for fairness by pesos (null = not loaded / missing).
  const [pay, setPay] = useState<PayrollSettings | null>(null)
  // A driver planned on another trip, picked for `row` (SwapDriverModal).
  const [swap, setSwap] = useState<{ row: DispatchRow; employeeId: number; otherTripId: number } | null>(null)
  // Settings' default trip start (minutes after midnight), for trips with no slot yet.
  const [defaultStartMinutes, setDefaultStartMinutes] = useState(360)
  // "Now", refreshed every minute so Overdue / running-late flags appear on their own.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    loadDispatchBoard()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Dispatcher only: their own correction requests and how they went.
  useEffect(() => {
    if (isDispatcher(role) && employeeId) loadMyRequests(employeeId)
  }, [role, employeeId])

  async function loadMyRequests(forEmployeeId: number) {
    const { requests, error: requestsError } = await loadMyItineraryRelogRequests(forEmployeeId)
    if (requestsError) {
      setError(`Could not load your correction requests (${requestsError}).`)
      return
    }
    setMyRequests(requests)
  }

  function handleRequestCorrection(row: DispatchRow) {
    // Without a linked employees row there's no one to record as the
    // requester -- say so instead of the button silently doing nothing.
    if (!employeeId) {
      setError('Your account is not linked to an employee record, so you cannot send requests. Ask an admin to link it.')
      return
    }
    setRelogRequestRow(row)
  }

  async function loadDispatchBoard() {
    setLoading(true)

    // 1. Every itinerary except Cancelled ones -- Delivered trips used to
    // be excluded here too and just vanished off the board; they're now
    // shown in their own "Completed" table below instead. Newest trip
    // date first (most recently added trips tend to be scheduled
    // furthest out, so this is what actually surfaces new work instead
    // of burying it at the bottom of a long list).
    // Every ACTIVE trip, plus Delivered ones from the last
    // COMPLETED_DAYS days for the Completed tab (older deliveries are in
    // Bookings & Trips and the Reports logs). Loading every delivery ever
    // made the board slower each month and, past Supabase's 1000-row cap,
    // silently dropped the oldest rows -- which could be an old trip that
    // is still Awaiting. fetchAll pages past that cap.
    const completedSince = toManilaDate(new Date(Date.now() - COMPLETED_DAYS * 86_400_000))
    const [activeResult, deliveredResult] = await Promise.all([
      fetchAll<BoardItineraryRow>((from, to) =>
        supabase
          .from('itineraries')
          .select(ITINERARY_COLUMNS)
          .or(ACTIVE_TRIP_FILTER)
          .order('itinerary_id', { ascending: false })
          .range(from, to),
      ),
      fetchAll<BoardItineraryRow>((from, to) =>
        supabase
          .from('itineraries')
          .select(ITINERARY_COLUMNS)
          .eq('itinerary_status', 'Delivered')
          .gte('trip_date_from', completedSince)
          .order('itinerary_id', { ascending: false })
          .range(from, to),
      ),
    ])

    const itineraryError = activeResult.error ?? deliveredResult.error
    if (itineraryError) {
      setError(itineraryError)
      setLoading(false)
      return
    }
    // Newest trip date first (ties: newest trip first).
    const itineraryRows = [...activeResult.rows, ...deliveredResult.rows].sort(
      (a, b) =>
        (b.trip_date_from ?? '').localeCompare(a.trip_date_from ?? '') ||
        b.itinerary_id - a.itinerary_id,
    )

    // Trucks/trailers to populate the assignment dropdowns -- needed
    // even when there are no active itineraries yet, so load them
    // regardless.
    const [trucksResult, trailersResult, startSettingResult] = await Promise.all([
      supabase.from('truck_profiles').select('plate_number, current_status, next_service_date').order('plate_number'),
      supabase.from('trailers').select('trailer_id, plate_number, trailer_type, current_status').order('trailer_id'),
      supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'default_trip_start_time')
        .maybeSingle(),
    ])
    // Not fatal: without them suggestions skip fairness by pesos.
    loadPayrollSettings().then(({ settings }) => setPay(settings))
    // Missing setting just keeps the 6 AM fallback.
    if (startSettingResult.data) setDefaultStartMinutes(Number(startSettingResult.data.setting_value))

    // Fleet Match: open work orders block a vehicle, pending maintenance
    // schedules move it down the suggestions. Not fatal -- without them the
    // suggestions just don't know about the shop.
    const [workOrdersResult, schedulesResult] = await Promise.all([
      supabase.from('work_orders').select('plate_number, trailer_id, work_order_status, scheduled_start_date').not('work_order_status', 'in', '("Completed","Cancelled")'),
      supabase.from('maintenance_schedules').select('plate_number, trailer_id, due_date').eq('status', 'Pending'),
    ])
    const service: VehicleService = new Map()
    const serviceEntry = (plate: string | null, trailerId: number | null) => {
      const key = plate ? `T:${plate}` : `R:${trailerId}`
      if (!service.has(key)) service.set(key, { workOrders: [], serviceDue: [] })
      return service.get(key)!
    }
    for (const w of workOrdersResult.data ?? []) {
      serviceEntry(w.plate_number, w.trailer_id).workOrders.push({
        status: w.work_order_status,
        // Only the day matters (timestamps are cut to YYYY-MM-DD).
        scheduledDate: w.scheduled_start_date ? String(w.scheduled_start_date).slice(0, 10) : null,
      })
    }
    for (const m of schedulesResult.data ?? []) serviceEntry(m.plate_number, m.trailer_id).serviceDue.push(m.due_date)
    setVehicleService(service)

    if (trucksResult.error) {
      setError(trucksResult.error.message)
      setLoading(false)
      return
    }
    if (trailersResult.error) {
      setError(trailersResult.error.message)
      setLoading(false)
      return
    }

    // Which trailer type each booking asked for (bookings.trailer_type).
    const bookingIds = [...new Set(itineraryRows.map((it) => it.booking_id))]
    // fetchIn: ids a few hundred at a time (one long list breaks the URL).
    // The downpayment needs each booking's whole trip count, and the board
    // no longer loads every delivered trip -- so count them here.
    const [bookingTypeResult, bookingTripsResult] = await Promise.all([
      fetchIn<BoardBookingRow>(bookingIds, (chunk, from, to) =>
        supabase
          .from('bookings')
          .select('booking_id, hours_per_trip, rate_of_delivery_service, cost_per_trip, amount_paid, downpayment_waived_at, storage_deadline, quote_request_id')
          .in('booking_id', chunk)
          .range(from, to),
      ),
      fetchIn<{ booking_id: number; itinerary_status: string | null; trip_rate: number | string | null }>(bookingIds, (chunk, from, to) =>
        supabase
          .from('itineraries')
          .select('booking_id, itinerary_status, trip_rate')
          .in('booking_id', chunk)
          .range(from, to),
      ),
    ])
    const bookingTypeError = bookingTypeResult.error ?? bookingTripsResult.error
    if (bookingTypeError) {
      setError(bookingTypeError)
      setLoading(false)
      return
    }
    const bookingTypeRows = bookingTypeResult.rows
    // Each booking's delivery-by date (its quote's Deadline date), for the "running late" alert.
    const quoteIds = bookingTypeRows.flatMap((b) => (b.quote_request_id === null ? [] : [b.quote_request_id as number]))
    const { data: quoteDates } = quoteIds.length
      ? await supabase.from('quote_requests').select('quote_request_id, preferred_delivery_date').in('quote_request_id', quoteIds)
      : { data: [] }
    const deliveryByQuote = new Map((quoteDates ?? []).map((q) => [q.quote_request_id as number, q.preferred_delivery_date as string | null]))
    const deliveryByBooking = new Map(
      bookingTypeRows.map((b) => [b.booking_id as number, b.quote_request_id === null ? null : (deliveryByQuote.get(b.quote_request_id as number) ?? null)]),
    )
    const storageDeadlineByBooking = new Map(
      bookingTypeRows.map((b) => [b.booking_id as number, b.storage_deadline]),
    )
    const hoursPerTripByBooking = new Map(
      bookingTypeRows.map((b) => [b.booking_id as number, b.hours_per_trip as number | null]),
    )
    // Downpayment per booking: ALL its non-cancelled itineraries, each at its own rate.
    const tripRatesByBooking = groupTripRates(
      bookingTripsResult.rows,
      new Map(bookingTypeRows.map((b) => [b.booking_id as number, b.rate_of_delivery_service])),
    )
    const downpaymentByBooking = new Map(
      bookingTypeRows.map((b) => [
        b.booking_id as number,
        downpaymentStatus({
          contract: b.rate_of_delivery_service === null ? null : sumRates(tripRatesByBooking.get(b.booking_id)?.live ?? []),
          costPerTrip: b.cost_per_trip,
          trips: tripRatesByBooking.get(b.booking_id)?.live.length ?? 0,
          amountPaid: b.amount_paid,
          waivedAt: b.downpayment_waived_at,
        }),
      ]),
    )

    setTrucks(trucksResult.data)
    setTrailers(trailersResult.data)

    if (itineraryRows.length === 0) {
      setRows([])
      setDrivers([])
      setHelpers([])
      setError(null)
      setLoading(false)
      return
    }

    const itineraryIds = itineraryRows.map((r) => r.itinerary_id)
    const placeIds = Array.from(
      new Set(
        itineraryRows.flatMap((r) => [
          r.place_of_pickup_id,
          r.place_of_delivery_id,
        ]),
      ),
    )

    // 2. Place names, current crew assignments, and assignable staff -- in parallel.
    const [placesResult, crewResult, driverUsersResult, helperUsersResult, leaveResult] = await Promise.all([
      fetchIn<{ place_id: number; place_name: string }>(placeIds, (chunk, from, to) =>
        supabase.from('places').select('place_id, place_name').in('place_id', chunk).range(from, to),
      ),
      fetchIn<{ itinerary_id: number; employee_id: number; crew_role: string }>(
        itineraryIds,
        (chunk, from, to) =>
          supabase
            .from('itinerary_crews')
            .select('itinerary_id, employee_id, crew_role')
            .in('crew_role', ['Driver', 'Helper'])
            .eq('is_active', true)
            .in('itinerary_id', chunk)
            .range(from, to),
      ),
      // Who can be picked: everyone whose Employees-page position is
      // Driver / Helper -- with or without a login yet.
      supabase.from('employees').select('employee_id').eq('position', 'Driver'),
      supabase.from('employees').select('employee_id').eq('position', 'Helper'),
      loadApprovedLeave(toManilaDate(new Date())),
    ])

    if (leaveResult.error) {
      setError(leaveResult.error)
      setLoading(false)
      return
    }
    setLeaveByEmployee(leaveResult.byEmployee)

    if (placesResult.error) {
      setError(placesResult.error)
      setLoading(false)
      return
    }
    if (crewResult.error) {
      setError(crewResult.error)
      setLoading(false)
      return
    }
    if (driverUsersResult.error) {
      setError(driverUsersResult.error.message)
      setLoading(false)
      return
    }
    if (helperUsersResult.error) {
      setError(helperUsersResult.error.message)
      setLoading(false)
      return
    }

    const placeNameById = new Map(
      placesResult.rows.map((p) => [p.place_id, p.place_name]),
    )
    const assignedDriverIdByItinerary = new Map(
      crewResult.rows
        .filter((c) => c.crew_role === 'Driver')
        .map((c) => [c.itinerary_id, c.employee_id as number]),
    )
    const assignedHelperIdByItinerary = new Map(
      crewResult.rows
        .filter((c) => c.crew_role === 'Helper')
        .map((c) => [c.itinerary_id, c.employee_id as number]),
    )

    // 3. Employee names, for every assignable driver plus whoever's
    // currently assigned (in case their `users` role ever changed).
    const employeeIds = new Set<number>(
      driverUsersResult.data.map((u) => u.employee_id as number),
    )
    helperUsersResult.data.forEach((u) => employeeIds.add(u.employee_id as number))
    crewResult.rows.forEach((c) => employeeIds.add(c.employee_id as number))

    const [employeesResult, statusesResult] = await Promise.all([
      fetchIn<{
        employee_id: number
        full_name: string
        employment_status_id: number | null
        driver_license_expiry_date: string | null
        assigned_plate_number: string | null
      }>(
        Array.from(employeeIds),
        (chunk, from, to) =>
          supabase
            .from('employees')
            .select('employee_id, full_name, employment_status_id, driver_license_expiry_date, assigned_plate_number')
            .in('employee_id', chunk)
            .range(from, to),
      ),
      supabase.from('employment_status').select('status_id, status_name'),
    ])

    const employeeError = employeesResult.error ?? statusesResult.error?.message
    if (employeeError) {
      setError(employeeError)
      setLoading(false)
      return
    }
    const employeeRows = employeesResult.rows

    // Deactivated/Terminated employees can't be picked any more (same
    // rule payroll uses). They still show by name on trips they're
    // already assigned to.
    const inactiveStatusIds = new Set(
      (statusesResult.data ?? [])
        .filter((st) => st.status_name === 'Deactivated' || st.status_name === 'Terminated')
        .map((st) => st.status_id),
    )
    const isActiveEmployee = (e: { employment_status_id: number | null }) =>
      e.employment_status_id === null || !inactiveStatusIds.has(e.employment_status_id)

    const employeeNameById = new Map(
      employeeRows.map((e) => [e.employee_id, e.full_name]),
    )
    const driverEmployeeIds = new Set(
      driverUsersResult.data.map((u) => u.employee_id as number),
    )
    const helperEmployeeIds = new Set(
      helperUsersResult.data.map((u) => u.employee_id as number),
    )

    setDrivers(
      employeeRows
        .filter((e) => driverEmployeeIds.has(e.employee_id) && isActiveEmployee(e))
        .map((e) => ({
          employee_id: e.employee_id,
          full_name: e.full_name,
          license_expiry: e.driver_license_expiry_date,
          truck: e.assigned_plate_number,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    )
    setHelpers(
      employeeRows
        .filter((e) => helperEmployeeIds.has(e.employee_id) && isActiveEmployee(e))
        .map((e) => ({ employee_id: e.employee_id, full_name: e.full_name }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    )

    setRows(
      itineraryRows.map((it) => {
        const assignedEmployeeId =
          assignedDriverIdByItinerary.get(it.itinerary_id) ?? null
        const assignedHelperEmployeeId =
          assignedHelperIdByItinerary.get(it.itinerary_id) ?? null
        return {
          itinerary_id: it.itinerary_id,
          booking_id: it.booking_id,
          pickup_location: placeNameById.get(it.place_of_pickup_id) ?? '—',
          delivery_location:
            placeNameById.get(it.place_of_delivery_id) ?? '—',
          trip_date_from: it.trip_date_from,
          trip_date_to: it.trip_date_to,
          trip_start_at: it.trip_start_at,
          trip_end_at: it.trip_end_at,
          hours_per_trip: hoursPerTripByBooking.get(it.booking_id) ?? null,
          downpayment: downpaymentByBooking.get(it.booking_id) ?? null,
          status: it.itinerary_status ?? 'Awaiting',
          assigned_employee_id: assignedEmployeeId,
          assigned_driver_name:
            assignedEmployeeId !== null
              ? employeeNameById.get(assignedEmployeeId) ?? '—'
              : null,
          assigned_helper_employee_id: assignedHelperEmployeeId,
          assigned_helper_name:
            assignedHelperEmployeeId !== null
              ? employeeNameById.get(assignedHelperEmployeeId) ?? '—'
              : null,
          plate_number: it.plate_number,
          trailer_id: it.trailer_id,
          required_trailer_type: it.trailer_type,
          cargo_type: it.cargo_type,
          cargo_label: tripCargoLabel(it),
          cargo_description: it.cargo_description,
          storage_deadline: storageDeadlineByBooking.get(it.booking_id) ?? null,
          delivery_by: deliveryByBooking.get(it.booking_id) ?? null,
          trip_rate: it.trip_rate === null ? null : Number(it.trip_rate),
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  async function handleStatusChange(
    itineraryId: number,
    previousStatus: string,
    newStatus: string,
  ) {
    // Delivered goes through MarkDeliveredModal so any damage gets
    // recorded (Damage Charges).
    if (newStatus === 'Delivered') {
      const row = rows.find((r) => r.itinerary_id === itineraryId)
      if (row) setDeliveryRow(row)
      return
    }

    // Admin moving a trip back out of Delivered (Completed tab): one
    // mis-click would un-deliver it, so ask first.
    if (previousStatus === 'Delivered') {
      const ok = await confirmDialog({
        title: `Un-deliver trip #${itineraryId}?`,
        message:
          `This moves the trip back to "${STATUS_LABELS[newStatus] ?? newStatus}". The booking's ` +
          'status and what the client is billed change with it, and the trip may already be on ' +
          "a driver's payslip -- check Payroll afterwards.",
        confirmLabel: 'Move it back',
        danger: true,
      })
      if (!ok) return
    }

    // Forward moves come with their time from UpdateStatusModal and go
    // straight to applyStatusChange; this path is backward moves (Admin).
    await applyStatusChange(itineraryId, previousStatus, newStatus)
  }

  // The actual update + log. `atMs` = when it happened (default: now).
  async function applyStatusChange(itineraryId: number, previousStatus: string, newStatus: string, atMs?: number) {
    setSavingId(itineraryId)
    setError(null)

    // Only applies if the trip is still at the status shown here (so a
    // driver's newer change isn't overwritten), and checks a row really
    // changed (a silent RLS no-op would otherwise look like success).
    const { data: updated, error: updateError } = await supabase
      .from('itineraries')
      .update({ itinerary_status: newStatus })
      .eq('itinerary_id', itineraryId)
      .eq('itinerary_status', previousStatus)
      .select('itinerary_id')
      .maybeSingle()

    if (updateError) {
      setError(updateError.message)
      setSavingId(null)
      return
    }
    if (!updated) {
      setError(
        `Trip #${itineraryId} was not updated -- its status was changed by ` +
          'someone else in the meantime. The board has been reloaded.',
      )
      setSavingId(null)
      loadDispatchBoard()
      return
    }

    const { error: logError } = await supabase
      .from('dispatch_status_logs')
      .insert({
        itinerary_id: itineraryId,
        previous_status: previousStatus,
        new_status: newStatus,
        changed_by: employeeId,
        // Left out = the database's now().
        ...(atMs ? { status_changed_at: new Date(atMs).toISOString() } : {}),
      })

    setSavingId(null)

    // The status update above already succeeded even if the log insert
    // below fails -- reflect the real status on screen either way, and
    // only use the log failure to show a warning, not to hide the change
    // that actually happened.
    // On "Delivered", freeing the truck/trailer (free_vehicles_on_delivery)
    // and the booking's own status (sync_booking_status) both follow
    // automatically -- triggers on itineraries handle them in the
    // database, for the Driver's delivery flow too.

    // Delivered trips stay in `rows` and move into the Completed table
    // (grouped at render time) instead of disappearing.
    setRows((prev) =>
      prev.map((r) =>
        r.itinerary_id === itineraryId ? { ...r, status: newStatus } : r,
      ),
    )

    if (logError) {
      setError(
        `Status was updated to "${newStatus}", but recording it in the ` +
          `dispatch log failed (${logError.message}). The status change ` +
          `itself went through.`,
      )
    }
  }

  // The board shows trips as they were when it loaded. Before changing a
  // trip's crew, check it's still active right now -- changing the driver
  // of a trip delivered meanwhile would move its pay to someone else.
  // Says so and reloads the board when it isn't.
  async function tripStillActive(itineraryId: number): Promise<boolean> {
    const { data, error: checkError } = await supabase
      .from('itineraries')
      .select('itinerary_status')
      .eq('itinerary_id', itineraryId)
      .maybeSingle()
    if (checkError) {
      setError(checkError.message)
      return false
    }
    const status = data?.itinerary_status
    if (!data || status === 'Delivered' || status === 'Cancelled') {
      setError(
        `Trip #${itineraryId} is ${data ? (status === 'Delivered' ? 'already delivered' : 'cancelled') : 'gone'} -- ` +
          'nothing was changed. The board has been reloaded.',
      )
      loadDispatchBoard()
      return false
    }
    return true
  }

  // Truck/trailer write: only while the trip is still active, and check a
  // row really changed (a blocked update reports no error). False = not
  // saved (the message is already shown).
  async function updateActiveTrip(
    itineraryId: number,
    change: { plate_number: string | null } | { trailer_id: number | null },
  ): Promise<boolean> {
    const { data, error: updateError } = await supabase
      .from('itineraries')
      .update(change)
      .eq('itinerary_id', itineraryId)
      .or(ACTIVE_TRIP_FILTER)
      .select('itinerary_id')
      .maybeSingle()
    if (updateError) {
      setError(updateError.message)
      return false
    }
    if (!data) {
      setError(
        `Trip #${itineraryId} was not changed -- it was delivered or cancelled in the meantime. ` +
          'The board has been reloaded.',
      )
      loadDispatchBoard()
      return false
    }
    return true
  }

  async function handleCrewChange(
    itineraryId: number,
    crewRole: 'Driver' | 'Helper',
    previousEmployeeId: number | null,
    newEmployeeId: number | null,
  ): Promise<boolean> {
    setSavingId(itineraryId)
    setError(null)

    if (!(await tripStillActive(itineraryId))) {
      setSavingId(null)
      return false
    }

    // 1. Deactivate the current assignment, if there is one -- kept as a
    // history row instead of deleted. Deactivates EVERY active row for
    // this role on the trip (not just the one this screen shows), so if
    // someone else assigned a person in the meantime the trip still
    // ends up with exactly one active driver/helper.
    if (previousEmployeeId !== null) {
      const { error: deactivateError } = await supabase
        .from('itinerary_crews')
        .update({ is_active: false, completed_at: new Date().toISOString() })
        .eq('itinerary_id', itineraryId)
        .eq('crew_role', crewRole)
        .eq('is_active', true)

      if (deactivateError) {
        setError(deactivateError.message)
        setSavingId(null)
        return false
      }
    }

    // 2. Assign the new driver, unless "Unassigned" was picked.
    if (newEmployeeId !== null) {
      const { error: assignError } = await supabase
        .from('itinerary_crews')
        .insert({
          itinerary_id: itineraryId,
          employee_id: newEmployeeId,
          crew_role: crewRole,
        })

      if (assignError) {
        // The previous driver was already deactivated in step 1, so the
        // itinerary now genuinely has no active driver in the database --
        // reflect that on screen instead of leaving the old name showing,
        // which would make it look like nothing happened.
        const role = crewRole.toLowerCase()
        // The database refuses overlapping slots with a readable message
        // ("Juan is already on trip #57 at that time.").
        setError(
          previousEmployeeId === null
            ? assignError.message
            : `The previous ${role} was removed, but assigning the new one ` +
                `failed (${assignError.message}). This trip now has no ` +
                `${role} assigned -- please pick one again.`,
        )
        setSavingId(null)
        setRows((prev) =>
          prev.map((r) =>
            r.itinerary_id !== itineraryId
              ? r
              : crewRole === 'Driver'
                ? { ...r, assigned_employee_id: null, assigned_driver_name: null }
                : { ...r, assigned_helper_employee_id: null, assigned_helper_name: null },
          ),
        )
        return false
      }
    }

    setSavingId(null)

    if (crewRole === 'Driver') {
      toastIfNowAssigned(rows.find((r) => r.itinerary_id === itineraryId), {
        assigned_employee_id: newEmployeeId,
      })
    }

    const newCrewName =
      newEmployeeId !== null
        ? (crewRole === 'Driver' ? drivers : helpers).find(
            (person) => person.employee_id === newEmployeeId,
          )?.full_name ?? '—'
        : null

    setRows((prev) =>
      prev.map((r) =>
        r.itinerary_id === itineraryId
          ? {
              ...r,
              ...(crewRole === 'Driver'
                ? {
                    assigned_employee_id: newEmployeeId,
                    assigned_driver_name: newCrewName,
                  }
                : {
                    assigned_helper_employee_id: newEmployeeId,
                    assigned_helper_name: newCrewName,
                  }),
            }
          : r,
      ),
    )
    return true
  }

  // Truck/trailer assignment: a plain overwrite on the itinerary row --
  // unlike driver assignment, no history is kept of previous
  // assignments (itinerary_crews tracks driver history; there's no
  // equivalent table for trucks/trailers). Then the fleet status follows
  // (lib/fleetStatus.ts): the new vehicle goes Available -> In Transit,
  // and the one it replaced goes back to Available only if it isn't on
  // another active trip. Neither ever touches a vehicle that's Under
  // Maintenance / Out of Service.
  async function syncFleetStatus(
    newVehicle: { plate: string | null; trailerId: number | null } | null,
    previousVehicle: { plate: string | null; trailerId: number | null } | null,
  ) {
    const errors: string[] = []
    if (newVehicle) {
      const err = await setVehicleStatus(newVehicle.plate, newVehicle.trailerId, 'Available', 'In Transit')
      if (err) errors.push(err)
    }
    if (previousVehicle) {
      const err = await freeVehicleIfIdle(previousVehicle.plate, previousVehicle.trailerId)
      if (err) errors.push(err)
    }
    if (errors.length > 0) {
      setError(
        `The assignment was saved, but updating the vehicle's fleet status ` +
          `failed (${errors.join('; ')}). Check it on the Fleet page.`,
      )
    }
  }

  async function handleTruckChange(
    itineraryId: number,
    previousPlateNumber: string | null,
    plateNumber: string | null,
  ): Promise<boolean> {
    setSavingId(itineraryId)
    setError(null)

    if (!(await updateActiveTrip(itineraryId, { plate_number: plateNumber }))) {
      setSavingId(null)
      return false
    }

    setRows((prev) =>
      prev.map((r) =>
        r.itinerary_id === itineraryId ? { ...r, plate_number: plateNumber } : r,
      ),
    )
    toastIfNowAssigned(rows.find((r) => r.itinerary_id === itineraryId), { plate_number: plateNumber })

    await syncFleetStatus(
      plateNumber ? { plate: plateNumber, trailerId: null } : null,
      previousPlateNumber && previousPlateNumber !== plateNumber
        ? { plate: previousPlateNumber, trailerId: null }
        : null,
    )
    setSavingId(null)
    return true
  }

  async function handleTrailerChange(
    itineraryId: number,
    previousTrailerId: number | null,
    trailerId: number | null,
  ): Promise<boolean> {
    // Guard the dropdown filter: the trailer must match this trip's cargo.
    const row = rows.find((r) => r.itinerary_id === itineraryId)
    const picked = trailers.find((t) => t.trailer_id === trailerId)
    if (row && picked && !trailerAllowed(row.cargo_type, row.required_trailer_type, picked.trailer_type)) {
      setError(
        row.cargo_type === 'Container'
          ? `This container trip needs a Flatbed or Skeletal trailer.`
          : `This trip needs a ${row.required_trailer_type} trailer.`,
      )
      return false
    }

    setSavingId(itineraryId)
    setError(null)

    if (!(await updateActiveTrip(itineraryId, { trailer_id: trailerId }))) {
      setSavingId(null)
      return false
    }

    setRows((prev) =>
      prev.map((r) =>
        r.itinerary_id === itineraryId ? { ...r, trailer_id: trailerId } : r,
      ),
    )
    toastIfNowAssigned(row, { trailer_id: trailerId })

    await syncFleetStatus(
      trailerId !== null ? { plate: null, trailerId } : null,
      previousTrailerId !== null && previousTrailerId !== trailerId
        ? { plate: null, trailerId: previousTrailerId }
        : null,
    )
    setSavingId(null)
    return true
  }

  // "Use Suggested Crew & Vehicles for All N Trips": for every trip of one
  // booking that has a time slot, fills an empty driver / helper / truck /
  // trailer with the top free suggestion (same ranking as the dropdowns),
  // one at a time so each pick counts as busy for the next trip -- and a
  // truck/trailer already on the booking ranks first, so one rig stays with
  // it when it's free. The database still refuses overlaps.
  // A driver's own truck follows him onto the trip (employees.assigned_plate_number),
  // when it's free then -- otherwise the truck is left as is and staff are told.
  async function followTruck(itineraryId: number, employeeId: number) {
    const row = rows.find((r) => r.itinerary_id === itineraryId)
    const driver = drivers.find((d) => d.employee_id === employeeId)
    const plate = driver?.truck
    if (!row || !driver || !plate || plate === row.plate_number) return
    const truck = trucks.find((t) => t.plate_number === plate)
    const inShop = truck?.current_status === 'Under Maintenance' || truck?.current_status === 'Out of Service'
    const clash = findClash(row, rows.filter((r) => r.plate_number === plate && r.itinerary_id !== itineraryId), now)
    if (inShop || clash) {
      const why = inShop ? truck!.current_status : `on trip #${clash!.itinerary_id}`
      showToast(`${driver.full_name}'s truck ${plate} is ${why} -- the truck was left as is.`, 'error')
      return
    }
    await handleTruckChange(itineraryId, row.plate_number, plate)
  }

  // Crew dropdowns: assign, then (drivers) bring his truck.
  async function assignCrew(itineraryId: number, crewRole: 'Driver' | 'Helper', previousEmployeeId: number | null, newEmployeeId: number | null) {
    const ok = await handleCrewChange(itineraryId, crewRole, previousEmployeeId, newEmployeeId)
    if (ok && crewRole === 'Driver' && newEmployeeId !== null) await followTruck(itineraryId, newEmployeeId)
    return ok
  }

  // Who would take the other trip in a swap: the top free driver (not the one moving).
  function swapHandOver(other: DispatchRow, movingId: number) {
    const others = drivers.filter((d) => d.employee_id !== movingId)
    return rankPeople(other, others, rows, leaveByEmployee, now, pay).ranked.find((p) => p.blockedBy === null) ?? null
  }

  // SwapDriverModal confirmed: the driver goes onto `row`; his other trip
  // either moves to right after it (his later trips follow) or goes to the
  // free driver who earned least this week. Made in an order the overlap
  // guards accept: the other trip is moved / handed over first.
  async function doSwap(choice: SwapChoice) {
    if (!swap) return
    const { row, employeeId } = swap
    const other = rows.find((r) => r.itinerary_id === swap.otherTripId)
    setSwap(null)
    if (!other || !row.trip_end_at || !other.trip_start_at || !other.trip_end_at) return
    if (choice === 'move') {
      const start = Date.parse(row.trip_end_at)
      const length = Date.parse(other.trip_end_at) - Date.parse(other.trip_start_at)
      const result = await retimeTrips({ fixed: new Map([[other.itinerary_id, { start, end: start + length }]]) }, Date.parse(other.trip_start_at))
      if (result.failedTripId !== null) {
        setError(result.warning)
        await loadDispatchBoard()
        return
      }
      for (const message of result.late) showToast(message, 'error')
    } else {
      const pick = swapHandOver(other, employeeId)
      if (!pick || !(await assignCrew(other.itinerary_id, 'Driver', employeeId, pick.employee_id))) {
        await loadDispatchBoard()
        return
      }
    }
    if (await handleCrewChange(row.itinerary_id, 'Driver', row.assigned_employee_id, employeeId)) {
      await followTruck(row.itinerary_id, employeeId)
    }
    await loadDispatchBoard()
  }

  // At-risk "Find a faster driver": the planner (lib/capacity.ts) looks for the
  // earliest any driver + truck + trailer could do this trip from now. If that
  // ends sooner, staff confirm, and the trip is handed over and re-timed.
  async function findFasterDriver(row: DispatchRow) {
    if (!row.trip_start_at || !row.trip_end_at) return
    const length = Date.parse(row.trip_end_at) - Date.parse(row.trip_start_at)
    const demand = {
      trips: [{ hours: length / 3_600_000, trailerType: row.required_trailer_type, cargoType: row.cargo_type }],
      requestedStart: Math.ceil(Date.now() / STEP_MS) * STEP_MS,
      deadlineEnd: row.delivery_by ? Date.parse(manilaTimestamp(row.delivery_by, 24 * 60)) - 1 : null,
    }
    const { inputs, error: loadError } = await loadCapacityInputs(demand, null)
    if (!inputs) {
      showToast(`Couldn't look for a driver (${loadError}).`, 'error')
      return
    }
    // This trip's own driver / truck / trailer don't block it.
    const world = { ...inputs.world, booked: inputs.world.booked.filter((t) => t.id !== row.itinerary_id) }
    const plan = planTrips(demand, world, { swaps: false })
    const best = plan.trips[0]
    if (!best || best.end >= Date.parse(row.trip_end_at)) {
      showToast(`Nobody can do trip #${row.itinerary_id} sooner.`)
      return
    }
    const name = (resourceId: string) => world.resources.find((r) => r.id === resourceId)?.label ?? resourceId
    const driverId = Number(best.driverId.slice(1))
    const plate = best.truckId.slice(1)
    const trailerId = Number(best.trailerId.slice(1))
    const ok = await confirmDialog({
      title: `Hand trip #${row.itinerary_id} to ${name(best.driverId)}?`,
      message: `${name(best.driverId)} (truck ${plate}${best.spareTruck ? ', spare' : ''}, trailer ${name(best.trailerId)}) can do it ${formatSlot(best.start, best.end)}${
        plan.hoursLate > 0 ? `, still ${plan.hoursLate} h after the delivery-by date` : ', on time'
      }. Now it is ${formatSlot(row.trip_start_at, row.trip_end_at)}.`,
      confirmLabel: 'Hand over',
    })
    if (!ok) return
    // Clear the old crew / vehicles, move the time, then put the new ones on.
    const id = row.itinerary_id
    const cleared =
      (row.assigned_employee_id === null || (await handleCrewChange(id, 'Driver', row.assigned_employee_id, null))) &&
      (row.plate_number === null || (await handleTruckChange(id, row.plate_number, null))) &&
      (row.trailer_id === null || row.trailer_id === trailerId || (await handleTrailerChange(id, row.trailer_id, null)))
    if (cleared) {
      const result = await retimeTrips({ fixed: new Map([[id, { start: best.start, end: best.end }]]) }, Math.min(best.start, Date.parse(row.trip_start_at)))
      if (result.failedTripId !== null) {
        setError(`${result.warning} Trip #${id} now has no driver / truck -- assign them again.`)
      } else {
        const assigned =
          (await handleCrewChange(id, 'Driver', null, driverId)) &&
          (await handleTruckChange(id, null, plate)) &&
          (row.trailer_id === trailerId || (await handleTrailerChange(id, null, trailerId)))
        if (assigned) showToast(`Trip #${id} handed to ${name(best.driverId)}.`)
      }
    }
    await loadDispatchBoard()
  }

  async function assignSuggestedCrew(groupRows: DispatchRow[], scope = 'this booking') {
    const ok = await confirmDialog({
      title: 'Use the suggested crew and vehicles?',
      message: `Every trip of ${scope} that has a time slot gets the top suggested free driver, helper, truck and trailer where one is missing. You can change any of them afterwards.`,
      confirmLabel: 'Assign suggestions',
    })
    if (!ok) return
    setBulkBookingId(groupRows[0]?.booking_id ?? null)
    let working = rows
    let assigned = 0
    for (const row of [...groupRows].sort((a, b) => Date.parse(a.trip_start_at ?? '') - Date.parse(b.trip_start_at ?? ''))) {
      if (!row.trip_start_at) continue
      for (const crewRole of ['Driver', 'Helper'] as const) {
        const current = working.find((r) => r.itinerary_id === row.itinerary_id) ?? row
        const currentId = crewRole === 'Driver' ? current.assigned_employee_id : current.assigned_helper_employee_id
        if (currentId !== null) continue
        const people = crewRole === 'Driver' ? drivers : helpers
        const pick = rankPeople(current, people, working, leaveByEmployee, now, pay).ranked.find((p) => p.blockedBy === null)
        if (!pick) continue
        if (!(await handleCrewChange(row.itinerary_id, crewRole, null, pick.employee_id))) {
          setBulkBookingId(null)
          return
        }
        assigned++
        working = working.map((r) =>
          r.itinerary_id !== row.itinerary_id
            ? r
            : crewRole === 'Driver'
              ? { ...r, assigned_employee_id: pick.employee_id, assigned_driver_name: pick.full_name }
              : { ...r, assigned_helper_employee_id: pick.employee_id, assigned_helper_name: pick.full_name },
        )
      }
      for (const kind of ['Truck', 'Trailer'] as const) {
        const current = working.find((r) => r.itinerary_id === row.itinerary_id) ?? row
        if (vehicleIdOf(kind, current) !== null) continue
        const candidates = kind === 'Truck' ? truckCandidates(trucks, vehicleService) : trailerCandidates(trailers, vehicleService)
        const free = rankFleet(kind, current, candidates, working, now).ranked.filter((v) => v.blockedBy === null)
        // Trucks: the driver's own one, else a spare (no driver has it), else any free one.
        const ownPlate = drivers.find((d) => d.employee_id === current.assigned_employee_id)?.truck
        const owned = new Set(drivers.flatMap((d) => (d.truck ? [`T:${d.truck}`] : [])))
        const pick =
          kind === 'Truck' ? (free.find((v) => v.id === `T:${ownPlate}`) ?? free.find((v) => !owned.has(v.id)) ?? free[0]) : free[0]
        if (!pick) continue
        const saved =
          kind === 'Truck'
            ? await handleTruckChange(row.itinerary_id, null, pick.id.slice(2))
            : await handleTrailerChange(row.itinerary_id, null, Number(pick.id.slice(2)))
        if (!saved) {
          setBulkBookingId(null)
          return
        }
        assigned++
        working = working.map((r) =>
          r.itinerary_id !== row.itinerary_id
            ? r
            : kind === 'Truck'
              ? { ...r, plate_number: pick.id.slice(2) }
              : { ...r, trailer_id: Number(pick.id.slice(2)) },
        )
      }
    }
    setBulkBookingId(null)
    showToast(assigned > 0 ? `Assigned ${assigned} ${assigned === 1 ? 'suggestion' : 'suggestions'}.` : 'Nothing free to suggest for these trips.')
  }

  // At-risk action: the truck / trailer on this booking's remaining
  // (Awaiting) trips can't go -- put the top free suggestion on each instead.
  // `ask` = false when "Fix all at-risk" already got the go-ahead.
  async function replaceVehicle(kind: 'Truck' | 'Trailer', row: DispatchRow, ask = true) {
    const oldId = vehicleIdOf(kind, row)
    const affected = rows
      .filter((r) => r.booking_id === row.booking_id && r.status === 'Awaiting' && vehicleIdOf(kind, r) === oldId)
      .sort((a, b) => Date.parse(a.trip_start_at ?? '') - Date.parse(b.trip_start_at ?? ''))
    const ok =
      !ask ||
      (await confirmDialog({
        title: `Replace the ${kind.toLowerCase()}?`,
        message: `Trips ${affected.map((r) => `#${r.itinerary_id}`).join(', ')} get the top suggested free ${kind.toLowerCase()} instead. You can change them afterwards.`,
        confirmLabel: `Replace ${kind.toLowerCase()}`,
      }))
    if (!ok) return
    const candidates = (kind === 'Truck' ? truckCandidates(trucks, vehicleService) : trailerCandidates(trailers, vehicleService)).filter(
      (v) => v.id !== oldId,
    )
    let working = rows
    let replaced = 0
    for (const trip of affected) {
      const current = working.find((r) => r.itinerary_id === trip.itinerary_id) ?? trip
      const pick = rankFleet(kind, current, candidates, working, now).ranked.find((v) => v.blockedBy === null)
      if (!pick) continue
      const saved =
        kind === 'Truck'
          ? await handleTruckChange(trip.itinerary_id, trip.plate_number, pick.id.slice(2))
          : await handleTrailerChange(trip.itinerary_id, trip.trailer_id, Number(pick.id.slice(2)))
      if (!saved) return
      replaced++
      working = working.map((r) =>
        r.itinerary_id !== trip.itinerary_id
          ? r
          : kind === 'Truck'
            ? { ...r, plate_number: pick.id.slice(2) }
            : { ...r, trailer_id: Number(pick.id.slice(2)) },
      )
    }
    showToast(
      replaced === affected.length
        ? `Replaced the ${kind.toLowerCase()} on ${replaced} ${replaced === 1 ? 'trip' : 'trips'}.`
        : `Replaced it on ${replaced} of ${affected.length} trips -- nothing free for the rest.`,
    )
  }

  // Board-wide "Fill all unassigned": the per-booking suggestion run, over
  // every Awaiting trip that has a slot and still lacks crew / truck / trailer.
  async function assignAllUnassigned() {
    await assignSuggestedCrew(
      rows.filter((r) => r.status === 'Awaiting' && r.trip_start_at && !isFullyAssigned(r)),
      'every booking',
    )
  }

  // "Balance driver pay": lib/rebalance.ts proposes moving Awaiting trips from
  // the best-paid driver of a week to the least-paid one (only to drivers who
  // are free then -- same overlap / leave / licence rules as the dropdowns).
  // Staff see the whole list and confirm; nothing moves before that.
  // ponytail: single-trip moves only, never touches started trips or booking
  // deadlines -- late bookings are "Find a faster driver"'s job.
  async function rebalanceDrivers() {
    if (!pay) {
      showToast('Driver commission settings are missing -- set them on Settings first.', 'error')
      return
    }
    const trips = rows
      .filter((r) => r.status !== 'Cancelled' && r.trip_start_at)
      .map((r) => ({
        id: r.itinerary_id,
        driverId: r.assigned_employee_id,
        earn: (pay.driverCommissionRate / 100) * (r.trip_rate ?? 0) + pay.driverPerTripFee,
        week: manilaWeek(Date.parse(r.trip_start_at!)).from,
        movable: r.status === 'Awaiting' && r.assigned_employee_id !== null,
      }))
    const moves = planRebalance(trips, drivers.map((d) => d.employee_id), (tripId, driverId, owners) => {
      const working = rows.map((r) => (owners.has(r.itinerary_id) ? { ...r, assigned_employee_id: owners.get(r.itinerary_id) ?? null } : r))
      const row = working.find((r) => r.itinerary_id === tripId)!
      const person = rankPeople(row, drivers, working, leaveByEmployee, now, pay).ranked.find((p) => p.employee_id === driverId)
      return !!person && person.blockedBy === null
    })
    if (moves.length === 0) {
      showToast('Driver pay is already as even as the free slots allow.')
      return
    }
    const name = (id: number) => drivers.find((d) => d.employee_id === id)?.full_name ?? `#${id}`
    const ok = await confirmDialog({
      title: `Move ${moves.length} ${moves.length === 1 ? 'trip' : 'trips'} to even out driver pay?`,
      message: moves.map((m) => `Trip #${m.tripId}: ${name(m.from)} → ${name(m.to)} (${formatMoney(m.earn)})`).join('; '),
      confirmLabel: 'Move trips',
    })
    if (!ok) return
    let done = 0
    for (const m of moves) {
      if (!(await assignCrew(m.tripId, 'Driver', m.from, m.to))) break
      done++
    }
    await loadDispatchBoard()
    showToast(done === moves.length ? `Moved ${done} ${done === 1 ? 'trip' : 'trips'}.` : `Moved ${done} of ${moves.length} trips -- the rest were refused.`)
  }

  // Day view (the canvas board): the trips on one day -- by slot start,
  // Manila time -- plus, on today, every trip still on the road whenever it
  // started (a Dispatched trip only once its slot has started: one dispatched
  // early for a later day stays on its own day). 'all' = every trip not
  // delivered yet, any day.
  const today = toManilaDate(new Date(now))
  const isAllDays = day === 'all'
  const shownDay = isAllDays ? today : day
  const isWeek = view === 'week' && !isAllDays
  const weekStart = shiftDay(shownDay, -new Date(`${shownDay}T12:00:00Z`).getUTCDay())
  const weekEnd = shiftDay(weekStart, 6)
  const weekHasToday = today >= weekStart && today <= weekEnd
  const onDay = (r: DispatchRow) =>
    isAllDays
      ? r.status !== 'Delivered'
      : isWeek
        ? (tripDay(r) >= weekStart && tripDay(r) <= weekEnd) || (weekHasToday && isOutNow(r, now))
        : tripDay(r) === day || (day === today && isOutNow(r, now))
  const startMs = (r: DispatchRow) => Date.parse(r.trip_start_at ?? `${r.trip_date_from}T00:00:00+08:00`)
  const dayRows = rows.filter(onDay).sort((a, b) => startMs(a) - startMs(b) || a.itinerary_id - b.itinerary_id)
  // Planned trips that may not happen as assigned (leave, shop, late trip,
  // no truck / trailer free for the slot...), with a fix where there is one.
  const fleet = { Truck: truckCandidates(trucks, vehicleService), Trailer: trailerCandidates(trailers, vehicleService) }
  const atRiskTrips = rows
    .map((row) => {
      const reasons = atRiskReasons(row, rows, leaveByEmployee, drivers, trucks, trailers, now)
      const actions: AtRiskAction[] = []
      // A driver / helper on leave (or marked absent today): one click puts the
      // top free replacement on this trip.
      if (row.status === 'Awaiting') {
        for (const crewRole of ['Driver', 'Helper'] as const) {
          const currentId = crewRole === 'Driver' ? row.assigned_employee_id : row.assigned_helper_employee_id
          if (currentId === null) continue
          const onLeave = (leaveByEmployee.get(currentId) ?? []).some((l) =>
            rangesOverlap(row.trip_date_from, row.trip_date_to, l.start_date, l.end_date),
          )
          if (!onLeave) continue
          const pick = rankPeople(row, crewRole === 'Driver' ? drivers : helpers, rows, leaveByEmployee, now, pay).ranked.find(
            (p) => p.blockedBy === null,
          )
          if (pick) {
            actions.push({
              label: `Use ${pick.full_name} as ${crewRole.toLowerCase()}`,
              onClick: () => assignCrew(row.itinerary_id, crewRole, currentId, pick.employee_id),
              auto: { key: `crew:${row.itinerary_id}:${crewRole}`, run: () => assignCrew(row.itinerary_id, crewRole, currentId, pick.employee_id) },
            })
          }
        }
      }
      if (row.status === 'Awaiting' && row.trip_start_at && row.trip_end_at) {
        const short: ('Truck' | 'Trailer')[] = []
        const freeAt: (number | null)[] = []
        for (const kind of ['Truck', 'Trailer'] as const) {
          const { ranked, tripsOf } = rankFleet(kind, row, fleet[kind], rows, now)
          const currentId = vehicleIdOf(kind, row)
          if (currentId === null) {
            // Nothing picked and nothing of the right kind free for this slot.
            if (!ranked.some((v) => v.blockedBy === null)) {
              short.push(kind)
              // Say why each one is out ("MAK 1452: open work order"), or that we have none.
              const why = ranked.map((v) => `${v.label}: ${v.blockedBy}`).join(', ')
              reasons.push(
                `No ${kind === 'Truck' ? 'truck' : `${row.required_trailer_type ? `${row.required_trailer_type} ` : ''}trailer`} free for this time (${why || 'none in the fleet'})`,
              )
            }
          } else {
            // The one picked can't go because of the shop: in it now, or a work
            // order scheduled on a trip day (status alone is reported above).
            const current = ranked.find((v) => v.id === currentId)
            const shop = current?.blockedBy?.includes('work order') ? current.blockedBy : null
            if (current && shop) reasons.push(`${kind} ${current.label}: ${shop}`)
            if (current && (shop || current.current_status === 'Under Maintenance' || current.current_status === 'Out of Service')) {
              actions.push({
                label: `Replace ${kind.toLowerCase()} on remaining trips`,
                onClick: () => replaceVehicle(kind, row),
                // One fix per booking + vehicle, however many of its trips are at risk.
                auto: { key: `veh:${kind}:${row.booking_id}:${currentId}`, run: () => replaceVehicle(kind, row, false) },
              })
            }
          }
          if (short.includes(kind)) freeAt.push(earliestFreeStart(row, fleet[kind], tripsOf, now, Date.parse(row.trip_start_at)))
        }
        if (short.length > 0) {
          // The slot that works for every missing kind: the latest of their
          // earliest free times. ponytail: each kind is searched on its own,
          // so the truck could be busy again at the trailer's time; Edit time
          // re-checks on save.
          if (freeAt.every((t) => t !== null)) {
            const start = Math.max(...(freeAt as number[]))
            const length = Date.parse(row.trip_end_at) - Date.parse(row.trip_start_at)
            const moved = { ...row, trip_start_at: new Date(start).toISOString(), trip_end_at: new Date(start + length).toISOString() }
            actions.push({
              label: `Move to ${formatSlot(moved.trip_start_at, moved.trip_end_at)}`,
              // Opens Edit time already filled in; staff check and save.
              onClick: () => setEditTimeRow(moved),
            })
          }
        }
      }
      // The booking finishes after its delivery-by date: look for a driver who can do it sooner.
      if (row.status === 'Awaiting' && reasons.some((r) => r.includes('will be late by'))) {
        actions.push({ label: 'Find a faster driver', onClick: () => findFasterDriver(row) })
      }
      return { row, reasons, actions }
    })
    .filter((t) => t.reasons.length > 0)

  // "Fix all at-risk": runs every fix that picks a replacement by itself
  // (driver / helper on leave, truck / trailer in the shop) after one confirm.
  // Moving a time or finding a faster driver stay manual.
  // ponytail: each fix was worked out at render time, so two fixes that pick
  // the same replacement for overlapping trips: the database refuses the second.
  const autoFixes = new Map<string, { label: string; run: () => Promise<unknown> }>()
  for (const t of atRiskTrips) for (const a of t.actions) if (a.auto && !autoFixes.has(a.auto.key)) autoFixes.set(a.auto.key, { label: a.label, run: a.auto.run })
  async function autoFixAtRisk() {
    const ok = await confirmDialog({
      title: `Fix ${autoFixes.size} at-risk ${autoFixes.size === 1 ? 'problem' : 'problems'}?`,
      message: `Each gets the top suggested free replacement: ${[...autoFixes.values()].map((f) => f.label).join('; ')}.`,
      confirmLabel: 'Fix all',
    })
    if (!ok) return
    for (const fix of autoFixes.values()) await fix.run()
    await loadDispatchBoard()
  }

  const ctx: BoardContext = {
    allRows: rows,
    leaveByEmployee,
    drivers,
    helpers,
    trucks,
    trailers,
    truckCandidates: truckCandidates(trucks, vehicleService),
    trailerCandidates: trailerCandidates(trailers, vehicleService),
    canEditStatus,
    canFreelyEditStatus,
    savingId,
    now,
    pendingCorrectionIds: new Set(myRequests.filter((r) => r.status === 'Pending').map((r) => r.itinerary_id)),
    onStatusChange: handleStatusChange,
    onRequestCorrection: handleRequestCorrection,
    onCrewChange: assignCrew,
    onTruckChange: handleTruckChange,
    onTrailerChange: handleTrailerChange,
    onViewLogs: setLogsItineraryId,
    onEditTime: setEditTimeRow,
    onBreakdown: setBreakdownRow,
    pay,
    onSwap: (row, employeeId, otherTripId) => setSwap({ row, employeeId, otherTripId }),
  }

  const atRiskById = new Map<number, AtRisk>(atRiskTrips.map((t) => [t.row.itinerary_id, { reasons: t.reasons, actions: t.actions }]))

  // Filters under the tiles: Status (plus Needs assignment / At risk), Driver, Booking ID.
  const bookingQuery = bookingFilter.trim().replace(/^#/, '')
  const needsAssignment = (r: DispatchRow) => r.status === 'Awaiting' && !isFullyAssigned(r)
  const filteredRows = dayRows
    // Trips that still need assignment first (sort is stable: the rest keep their order).
    .toSorted((a, b) => Number(needsAssignment(b)) - Number(needsAssignment(a)))
    .filter((r) => {
    if (statusFilter === 'needs' && (r.status !== 'Awaiting' || isFullyAssigned(r))) return false
    if (statusFilter === 'atrisk' && !atRiskById.has(r.itinerary_id)) return false
    if (!['all', 'needs', 'atrisk'].includes(statusFilter) && r.status !== statusFilter) return false
    if (driverFilter === 'none' && r.assigned_employee_id !== null) return false
    if (!['all', 'none'].includes(driverFilter) && r.assigned_employee_id !== Number(driverFilter)) return false
    // Booking ID box also finds a trip number.
    if (bookingQuery && String(r.booking_id) !== bookingQuery && String(r.itinerary_id) !== bookingQuery) return false
    return true
  })
  const pagedTrips = usePaged(filteredRows, `${day}|${view}|${statusFilter}|${driverFilter}|${bookingFilter}`)
  const anyFilter = statusFilter !== 'all' || driverFilter !== 'all' || bookingFilter !== ''
  const deliveredCount = dayRows.filter((r) => r.status === 'Delivered').length
  // Unassigned trips on other days -- the day view would hide them.
  const needsElsewhere = isAllDays ? 0 : rows.filter((r) => r.status === 'Awaiting' && !isFullyAssigned(r) && !onDay(r)).length
  const dayWord = isAllDays ? 'not delivered yet' : isWeek ? 'this week' : day === today ? 'today' : 'this day'
  const panelRow = panelRowId !== null ? (rows.find((r) => r.itinerary_id === panelRowId) ?? null) : null
  const statusRow = statusRowId !== null ? (rows.find((r) => r.itinerary_id === statusRowId) ?? null) : null

  // What the Update Status pop-up offers: Admin any other status, Dispatcher
  // the very next step only.
  function statusChoices(row: DispatchRow): string[] {
    if (!canEditStatus) return []
    if (canFreelyEditStatus) return STATUS_FLOW.filter((s) => s !== row.status)
    const next = STATUS_FLOW[STATUS_FLOW.indexOf(row.status) + 1]
    return next ? [next] : []
  }

  // Why an Awaiting trip can't start yet, or null.
  function blockedReasonFor(row: DispatchRow): string | null {
    if (row.status !== 'Awaiting') return null
    if (!isFullyAssigned(row)) return `It still needs a ${missingForDispatch(row)} before it can leave Awaiting. Add them under View.`
    if (!tripsMayStart(row.downpayment)) {
      return (
        `The booking's downpayment isn't paid yet${row.downpayment ? ` (${formatMoney(row.downpayment.missing)} to go)` : ''}. ` +
        `No trip can start until it is paid${canFreelyEditStatus ? ' or waived' : ''}.`
      )
    }
    const busy = crewOnRoadReason(row, rows)
    return busy ? `Can't start yet: ${busy}.` : null
  }

  const FILTER_LABEL = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
  const FILTER_CONTROL =
    'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'
  const squareButton =
    'flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50'

  return (
    <div>
      <PageHeader
        title="Dispatch Board"
        subtitle="Every trip scheduled for the day and where it is now."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Day / Week: outlined, the chosen one filled. */}
            <div className="flex">
              {(['day', 'week'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v && !isAllDays}
                  onClick={() => {
                    setView(v)
                    if (isAllDays) setDay(today)
                  }}
                  className={`h-11 border px-4 text-sm font-semibold first:rounded-l-[2px] last:-ml-px last:rounded-r-[2px] ${
                    view === v && !isAllDays ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink hover:bg-slate-50'
                  }`}
                >
                  {v === 'day' ? 'Day' : 'Week'}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={isWeek ? 'Previous week' : 'Previous day'}
              onClick={() => setDay(shiftDay(shownDay, isWeek ? -7 : -1))}
              className={squareButton}
            >
              <Icon name="left" size={18} />
            </button>
            {/* The date: click it to pick any day. */}
            <button
              type="button"
              onClick={() => {
                // showPicker() opens the browser's calendar (older browsers: just focus it).
                const input = dateInputRef.current
                if (!input) return
                try {
                  input.showPicker()
                } catch {
                  input.focus()
                }
              }}
              className="flex h-11 items-center gap-2 border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-slate-50"
            >
              <Icon name="calendar" className="text-primary" />
              {isAllDays
                ? 'All trips not delivered yet'
                : isWeek
                  ? `${weekHasToday ? 'This week · ' : ''}${formatDate(weekStart)} – ${formatDate(weekEnd)}`
                  : dayLabel(day, today)}
            </button>
            <input
              ref={dateInputRef}
              type="date"
              aria-label="Pick a day"
              value={shownDay}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="sr-only"
            />
            <button
              type="button"
              aria-label={isWeek ? 'Next week' : 'Next day'}
              onClick={() => setDay(shiftDay(shownDay, isWeek ? 7 : 1))}
              className={squareButton}
            >
              <Icon name="right" size={18} />
            </button>
            {(isWeek ? !weekHasToday : day !== today) && (
              <button type="button" onClick={() => setDay(today)} className="btn-secondary px-4 text-sm font-medium">
                Today
              </button>
            )}
            {canEditStatus && (
              <button type="button" onClick={() => setShowAbsent(true)} className="btn-secondary ml-2 px-4 text-sm font-medium">
                Mark Absent Today
              </button>
            )}
            {/* Drivers move trips from their phones -- reload to see it. */}
            <button
              type="button"
              onClick={() => {
                loadDispatchBoard()
                if (isDispatcher(role) && employeeId) loadMyRequests(employeeId)
              }}
              disabled={loading}
              className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium"
            >
              <Icon name="refresh" />
              Refresh
            </button>
          </div>
        }
      />

      {/* Trips by status for the day shown -- click a tile to list only those. */}
      <section aria-label="Trips by status" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:items-center">
        {FLOW_TILES.map((tile, i) => {
          const pressed = statusFilter === tile.status
          return (
            <Fragment key={tile.status}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => setStatusFilter(pressed ? 'all' : tile.status)}
                className={`flex min-w-0 flex-1 items-center gap-3 border-2 bg-white px-4 py-3 text-left hover:bg-slate-50 ${
                  pressed ? 'border-primary' : 'border-line'
                }`}
              >
                <span className={`inline-flex items-center rounded-[2px] p-2 ${tile.chip}`}>
                  <Icon name={tile.icon} size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-secondary">{tile.label}</span>
                  <span className="block text-[28px] leading-9 font-bold text-ink tabular-nums">
                    {loading ? '–' : dayRows.filter((r) => r.status === tile.status).length}
                  </span>
                </span>
              </button>
              {i < FLOW_TILES.length - 1 && <Icon name="arrow" size={18} className="hidden text-line-control lg:block" />}
            </Fragment>
          )
        })}
      </section>

      {error && <p className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {drivers.some((d) => !d.truck) && (
        <p className="mb-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {drivers.filter((d) => !d.truck).map((d) => d.full_name).join(', ')} {drivers.filter((d) => !d.truck).length === 1 ? 'has' : 'have'} no truck
          assigned -- set it on the Employees page (each driver drives his own truck).
        </p>
      )}

      {needsElsewhere > 0 && (
        <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border border-amber-600 bg-amber-100 px-4 py-2.5 text-sm text-amber-900">
          <Icon name="warning" />
          <span>
            <strong>
              {needsElsewhere} {needsElsewhere === 1 ? 'trip' : 'trips'}
            </strong>{' '}
            on other days still {needsElsewhere === 1 ? 'needs' : 'need'} a driver, truck, trailer or time slot.
          </span>
          <button
            type="button"
            onClick={() => {
              setDay('all')
              setStatusFilter('needs')
            }}
            className="font-semibold underline hover:no-underline"
          >
            Show them
          </button>
        </p>
      )}

      {atRiskTrips.length > 0 && (
        <div className="mb-4 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="flex items-center gap-2 font-semibold">
            <Icon name="warning" />
            At-risk trips ({atRiskTrips.length})
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {atRiskTrips.slice(0, 5).map((t) => (
              <li key={t.row.itinerary_id} className="flex flex-wrap items-baseline gap-x-3">
                <span>
                  Trip #{t.row.itinerary_id} · Booking #{t.row.booking_id} — {t.reasons.join('; ')}
                </span>
                <button type="button" onClick={() => setPanelRowId(t.row.itinerary_id)} className="font-semibold underline hover:no-underline">
                  View
                </button>
                {canEditStatus &&
                  t.actions.map((a) => (
                    <button key={a.label} type="button" onClick={a.onClick} className="font-semibold underline hover:no-underline">
                      {a.label}
                    </button>
                  ))}
              </li>
            ))}
          </ul>
          {atRiskTrips.length > 5 && (
            <button
              type="button"
              onClick={() => {
                setDay('all')
                setStatusFilter('atrisk')
              }}
              className="mt-1 text-xs font-semibold underline"
            >
              Show all {atRiskTrips.length}
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className={FILTER_LABEL}>
              Status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${FILTER_CONTROL} w-48`}>
                <option value="all">All statuses</option>
                <option value="needs">Needs assignment</option>
                <option value="atrisk">At risk</option>
                {FLOW_TILES.map((t) => (
                  <option key={t.status} value={t.status}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={FILTER_LABEL}>
              Driver
              <select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} className={`${FILTER_CONTROL} w-52`}>
                <option value="all">All drivers</option>
                <option value="none">Unassigned</option>
                {drivers.map((d) => (
                  <option key={d.employee_id} value={d.employee_id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className={FILTER_LABEL}>
              Booking ID
              <input
                type="search"
                value={bookingFilter}
                onChange={(e) => setBookingFilter(e.target.value)}
                placeholder="e.g. 48"
                className={`${FILTER_CONTROL} w-40 font-normal placeholder:text-ink-muted`}
              />
            </label>
            {canEditStatus && (
              <div className="ml-auto flex flex-wrap gap-2">
                {rows.some((r) => needsAssignment(r) && r.trip_start_at) && (
                  <button type="button" onClick={assignAllUnassigned} disabled={bulkBookingId !== null} className="btn-secondary px-4 text-sm font-medium">
                    Fill all unassigned
                  </button>
                )}
                {autoFixes.size > 0 && (
                  <button type="button" onClick={autoFixAtRisk} className="btn-secondary px-4 text-sm font-medium">
                    Fix at-risk ({autoFixes.size})
                  </button>
                )}
                <button type="button" onClick={rebalanceDrivers} className="btn-secondary px-4 text-sm font-medium">
                  Balance driver pay
                </button>
              </div>
            )}
            {anyFilter && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all')
                  setDriverFilter('all')
                  setBookingFilter('')
                }}
                className="text-sm font-semibold text-primary underline hover:no-underline"
              >
                Clear filters
              </button>
            )}
          </div>

          <section aria-label="Trips" className="card flex min-h-[calc(100dvh-24rem)] flex-col">
            <div className="flex flex-1 flex-col overflow-x-auto">
              {loading ? (
                <p className="p-6 text-ink-muted">Loading dispatch board...</p>
              ) : filteredRows.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-8">
                  <div className="flex flex-col items-center gap-3 border border-dashed border-line px-16 py-10 text-center">
                    <Icon name="truck" size={28} className="text-ink-secondary" />
                    <p className="text-[15px] font-medium text-ink">
                      {anyFilter
                        ? 'No trips match these filters.'
                        : isAllDays
                          ? 'Every trip has been delivered.'
                          : `No trips ${isWeek ? 'this week' : day === today ? 'today' : 'on this day'}.`}
                    </p>
                    {!isAllDays && !anyFilter && rows.some((r) => r.status !== 'Delivered') && (
                      <button type="button" onClick={() => setDay('all')} className="btn-primary px-5 text-sm">
                        Show All Trips Not Delivered Yet
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <table className="w-full min-w-[980px] table-fixed text-left text-sm text-ink-metric">
                  <colgroup>
                    {['120px', '170px', '', '150px', '120px', '130px', '236px'].map((width, i) => (
                      <col key={i} style={width ? { width } : undefined} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={TH}>Trip</th>
                      <th className={TH}>Time Slot</th>
                      <th className={TH}>Pickup → Delivery</th>
                      <th className={TH}>Driver</th>
                      <th className={TH}>Truck / Trailer</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTrips.rows.map((row) => {
                      const trailerPlate =
                        row.trailer_id === null ? null : (trailers.find((t) => t.trailer_id === row.trailer_id)?.plate_number ?? `#${row.trailer_id}`)
                      const canUpdate = canEditStatus && (row.status !== 'Delivered' || canFreelyEditStatus)
                      return (
                        <tr key={row.itinerary_id} className="h-[60px] border-b border-slate-200 hover:bg-slate-50">
                          <td className={TD}>
                            <span className="block font-bold text-ink">Trip #{row.itinerary_id}</span>
                            <Link
                              to={`/dashboard/bookings?booking=${row.booking_id}&trip=${row.itinerary_id}`}
                              className="text-[13px] leading-[18px] font-medium text-primary hover:underline"
                            >
                              Booking #{row.booking_id}
                            </Link>
                          </td>
                          <td className={TD}>
                            <SlotCell row={row} now={now} showDate={isAllDays || isWeek || tripDay(row) !== day} />
                          </td>
                          <td className={TD}>
                            <span className="block truncate" title={row.pickup_location}>
                              {row.pickup_location}
                            </span>
                            <span className="flex items-center gap-1.5 text-ink-muted">
                              <Icon name="arrow" size={14} />
                              <span className="truncate" title={row.delivery_location}>
                                {row.delivery_location}
                              </span>
                            </span>
                          </td>
                          <td className={TD}>
                            {row.assigned_driver_name ? (
                              <span className="block truncate font-semibold">{row.assigned_driver_name}</span>
                            ) : (
                              <span className="block font-semibold text-orange-700">Unassigned</span>
                            )}
                            {row.assigned_helper_name && <span className={`${SUB} truncate`}>+ {row.assigned_helper_name}</span>}
                          </td>
                          <td className={TD}>
                            {row.plate_number ? (
                              <span className="block font-semibold">{row.plate_number}</span>
                            ) : (
                              <span className="block font-semibold text-orange-700">No truck</span>
                            )}
                            <span className={trailerPlate ? SUB : 'block text-[13px] leading-[18px] font-semibold text-orange-700'}>
                              {trailerPlate ?? 'No trailer'}
                            </span>
                          </td>
                          <td className={TD}>
                            <TripStatusCell
                              row={row}
                              risk={atRiskById.get(row.itinerary_id)}
                              pendingCorrection={ctx.pendingCorrectionIds.has(row.itinerary_id)}
                            />
                          </td>
                          <td className={TD}>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setStatusRowId(row.itinerary_id)}
                                disabled={!canUpdate || savingId === row.itinerary_id}
                                aria-describedby={row.status === 'Delivered' && !canFreelyEditStatus ? 'final-note' : undefined}
                                className="btn-secondary w-[140px] px-0 text-sm font-medium"
                              >
                                Update Status
                              </button>
                              <button
                                type="button"
                                onClick={() => setPanelRowId(row.itinerary_id)}
                                className="btn-secondary w-20 px-0 text-sm font-medium"
                              >
                                View
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex min-h-[60px] flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
              <span className="flex items-center gap-2">
                {dayRows.length > 0 && deliveredCount === dayRows.length && <Icon name="check" className="text-green-800" />}
                {dayRows.length} {dayRows.length === 1 ? 'trip' : 'trips'} {dayWord}
                {!isAllDays && ` · ${deliveredCount} of ${dayRows.length} delivered`}
                {anyFilter && ` · ${filteredRows.length} shown`}
              </span>
              {!canFreelyEditStatus && deliveredCount > 0 && (
                <span id="final-note" className="ml-auto text-ink-muted">
                  Delivered is the last status, so it can't be updated.
                </span>
              )}
              {pagedTrips.pager.pageCount > 1 && (
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => pagedTrips.pager.onChange(pagedTrips.pager.page - 1)}
                    disabled={pagedTrips.pager.page === 0}
                    className="btn-secondary px-3.5 text-sm font-medium"
                  >
                    ‹ Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => pagedTrips.pager.onChange(pagedTrips.pager.page + 1)}
                    disabled={pagedTrips.pager.page >= pagedTrips.pager.pageCount - 1}
                    className="btn-secondary px-3.5 text-sm font-medium"
                  >
                    Next ›
                  </button>
                </span>
              )}
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Dispatcher: their own requests to move a trip back a status,
              beside the board (the canvas's Dispatcher board). */}
          {isDispatcher(role) && (
            <aside aria-labelledby="cr-h" className="card flex flex-col px-5 py-4">
              <h2 id="cr-h" className="text-base font-semibold text-ink">
                My Correction Requests
              </h2>
              <p className="mb-1 border-b border-line pb-2 text-[13px] text-ink-muted">Requests to move a trip back a status. Admin decides.</p>
              {myRequests.length === 0 ? (
                <p className="py-3 text-sm text-ink-muted">None yet. Use Request Correction in a trip's View.</p>
              ) : (
                <ul className="text-sm">
                  {myRequests.map((request) => (
                    <li key={request.request_id} className="flex flex-col gap-1 border-b border-slate-200 py-3 last:border-0">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-ink">
                          Trip #{request.itinerary_id} · {STATUS_LABELS[request.current_status] ?? request.current_status} →{' '}
                          {STATUS_LABELS[request.requested_status] ?? request.requested_status}
                        </span>
                        <StatusBadge status={request.status} icon />
                      </span>
                      <span className="text-[13px] text-ink-muted">
                        Sent {formatDate(request.created_at)}
                        {request.status === 'Pending' ? ' · waiting for Admin' : ''}
                      </span>
                      <span className="text-[13px] text-ink-secondary">Reason: {request.reason}</span>
                      {request.resolution_note && <span className="text-[13px] text-ink-secondary">Admin note: {request.resolution_note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
          <ResourcesPanel day={shownDay} isToday={shownDay === today} dayRows={isAllDays || isWeek ? rows.filter((r) => tripDay(r) === shownDay) : dayRows} ctx={ctx} />
        </div>
      </div>

      {panelRow && (
        <TripPanel
          row={panelRow}
          ctx={ctx}
          bookingTrips={rows.filter((r) => r.booking_id === panelRow.booking_id)}
          risk={atRiskById.get(panelRow.itinerary_id)}
          pendingCorrection={ctx.pendingCorrectionIds.has(panelRow.itinerary_id)}
          bulkBusy={bulkBookingId === panelRow.booking_id}
          onClose={() => setPanelRowId(null)}
          onUpdateStatus={(r) => setStatusRowId(r.itinerary_id)}
          onAssignSuggested={assignSuggestedCrew}
        />
      )}

      {statusRow && (
        <UpdateStatusModal
          itineraryId={statusRow.itinerary_id}
          subtitle={[`Booking #${statusRow.booking_id}`, statusRow.assigned_driver_name ?? 'No driver', statusRow.plate_number ?? 'No truck'].join(' · ')}
          flow={STATUS_FLOW}
          labels={STATUS_LABELS}
          currentStatus={statusRow.status}
          choices={statusChoices(statusRow)}
          blockedReason={blockedReasonFor(statusRow)}
          correction={
            canEditStatus && !canFreelyEditStatus
              ? {
                  pending: ctx.pendingCorrectionIds.has(statusRow.itinerary_id),
                  onRequest: () => {
                    setStatusRowId(null)
                    handleRequestCorrection(statusRow)
                  },
                }
              : null
          }
          onClose={() => setStatusRowId(null)}
          onConfirm={(newStatus, atMs) => {
            const row = statusRow
            setStatusRowId(null)
            if (newStatus === 'Delivered') setDeliveryRow(row)
            else if (atMs !== undefined) applyStatusChange(row.itinerary_id, row.status, newStatus, atMs)
            else handleStatusChange(row.itinerary_id, row.status, newStatus)
          }}
        />
      )}
      {relogRequestRow && employeeId && (
        <RequestStatusRelogModal
          targetType="itinerary"
          itineraryId={relogRequestRow.itinerary_id}
          currentStatus={relogRequestRow.status}
          // Corrections only ever go backward -- moving forward is the
          // dropdown's job.
          statusOptions={STATUS_FLOW.slice(0, STATUS_FLOW.indexOf(relogRequestRow.status))}
          statusLabels={STATUS_LABELS}
          employeeId={employeeId}
          onClose={() => setRelogRequestRow(null)}
          onRequested={() => {
            setRelogRequestRow(null)
            loadMyRequests(employeeId)
          }}
        />
      )}

      {showAbsent && (
        <MarkAbsentModal
          people={[
            ...drivers.map((p) => ({ employee_id: p.employee_id, full_name: p.full_name, role: 'Driver' as const })),
            ...helpers.map((p) => ({ employee_id: p.employee_id, full_name: p.full_name, role: 'Helper' as const })),
          ]}
          onClose={() => setShowAbsent(false)}
          onDone={(name) => {
            setShowAbsent(false)
            showToast(`${name} marked absent today.`)
            loadDispatchBoard()
          }}
        />
      )}

      {swap &&
        (() => {
          const other = rows.find((r) => r.itinerary_id === swap.otherTripId)
          const driver = drivers.find((d) => d.employee_id === swap.employeeId)
          if (!other || !driver || !swap.row.trip_end_at || !other.trip_start_at || !other.trip_end_at) return null
          const start = Date.parse(swap.row.trip_end_at)
          const end = start + Date.parse(other.trip_end_at) - Date.parse(other.trip_start_at)
          const lateHours = other.delivery_by ? hoursLate(end, Date.parse(manilaTimestamp(other.delivery_by, 24 * 60)) - 1) : 0
          return (
            <SwapDriverModal
              tripId={swap.row.itinerary_id}
              driverName={driver.full_name}
              otherTripId={other.itinerary_id}
              otherSlot={formatSlot(other.trip_start_at, other.trip_end_at)}
              movedSlot={formatSlot(start, end)}
              moveLateHours={lateHours}
              handOverName={swapHandOver(other, driver.employee_id)?.full_name ?? null}
              onCancel={() => setSwap(null)}
              onConfirm={doSwap}
            />
          )
        })()}

      {breakdownRow && (
        (() => {
          const current = rows.find((r) => r.itinerary_id === breakdownRow.itinerary_id) ?? breakdownRow
          // Free vehicles for this trip's slot, best first, without the broken one.
          const freeOptions = (kind: 'Truck' | 'Trailer') =>
            rankFleet(kind, current, fleet[kind].filter((v) => v.id !== vehicleIdOf(kind, current)), rows, now)
              .ranked.filter((v) => v.blockedBy === null)
              .map((v) => ({ id: v.id.slice(2), label: v.label }))
          return (
            <BreakdownModal
              trip={{
                itinerary_id: current.itinerary_id,
                plate_number: current.plate_number,
                trailer_id: current.trailer_id,
                trailer_label: trailers.find((t) => t.trailer_id === current.trailer_id)?.plate_number ?? (current.trailer_id !== null ? `#${current.trailer_id}` : null),
                assigned_employee_id: current.assigned_employee_id,
              }}
              free={{ Truck: freeOptions('Truck'), Trailer: freeOptions('Trailer') }}
              onSwap={(kind, newId) =>
                kind === 'Truck'
                  ? handleTruckChange(current.itinerary_id, current.plate_number, newId)
                  : handleTrailerChange(current.itinerary_id, current.trailer_id, Number(newId))
              }
              onClose={() => setBreakdownRow(null)}
              onDone={(message) => {
                setBreakdownRow(null)
                showToast(message)
                loadDispatchBoard()
              }}
            />
          )
        })()
      )}

      {deliveryRow && (
        <MarkDeliveredModal
          itineraryId={deliveryRow.itinerary_id}
          currentStatus={deliveryRow.status}
          subtitle={`Booking #${deliveryRow.booking_id} · ${deliveryRow.pickup_location} → ${deliveryRow.delivery_location}`}
          onClose={() => setDeliveryRow(null)}
          onDelivered={() => {
            const itineraryId = deliveryRow.itinerary_id
            setDeliveryRow(null)
            // Moves into the Completed table (grouped at render time).
            setRows((prev) =>
              prev.map((r) =>
                r.itinerary_id === itineraryId ? { ...r, status: 'Delivered' } : r,
              ),
            )
            // The booking's later trips were re-timed too -- reload to show their new slots.
            loadDispatchBoard()
          }}
        />
      )}

      {editTimeRow && (
        <EditTripTimeModal
          itineraryId={editTimeRow.itinerary_id}
          start={editTimeRow.trip_start_at}
          end={editTimeRow.trip_end_at}
          fallbackDate={editTimeRow.trip_date_from}
          defaultStartMinutes={defaultStartMinutes}
          hoursPerTrip={editTimeRow.hours_per_trip}
          storageDeadline={editTimeRow.storage_deadline}
          onClose={() => setEditTimeRow(null)}
          onSaved={(warning) => {
            const itineraryId = editTimeRow.itinerary_id
            setEditTimeRow(null)
            // Later trips may have moved too -- reload to show every new slot.
            loadDispatchBoard()
            if (warning) setError(warning)
            else showToast(`Trip #${itineraryId} time saved.`)
          }}
        />
      )}

      {logsItineraryId !== null && (
        <ItineraryLogModal
          itineraryId={logsItineraryId}
          onClose={() => setLogsItineraryId(null)}
        />
      )}
    </div>
  )
}

export default DispatchBoardSection
