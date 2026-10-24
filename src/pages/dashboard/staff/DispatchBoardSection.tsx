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
import { useEffect, useState } from 'react'
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
import { freeVehicleIfIdle, setVehicleStatus } from '../../../lib/fleetStatus'
import { showToast } from '../../../components/Toast'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { fetchAll, fetchIn } from '../../../lib/dashboardExpenses'
import { loadApprovedLeave, rangesOverlap, type LeaveRange } from '../../../lib/leaveRequests'
import { toManilaDate } from '../../../lib/payslip'
import PageHeader from '../../../components/PageHeader'
import { formatDate, formatMoney, formatSlot, slotLines } from '../../../lib/format'
import StatusBadge from '../../../components/StatusBadge'
import { SearchBox } from './BookingsTripsControls'
import EditTripTimeModal from './EditTripTimeModal'
import { downpaymentStatus, tripsMayStart, type DownpaymentStatus } from '../../../lib/downpayment'
import { STORAGE_BADGE, storageState } from '../../../lib/storageDeadline'
import { tripCargoLabel } from '../../../lib/quoteRequest'
import { earliestFreeStart, rankVehicles, type VehicleCandidate } from '../../../lib/fleetMatch'
import {
  SUGGESTED_COUNT,
  isOverdue,
  lateEarlierTrip,
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
  'itinerary_id, booking_id, trip_date_from, trip_date_to, trip_start_at, trip_end_at, place_of_pickup_id, place_of_delivery_id, itinerary_status, plate_number, trailer_id, cargo_type, container_type, trailer_type, weight, cargo_description'

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
}

type BoardBookingRow = {
  booking_id: number
  hours_per_trip: number | null
  rate_of_delivery_service: number | null
  cost_per_trip: number | null
  amount_paid: number | null
  downpayment_waived_at: string | null
  storage_deadline: string | null
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
  // This trip's cargo, shown under the route ("Loose cargo · 20ft flatbed · 18 t").
  cargo_label: string
  cargo_description: string | null
  // Last free storage day (bookings.storage_deadline): must be Picked Up by
  // 11:59 PM that day. null = not an urgent booking.
  storage_deadline: string | null
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
  return `w-full min-w-40 border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-primary focus:outline-none disabled:opacity-60 ${
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
    ),
  }
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
  onChange,
}: {
  row: DispatchRow
  crewRole: 'Driver' | 'Helper'
  people: DriverOption[]
  allRows: DispatchRow[]
  leaveByEmployee: Map<number, LeaveRange[]>
  now: number
  disabled: boolean
  onChange: (employeeId: number | null) => void
}) {
  const currentId = crewRole === 'Driver' ? row.assigned_employee_id : row.assigned_helper_employee_id
  const currentName = crewRole === 'Driver' ? row.assigned_driver_name : row.assigned_helper_name

  if (!row.trip_start_at) {
    return (
      <div className="flex flex-col gap-1">
        <select disabled className={pickerClasses(currentId === null)} value="">
          <option value="">{currentName ?? 'Unassigned'}</option>
        </select>
        <span className="text-xs text-amber-700">Set the trip time first (⋮ menu)</span>
      </div>
    )
  }

  const { ranked, tripsOf } = rankPeople(row, people, allRows, leaveByEmployee, now)
  const free = ranked.filter((p) => p.blockedBy === null)
  const suggested = free.slice(0, SUGGESTED_COUNT)
  const otherFree = free.slice(SUGGESTED_COUNT)
  const unavailable = ranked.filter((p) => p.blockedBy !== null)

  // The assigned person's earlier trip running late into this one (#6).
  const late = currentId !== null ? lateEarlierTrip(row, tripsOf(currentId), now) : null
  const topPick = currentId === null ? suggested[0] : undefined

  return (
    <div className="flex flex-col gap-1">
      <select
        value={currentId ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
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

// Mono accent ramp only, no traffic-light colors -- weight increases as
// a trip gets closer to done, Delivered reads as a solid, locked-in tag
// rather than just another dropdown option.
const STATUS_SELECT_STYLES: Record<string, string> = {
  Awaiting: 'border-neutral-300 bg-transparent text-neutral-600',
  // On the road: outline only, so the dark fill is left for trips that are
  // waiting (blocked) behind them.
  Dispatched: 'border-accent-300 bg-transparent text-accent-700',
  PickedUp: 'border-accent-500 bg-transparent text-accent-700',
  InTransit: 'border-accent-500 bg-transparent text-accent-900',
  Delivered: 'border-accent-900 bg-accent-900 text-white',
}

// "⋮" button + small popup with the row's actions. The popup is
// position: fixed because the table's overflow-x-auto wrapper would clip
// an absolutely-positioned one. Items left out (null) aren't shown.
type MenuItem = { label: string; onClick: () => void; disabled?: boolean }

function ActionsMenu({ items }: { items: (MenuItem | null)[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const close = () => setPos(null)
  const itemClass =
    'block w-full px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-transparent'

  return (
    <>
      <button
        type="button"
        aria-label="Row actions"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
        }}
        className="flex h-11 w-11 items-center justify-center border border-slate-300 text-lg leading-none text-slate-600 hover:bg-slate-50"
      >
        ⋮
      </button>
      {pos && (
        <>
          {/* invisible full-screen layer: clicking anywhere else closes the menu */}
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="fixed z-50 min-w-48 border border-slate-200 bg-white py-1 shadow-lg" style={{ top: pos.top, right: pos.right }}>
            {items
              .filter((item): item is MenuItem => item !== null)
              .map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={itemClass}
                  disabled={item.disabled}
                  onClick={() => {
                    close()
                    item.onClick()
                  }}
                >
                  {item.label}
                </button>
              ))}
          </div>
        </>
      )}
    </>
  )
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
}

const TH = 'px-3 py-3 text-xs font-semibold tracking-wider text-slate-600 uppercase'

// Time slot on two lines, plus Overdue / storage-deadline flags.
function SlotCell({ row, now }: { row: DispatchRow; now: number }) {
  const slot = row.trip_start_at ? slotLines(row.trip_start_at, row.trip_end_at) : null
  const storage = storagePending(row, now)
  return (
    <div className="flex flex-col items-start gap-1 text-slate-900">
      {slot ? (
        <span>
          {slot.date}
          <span className="block text-slate-500">{slot.time}</span>
        </span>
      ) : (
        <span>
          {formatDate(row.trip_date_from)}
          <span className="block text-xs font-medium text-amber-700">No time set</span>
        </span>
      )}
      {/* Storage-deadline trip still at the port: that deadline is what
          matters until pickup, so it replaces "Overdue". */}
      {storage ? (
        <span className={`px-1.5 py-0.5 text-[11px] font-semibold ${STORAGE_BADGE[storage].className}`}>
          {storage === 'missed' ? STORAGE_BADGE.missed.label : `Pick up by ${formatDate(row.storage_deadline!)} 11:59 PM`}
        </span>
      ) : (
        isOverdue(row, now) && (
          <span className="border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 uppercase">
            Overdue
          </span>
        )
      )}
    </div>
  )
}

function CargoCell({ row }: { row: DispatchRow }) {
  return (
    <span className="text-slate-900">
      {row.cargo_label}
      {row.cargo_description && (
        <span className="block max-w-60 truncate text-slate-500" title={row.cargo_description}>
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
  return reasons
}

// Status: a badge while the trip still needs crew/vehicles (it can't move
// yet), otherwise the dropdown -- Admin any status, Dispatcher only the
// next step. Picking "Delivered" opens MarkDeliveredModal.
function StatusCell({ row, ctx }: { row: DispatchRow; ctx: BoardContext }) {
  const editable = ctx.canEditStatus && (row.status !== 'Awaiting' || isFullyAssigned(row))
  const crewBusy = crewOnRoadReason(row, ctx.allRows)
  return (
    <div className="flex flex-col items-start gap-1.5">
      {editable ? (
        <select
          value={row.status}
          disabled={ctx.savingId === row.itinerary_id || crewBusy !== null}
          title={crewBusy ? `Can't start: ${crewBusy}.` : undefined}
          onChange={(e) => ctx.onStatusChange(row.itinerary_id, row.status, e.target.value)}
          // Fixed width: the long "(downpayment first)" option text would
          // otherwise stretch it; the open list still shows it in full.
          className={`w-40 border px-2 py-1.5 text-xs font-semibold tracking-[0.03em] uppercase focus:outline-none ${
            crewBusy
              ? 'cursor-not-allowed border-slate-300 bg-slate-200 text-slate-500'
              : (STATUS_SELECT_STYLES[row.status] ?? 'border-neutral-300 text-neutral-600')
          }`}
        >
          {(ctx.canFreelyEditStatus
            ? STATUS_FLOW
            : // Dispatcher: current status + the very next step only.
              STATUS_FLOW.slice(STATUS_FLOW.indexOf(row.status), STATUS_FLOW.indexOf(row.status) + 2)
          ).map((status) => (
            <option
              key={status}
              value={status}
              // A trip can't leave Awaiting without a time slot, driver, truck
              // and trailer, nor before the booking's downpayment is paid (or waived).
              disabled={
                row.status === 'Awaiting' &&
                status !== 'Awaiting' &&
                (!isFullyAssigned(row) || !tripsMayStart(row.downpayment) || crewBusy !== null)
              }
            >
              {STATUS_LABELS[status]}
              {row.status === 'Awaiting' && status !== 'Awaiting' && !tripsMayStart(row.downpayment)
                ? ' (downpayment first)'
                : ''}
            </option>
          ))}
        </select>
      ) : (
        <>
          <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} icon />
          {/* What it still needs before it can leave Awaiting. */}
          {row.status === 'Awaiting' && !isFullyAssigned(row) && (
            <span className="text-xs text-slate-500">Needs {missingForDispatch(row)}</span>
          )}
        </>
      )}
    </div>
  )
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

  // Option value -> what the handlers take (plate / trailer id).
  const pick = (id: string | null) =>
    kind === 'Truck'
      ? ctx.onTruckChange(row.itinerary_id, row.plate_number, id ? id.slice(2) : null)
      : ctx.onTrailerChange(row.itinerary_id, row.trailer_id, id ? Number(id.slice(2)) : null)
  // Just the plate: the "this booking" / "service due" / "work order
  // pending" hints only decide the order, and the Unavailable group is
  // greyed out. The reason shows as a tooltip on hover (title).
  const label = (v: (typeof ranked)[number]) => v.label

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
    </div>
  )
}

// The ⋮ menu items for one trip.
function rowMenuItems(row: DispatchRow, ctx: BoardContext): (MenuItem | null)[] {
  const done = row.status === 'Delivered'
  return [
    { label: 'View logs', onClick: () => ctx.onViewLogs(row.itinerary_id) },
    !done && ctx.canEditStatus
      ? { label: row.trip_start_at ? 'Edit time' : 'Set time', onClick: () => ctx.onEditTime(row) }
      : null,
    // Dispatcher: backward moves go through Admin.
    ctx.canEditStatus && !ctx.canFreelyEditStatus && row.status !== 'Awaiting'
      ? {
          label: ctx.pendingCorrectionIds.has(row.itinerary_id) ? 'Correction pending' : 'Request correction',
          disabled: ctx.pendingCorrectionIds.has(row.itinerary_id),
          onClick: () => ctx.onRequestCorrection(row),
        }
      : null,
    // Admin: un-deliver a completed trip (asks first).
    done && ctx.canFreelyEditStatus
      ? { label: 'Move back to In Transit…', onClick: () => ctx.onStatusChange(row.itinerary_id, 'Delivered', 'InTransit') }
      : null,
  ]
}

// Needs Assignment / Assigned: one booking's trips.
function ActiveTripTable({ rows, ctx }: { rows: DispatchRow[]; ctx: BoardContext }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-y border-slate-200 bg-slate-50">
          <tr>
            <th className={`${TH} pl-5`}>Trip</th>
            <th className={TH}>Time Slot</th>
            <th className={TH}>Cargo</th>
            <th className={TH}>Status</th>
            <th className={TH}>Driver</th>
            <th className={TH}>Helper</th>
            <th className={TH}>Truck</th>
            <th className={TH}>Trailer</th>
            <th className={TH}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itinerary_id} className="border-b border-slate-200 last:border-0">
              <td className="py-4 pr-3 pl-5 text-base font-bold text-slate-900">#{row.itinerary_id}</td>
              <td className="px-3 py-4">
                <SlotCell row={row} now={ctx.now} />
              </td>
              <td className="px-3 py-4">
                <CargoCell row={row} />
              </td>
              <td className="px-3 py-4">
                <StatusCell row={row} ctx={ctx} />
              </td>
              <td className="px-3 py-4">
                <CrewSelect
                  row={row}
                  crewRole="Driver"
                  people={ctx.drivers}
                  allRows={ctx.allRows}
                  leaveByEmployee={ctx.leaveByEmployee}
                  now={ctx.now}
                  disabled={ctx.savingId === row.itinerary_id}
                  onChange={(id) => ctx.onCrewChange(row.itinerary_id, 'Driver', row.assigned_employee_id, id)}
                />
              </td>
              <td className="px-3 py-4">
                <CrewSelect
                  row={row}
                  crewRole="Helper"
                  people={ctx.helpers}
                  allRows={ctx.allRows}
                  leaveByEmployee={ctx.leaveByEmployee}
                  now={ctx.now}
                  disabled={ctx.savingId === row.itinerary_id}
                  onChange={(id) => ctx.onCrewChange(row.itinerary_id, 'Helper', row.assigned_helper_employee_id, id)}
                />
              </td>
              <td className="px-3 py-4">
                <VehicleSelect kind="Truck" row={row} ctx={ctx} />
              </td>
              <td className="px-3 py-4">
                <VehicleSelect kind="Trailer" row={row} ctx={ctx} />
              </td>
              <td className="py-4 pr-5 pl-3">
                <ActionsMenu items={rowMenuItems(row, ctx)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Completed: one flat table, read-only -- changing the driver of a
// delivered trip would move its pay to someone else, and assigning a truck
// would flip it back to "In Transit". Admin can still move one back (⋮).
function CompletedTripTable({ rows, ctx }: { rows: DispatchRow[]; ctx: BoardContext }) {
  const trailerPlate = (id: number | null) =>
    id === null ? '—' : (ctx.trailers.find((t) => t.trailer_id === id)?.plate_number ?? `#${id}`)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className={`${TH} pl-5`}>Booking</th>
            <th className={TH}>Origin → Destination</th>
            <th className={TH}>Cargo</th>
            <th className={TH}>Time Slot</th>
            <th className={TH}>Status</th>
            <th className={TH}>Driver</th>
            <th className={TH}>Helper</th>
            <th className={TH}>Truck</th>
            <th className={TH}>Trailer</th>
            <th className={TH}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itinerary_id} className="border-b border-slate-200 last:border-0">
              <td className="py-3 pr-3 pl-5 text-base font-bold text-slate-900">
                <Link to={`/dashboard/bookings?booking=${row.booking_id}&trip=${row.itinerary_id}`} className="hover:underline">
                  #{row.booking_id}
                </Link>
              </td>
              <td className="px-3 py-3 text-slate-900">
                {row.pickup_location}
                <span className="block text-slate-500">→ {row.delivery_location}</span>
              </td>
              <td className="px-3 py-3">
                <CargoCell row={row} />
              </td>
              <td className="px-3 py-3">
                <SlotCell row={row} now={ctx.now} />
              </td>
              <td className="px-3 py-3">
                <StatusBadge status={row.status} label={STATUS_LABELS[row.status]} icon />
              </td>
              <td className="px-3 py-3 text-slate-900">{row.assigned_driver_name ?? '—'}</td>
              <td className="px-3 py-3 text-slate-900">{row.assigned_helper_name ?? '—'}</td>
              <td className="px-3 py-3 text-slate-900">{row.plate_number ?? '—'}</td>
              <td className="px-3 py-3 text-slate-900">{trailerPlate(row.trailer_id)}</td>
              <td className="py-3 pr-5 pl-3">
                <ActionsMenu items={rowMenuItems(row, ctx)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The big box every tab draws in: fills the screen height, with a footer
// line (summary on the left, Previous/Next on the right when paged).
function BoardBox({
  children,
  footer,
  pager,
}: {
  children: React.ReactNode
  footer?: string
  pager?: { page: number; pageCount: number; onChange: (page: number) => void }
}) {
  const button = 'border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40'
  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col border-2 border-slate-300 bg-white">
      <div className="flex flex-1 flex-col">{children}</div>
      {(footer || (pager && pager.pageCount > 1)) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-700">
          <span>{footer}</span>
          {pager && pager.pageCount > 1 && (
            <span className="flex gap-2">
              <button type="button" onClick={() => pager.onChange(pager.page - 1)} disabled={pager.page === 0} className={button}>
                ‹ Previous
              </button>
              <button
                type="button"
                onClick={() => pager.onChange(pager.page + 1)}
                disabled={pager.page >= pager.pageCount - 1}
                className={button}
              >
                Next ›
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// A tab with nothing in it: dashed box, truck icon, message, optional button.
function EmptyPanel({ message, action }: { message: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3 border border-dashed border-slate-300 px-16 py-10 text-center">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-slate-600" aria-hidden="true">
          <path d="M1 4h14v11H1zM15 8h4l3 3v4h-7M5.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM18.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
        </svg>
        <p className="text-[15px] font-medium text-slate-900">{message}</p>
        {action && (
          <button type="button" onClick={action.onClick} className="btn-primary px-5 py-2.5 text-sm font-semibold">
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

function DispatchBoardSection() {
  const { employeeId, role } = useAuth()
  const canFreelyEditStatus = isAdmin(role)
  const canEditStatus = isAdmin(role) || isDispatcher(role)
  const [relogRequestRow, setRelogRequestRow] = useState<DispatchRow | null>(null)
  const [deliveryRow, setDeliveryRow] = useState<DispatchRow | null>(null)
  // Completed starts collapsed so it doesn't push active work down.
  const [tab, setTab] = useState<'needs' | 'assigned' | 'completed'>('needs')
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
  const [search, setSearch] = useState('')
  // Trip whose time slot is being edited (EditTripTimeModal).
  const [editTimeRow, setEditTimeRow] = useState<DispatchRow | null>(null)
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
          .select('booking_id, hours_per_trip, rate_of_delivery_service, cost_per_trip, amount_paid, downpayment_waived_at, storage_deadline')
          .in('booking_id', chunk)
          .range(from, to),
      ),
      fetchIn<{ booking_id: number; itinerary_status: string | null }>(bookingIds, (chunk, from, to) =>
        supabase
          .from('itineraries')
          .select('booking_id, itinerary_status')
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
    const storageDeadlineByBooking = new Map(
      bookingTypeRows.map((b) => [b.booking_id as number, b.storage_deadline]),
    )
    const hoursPerTripByBooking = new Map(
      bookingTypeRows.map((b) => [b.booking_id as number, b.hours_per_trip as number | null]),
    )
    // Downpayment per booking: trips = ALL its non-cancelled itineraries.
    const tripCountByBooking = new Map<number, number>()
    bookingTripsResult.rows
      .filter((it) => it.itinerary_status !== 'Cancelled')
      .forEach((it) =>
        tripCountByBooking.set(it.booking_id, (tripCountByBooking.get(it.booking_id) ?? 0) + 1),
      )
    const downpaymentByBooking = new Map(
      bookingTypeRows.map((b) => [
        b.booking_id as number,
        downpaymentStatus({
          ratePerTrip: b.rate_of_delivery_service,
          costPerTrip: b.cost_per_trip,
          trips: tripCountByBooking.get(b.booking_id) ?? 0,
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
      }>(
        Array.from(employeeIds),
        (chunk, from, to) =>
          supabase
            .from('employees')
            .select('employee_id, full_name, employment_status_id, driver_license_expiry_date')
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
          cargo_label: tripCargoLabel(it),
          cargo_description: it.cargo_description,
          storage_deadline: storageDeadlineByBooking.get(it.booking_id) ?? null,
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
    if (row?.required_trailer_type && picked && picked.trailer_type !== row.required_trailer_type) {
      setError(`This trip needs a ${row.required_trailer_type} trailer.`)
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
  async function assignSuggestedCrew(groupRows: DispatchRow[]) {
    const ok = await confirmDialog({
      title: 'Use the suggested crew and vehicles?',
      message:
        'Every trip of this booking that has a time slot gets the top suggested free driver, helper, truck and trailer where one is missing. You can change any of them afterwards.',
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
        const pick = rankPeople(current, people, working, leaveByEmployee, now).ranked.find((p) => p.blockedBy === null)
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
        const pick = rankFleet(kind, current, candidates, working, now).ranked.find((v) => v.blockedBy === null)
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
  async function replaceVehicle(kind: 'Truck' | 'Trailer', row: DispatchRow) {
    const oldId = vehicleIdOf(kind, row)
    const affected = rows
      .filter((r) => r.booking_id === row.booking_id && r.status === 'Awaiting' && vehicleIdOf(kind, r) === oldId)
      .sort((a, b) => Date.parse(a.trip_start_at ?? '') - Date.parse(b.trip_start_at ?? ''))
    const ok = await confirmDialog({
      title: `Replace the ${kind.toLowerCase()}?`,
      message: `Trips ${affected.map((r) => `#${r.itinerary_id}`).join(', ')} get the top suggested free ${kind.toLowerCase()} instead. You can change them afterwards.`,
      confirmLabel: `Replace ${kind.toLowerCase()}`,
    })
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

  // Search: booking #, places, crew names, truck or trailer plate.
  const query = search.trim().toLowerCase()
  const trailerPlateById = new Map(trailers.map((t) => [t.trailer_id, t.plate_number]))
  const visibleRows = !query
    ? rows
    : rows.filter((r) =>
        [
          `#${r.booking_id}`,
          r.pickup_location,
          r.delivery_location,
          r.assigned_driver_name,
          r.assigned_helper_name,
          r.plate_number,
          r.trailer_id !== null ? trailerPlateById.get(r.trailer_id) : null,
        ].some((text) => text?.toLowerCase().includes(query)),
      )
  // Trips that must still leave the port by the storage deadline go first
  // (stable sort -- everything else keeps its order).
  const activeRows = visibleRows
    .filter((r) => r.status !== 'Delivered')
    .sort((a, b) => Number(storagePending(b, now) !== null) - Number(storagePending(a, now) !== null))
  const completedRows = visibleRows.filter((r) => r.status === 'Delivered')
  const hasFullCrew = isFullyAssigned
  const needsAssignmentRows = activeRows.filter((r) => !hasFullCrew(r))
  // Planned trips that may not happen as assigned (leave, shop, late trip,
  // no truck / trailer free for the slot...), with a fix where there is one.
  const fleet = { Truck: truckCandidates(trucks, vehicleService), Trailer: trailerCandidates(trailers, vehicleService) }
  const atRiskTrips = rows
    .map((row) => {
      const reasons = atRiskReasons(row, rows, leaveByEmployee, drivers, trucks, trailers, now)
      const actions: { label: string; onClick: () => void }[] = []
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
              actions.push({ label: `Replace ${kind.toLowerCase()} on remaining trips`, onClick: () => replaceVehicle(kind, row) })
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
      return { row, reasons, actions }
    })
    .filter((t) => t.reasons.length > 0)
  const assignedRows = activeRows.filter(hasFullCrew)

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
    onCrewChange: handleCrewChange,
    onTruckChange: handleTruckChange,
    onTrailerChange: handleTrailerChange,
    onViewLogs: setLogsItineraryId,
    onEditTime: setEditTimeRow,
  }

  // Needs Assignment / Assigned: one block per booking. Bookings with trips
  // still to leave the port by a storage deadline first, then earliest trip
  // first; inside a booking, trips in time order.
  const startMs = (r: DispatchRow) => Date.parse(r.trip_start_at ?? `${r.trip_date_from}T00:00:00+08:00`)
  const byStart = (a: DispatchRow, b: DispatchRow) => startMs(a) - startMs(b) || a.itinerary_id - b.itinerary_id
  function groupByBooking(list: DispatchRow[]) {
    const map = new Map<number, DispatchRow[]>()
    for (const r of list) map.set(r.booking_id, [...(map.get(r.booking_id) ?? []), r])
    return [...map.entries()]
      .map(([bookingId, trips]) => ({ bookingId, trips: trips.sort(byStart) }))
      .sort(
        (a, b) =>
          Number(b.trips.some((r) => storagePending(r, now))) - Number(a.trips.some((r) => storagePending(r, now))) ||
          byStart(a.trips[0], b.trips[0]),
      )
  }

  const tabs = [
    { id: 'needs', label: 'Needs Assignment', count: needsAssignmentRows.length },
    { id: 'assigned', label: 'Assigned — In Progress', count: assignedRows.length },
    { id: 'completed', label: `Completed — Last ${COMPLETED_DAYS} Days`, count: completedRows.length },
  ] as const
  const groups = groupByBooking(tab === 'assigned' ? assignedRows : tab === 'needs' ? needsAssignmentRows : [])
  // One page at a time (back to page 1 on a tab/search change): bookings
  // on the two active tabs, trips on Completed.
  const pagedGroups = usePaged(groups, `${tab}|${search}`)
  const pagedCompleted = usePaged(tab === 'completed' ? completedRows : [], `${tab}|${search}`)
  const activeCount = tab === 'needs' ? needsAssignmentRows.length : assignedRows.length

  return (
    <div>
      <PageHeader
        title="Dispatch Board"
        subtitle="Assign drivers, helpers, trucks and trailers, and track each booking through delivery."
      />

      {atRiskTrips.length > 0 && (
        <div className="mb-4 border border-orange-300 bg-orange-50 px-4 py-3">
          <p className="text-sm font-semibold text-orange-900">At-risk trips ({atRiskTrips.length})</p>
          <ul className="mt-1 text-sm text-orange-900">
            {atRiskTrips.slice(0, 5).map((t) => (
              <li key={t.row.itinerary_id} className="flex flex-wrap items-baseline gap-x-3">
                <span>
                  Trip #{t.row.itinerary_id} · Booking #{t.row.booking_id} — {t.reasons.join('; ')}
                </span>
                {canEditStatus &&
                  t.actions.map((a) => (
                    <button key={a.label} type="button" onClick={a.onClick} className="text-xs font-semibold underline hover:no-underline">
                      {a.label}
                    </button>
                  ))}
              </li>
            ))}
          </ul>
          {atRiskTrips.length > 5 && <p className="mt-1 text-xs text-orange-800">+ {atRiskTrips.length - 5} more</p>}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex flex-wrap gap-2">
          {tabs.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2.5 border-2 px-5 py-2.5 text-sm font-semibold ${
                  active ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
                }`}
              >
                {t.label}
                {!loading && (
                  <span
                    className={`px-1.5 text-xs ${
                      active
                        ? 'bg-white text-primary'
                        : t.id === 'needs' && t.count > 0
                          ? 'bg-primary text-white'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Booking #, place, driver, helper or plate" />
        {/* Drivers move trips from their phones -- reload to see it. */}
        <button
          type="button"
          onClick={() => {
            loadDispatchBoard()
            if (isDispatcher(role) && employeeId) loadMyRequests(employeeId)
          }}
          disabled={loading}
          className="flex items-center gap-2 border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
          </svg>
          Refresh
        </button>
      </div>

      {error && <p className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <BoardBox>
          <p className="p-6 text-slate-500">Loading dispatch board...</p>
        </BoardBox>
      ) : rows.length === 0 ? (
        <BoardBox>
          <EmptyPanel message="No trips right now." />
        </BoardBox>
      ) : visibleRows.length === 0 ? (
        <BoardBox>
          <EmptyPanel message={`No trips match "${search}".`} action={{ label: 'Clear search', onClick: () => setSearch('') }} />
        </BoardBox>
      ) : tab === 'completed' ? (
        <BoardBox
          footer={`Showing ${pagedCompleted.rows.length} of ${completedRows.length} completed ${completedRows.length === 1 ? 'trip' : 'trips'}`}
          pager={pagedCompleted.pager}
        >
          {completedRows.length === 0 ? (
            <EmptyPanel message={`No trips delivered in the last ${COMPLETED_DAYS} days. Older ones are in Bookings & Trips.`} />
          ) : (
            <CompletedTripTable rows={pagedCompleted.rows} ctx={ctx} />
          )}
        </BoardBox>
      ) : (
        <BoardBox
          footer={
            activeCount === 0
              ? undefined
              : tab === 'needs'
                ? `${activeCount} ${activeCount === 1 ? 'trip needs' : 'trips need'} assignment · earliest first`
                : `${activeCount} ${activeCount === 1 ? 'trip' : 'trips'} in progress · earliest first`
          }
          pager={pagedGroups.pager}
        >
          {activeCount === 0 ? (
            tab === 'needs' ? (
              <EmptyPanel
                message="Nothing waiting on a driver, truck, or trailer."
                action={
                  assignedRows.length > 0
                    ? { label: `View ${assignedRows.length} Trips In Progress`, onClick: () => setTab('assigned') }
                    : undefined
                }
              />
            ) : (
              <EmptyPanel
                message="No fully-crewed trips in progress."
                action={
                  needsAssignmentRows.length > 0
                    ? {
                        label: `View ${needsAssignmentRows.length} ${needsAssignmentRows.length === 1 ? 'Trip' : 'Trips'} Needing Assignment`,
                        onClick: () => setTab('needs'),
                      }
                    : undefined
                }
              />
            )
          ) : (
            pagedGroups.rows.map((group) => {
              const first = group.trips[0]
              // Trips of this booking with a slot but no driver or helper yet.
              const missingCrew = group.trips.filter(
                (r) =>
                  r.trip_start_at &&
                  (r.assigned_employee_id === null || r.assigned_helper_employee_id === null || r.plate_number === null || r.trailer_id === null),
              )
              // Same downpayment for every trip of a booking.
              const downpaymentDue =
                first.downpayment && !tripsMayStart(first.downpayment) && group.trips.some((r) => r.status === 'Awaiting')
                  ? first.downpayment
                  : null
              return (
                <section key={group.bookingId} className="border-b-2 border-slate-300 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="text-lg font-bold text-slate-900">Booking #{group.bookingId}</h3>
                      <span className="text-[15px] text-slate-700">
                        {first.pickup_location} → {first.delivery_location}
                      </span>
                      <span className="bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {group.trips.length} {group.trips.length === 1 ? 'trip' : 'trips'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <Link
                        to={`/dashboard/bookings?booking=${group.bookingId}`}
                        className="text-sm font-semibold text-primary hover:underline"
                      >
                        Open Booking
                      </Link>
                      {canEditStatus && missingCrew.length > 0 && (
                        <button
                          type="button"
                          onClick={() => assignSuggestedCrew(group.trips)}
                          disabled={bulkBookingId !== null}
                          className="flex items-center gap-2 border-2 border-primary bg-white px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
                        >
                          <span aria-hidden="true">✓</span>
                          {bulkBookingId === group.bookingId
                            ? 'Assigning…'
                            : `Use Suggested Crew & Vehicles for ${missingCrew.length === 1 ? 'Trip' : `All ${missingCrew.length} Trips`}`}
                        </button>
                      )}
                    </div>
                  </div>
                  {downpaymentDue && (
                    <div className="mx-5 mb-4 flex flex-wrap items-center justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <p>
                        <span aria-hidden="true" className="mr-2">⚠</span>
                        <span className="font-semibold">Awaiting downpayment: {formatMoney(downpaymentDue.missing)} to go</span>
                        {' · '}
                        {formatMoney(downpaymentDue.paid)} of {formatMoney(downpaymentDue.required)} paid. No trip can start until it
                        is paid.
                      </p>
                      {/* Bills Receivable exists only in the Admin routes. */}
                      {canFreelyEditStatus && (
                        <Link to={`/dashboard/financial-records?downpayment=${group.bookingId}`} className="font-semibold underline">
                          Record Downpayment
                        </Link>
                      )}
                    </div>
                  )}
                  <ActiveTripTable rows={group.trips} ctx={ctx} />
                </section>
              )
            })
          )}
        </BoardBox>
      )}

      {isDispatcher(role) && myRequests.length > 0 && (
        <div className="mt-8">
          <h3 className="font-ui text-[11px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">
            My Correction Requests
          </h3>
          <ul className="reports-blueprint-card mt-2 divide-y divide-reports-hairline font-ui text-sm">
            {myRequests.map((request) => {
              const bookingId = rows.find((r) => r.itinerary_id === request.itinerary_id)?.booking_id
              return (
                <li key={request.request_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                  <span className="text-reports-ink">
                    {bookingId !== undefined ? `Booking #${bookingId}` : `Trip #${request.itinerary_id}`}:{' '}
                    {STATUS_LABELS[request.current_status] ?? request.current_status} →{' '}
                    {STATUS_LABELS[request.requested_status] ?? request.requested_status}
                  </span>
                  <span
                    className={`border px-2 py-0.5 text-[11px] font-semibold uppercase ${
                      request.status === 'Approved'
                        ? 'border-accent-900 bg-accent-900 text-white'
                        : request.status === 'Rejected'
                          ? 'border-red-300 text-red-700'
                          : 'border-neutral-300 text-neutral-600'
                    }`}
                  >
                    {request.status}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {formatDate(request.created_at)}
                  </span>
                  <span className="w-full text-xs text-neutral-600">Reason: {request.reason}</span>
                  {request.resolution_note && (
                    <span className="w-full text-xs text-neutral-600">
                      Admin note: {request.resolution_note}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
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

      {deliveryRow && (
        <MarkDeliveredModal
          itineraryId={deliveryRow.itinerary_id}
          currentStatus={deliveryRow.status}
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
          // Same booking, later in trip order, not started yet. None for a
          // storage-deadline booking -- its trips run side by side.
          laterTrips={
            editTimeRow.storage_deadline
              ? []
              : rows
                  .filter(
                    (r) =>
                      r.booking_id === editTimeRow.booking_id &&
                      r.itinerary_id > editTimeRow.itinerary_id &&
                      r.status === 'Awaiting',
                  )
                  .sort((a, b) => a.itinerary_id - b.itinerary_id)
          }
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
