// DispatchBoardSection: board of itineraries (everything but Cancelled)
// for staff to advance status and assign a driver, split into 3 tables --
// Needs Assignment (missing driver, truck, or trailer), Assigned (fully
// crewed, just not delivered yet), and Completed (status Delivered --
// previously excluded from this page entirely, now shown read-into
// instead of vanishing). Each table is newest trip date first.
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
// (full_name) -- the employee_id list of who counts as a "driver" comes
// from `users` where user_role = 'Driver', since that's the same role
// value already used everywhere else in the app (isEmployee(), RoleBadge).
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
import { loadApprovedLeave, rangesOverlap, type LeaveRange } from '../../../lib/leaveRequests'
import { toManilaDate } from '../../../lib/payslip'
import PageHeader from '../../../components/PageHeader'
import { formatDate, formatMoney, formatSlot } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import EditTripTimeModal from './EditTripTimeModal'
import { downpaymentStatus, tripsMayStart, type DownpaymentStatus } from '../../../lib/downpayment'
import {
  SUGGESTED_COUNT,
  isOverdue,
  lateEarlierTrip,
  rankCandidates,
  type ScheduledTrip,
} from '../../../lib/tripSchedule'

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
  // From the booking (Flatbed/Skeletal). null = booking has no requirement (older ones).
  required_trailer_type: string | null
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
}

type TruckOption = {
  plate_number: string
  current_status: string | null
}

type TrailerOption = {
  trailer_id: number
  plate_number: string | null
  trailer_type: string | null
  current_status: string | null
}

const crewSelectClasses =
  'w-full min-w-36 border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none'

// Driver or helper picker for one trip. Locked until the trip has a time
// slot. Options are grouped: Suggested (the top free people), Other free,
// and Unavailable (busy on an overlapping trip, or on leave -- disabled,
// except whoever is already assigned so the dropdown still shows them).
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
        <select disabled className={`${crewSelectClasses} opacity-60`} value="">
          <option value="">{currentName ?? 'Unassigned'}</option>
        </select>
        <span className="text-[11px] text-amber-700">Set the trip time first</span>
      </div>
    )
  }

  // A person's trips = every trip they're the active driver or helper on.
  const tripsOf = (employeeId: number): ScheduledTrip[] =>
    allRows.filter((r) => r.assigned_employee_id === employeeId || r.assigned_helper_employee_id === employeeId)
  const ranked = rankCandidates(
    row,
    people,
    tripsOf,
    now,
    (clash) => ` — busy ${formatSlot(clash.trip_start_at, clash.trip_end_at)} (trip #${clash.itinerary_id})`,
    (employeeId) => leaveHint(row, employeeId, false, leaveByEmployee),
  )
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
        className={crewSelectClasses}
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
          className="text-left text-[11px] font-semibold text-accent-700 underline hover:text-accent-900 disabled:opacity-50"
        >
          Assign {topPick.full_name}
        </button>
      )}
      {late && (
        <span className="text-[11px] font-medium text-amber-700">
          ⚠ {currentName ?? 'They'}'s trip #{late.itinerary_id} is running late — reassign?
        </span>
      )}
    </div>
  )
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

// Dropdown hint for a truck/trailer option on this row. `blocked` = it
// can't be picked (Under Maintenance / Out of Service). Being on another
// active trip is only a hint -- one vehicle can be booked on several
// trips. A row's own current assignment is always pickable.
function vehicleHint(
  row: DispatchRow,
  rows: DispatchRow[],
  vehicle: { current_status: string | null },
  isOnRow: (r: DispatchRow) => boolean,
): { label: string; blocked: boolean } | null {
  if (isOnRow(row)) return null
  if (vehicle.current_status === 'Under Maintenance' || vehicle.current_status === 'Out of Service') {
    return { label: vehicle.current_status, blocked: true }
  }
  const otherTrip = rows.find((r) => r !== row && r.status !== 'Delivered' && isOnRow(r))
  return otherTrip ? { label: `on booking #${otherTrip.booking_id}`, blocked: false } : null
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
  Dispatched: 'border-accent-300 bg-accent-100 text-accent-700',
  PickedUp: 'border-accent-500 bg-accent-100 text-accent-700',
  InTransit: 'border-accent-500 bg-accent-300/50 text-accent-900',
  Delivered: 'border-accent-900 bg-accent-900 text-white',
}

// "⋮" button + small popup with the row's actions (View logs, and Request
// correction for Dispatchers). The popup is position: fixed because the
// table's overflow-x-auto wrapper would clip an absolutely-positioned one.
function ActionsMenu({
  onViewLogs,
  correction,
}: {
  onViewLogs: () => void
  correction: { pending: boolean; onRequest: () => void } | null
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const close = () => setPos(null)
  const itemClass = 'block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:text-slate-400 disabled:hover:bg-transparent'

  return (
    <>
      <button
        type="button"
        aria-label="Row actions"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
        }}
        className="px-2 py-1 text-lg leading-none text-slate-600 hover:bg-slate-100"
      >
        ⋮
      </button>
      {pos && (
        <>
          {/* invisible full-screen layer: clicking anywhere else closes the menu */}
          <div className="fixed inset-0 z-40" onClick={close} />
          <div
            className="fixed z-50 min-w-40 border border-slate-200 bg-white py-1 shadow-lg"
            style={{ top: pos.top, right: pos.right }}
          >
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                close()
                onViewLogs()
              }}
            >
              View logs
            </button>
            {correction && (
              <button
                type="button"
                className={itemClass}
                disabled={correction.pending}
                onClick={() => {
                  close()
                  correction.onRequest()
                }}
              >
                {correction.pending ? 'Correction pending' : 'Request correction'}
              </button>
            )}
          </div>
        </>
      )}
    </>
  )
}

// Shared table renderer for all 3 groups below -- same columns/handlers
// regardless of which bucket a row is in. readOnly (the Completed table)
// shows crew/truck/trailer as plain text: changing the driver on a
// delivered trip would move its pay to someone else, and assigning a
// truck would flip it back to "In Transit". Admin keeps the status
// dropdown there so a delivered trip can still be moved back.
function DispatchTable({
  rows,
  drivers,
  helpers,
  trucks,
  trailers,
  canEditStatus,
  canFreelyEditStatus,
  savingId,
  onStatusChange,
  onRequestCorrection,
  pendingCorrectionIds,
  onCrewChange,
  onTruckChange,
  onTrailerChange,
  onViewLogs,
  readOnly = false,
  allRows,
  leaveByEmployee,
  now,
  onEditTime,
}: {
  rows: DispatchRow[]
  // Current time (ms), ticking each minute -- drives Overdue / busy checks.
  now: number
  onEditTime: (row: DispatchRow) => void
  allRows: DispatchRow[]
  leaveByEmployee: Map<number, LeaveRange[]>
  drivers: DriverOption[]
  helpers: DriverOption[]
  trucks: TruckOption[]
  trailers: TrailerOption[]
  canEditStatus: boolean
  canFreelyEditStatus: boolean
  savingId: number | null
  onStatusChange: (itineraryId: number, previousStatus: string, newStatus: string) => void
  onRequestCorrection: (row: DispatchRow) => void
  // Trips with a Pending correction request from this Dispatcher --
  // shown as "Correction pending" instead of a second request button.
  pendingCorrectionIds: Set<number>
  onCrewChange: (
    itineraryId: number,
    crewRole: 'Driver' | 'Helper',
    previousEmployeeId: number | null,
    newEmployeeId: number | null,
  ) => void
  onTruckChange: (itineraryId: number, previousPlateNumber: string | null, plateNumber: string | null) => void
  onTrailerChange: (itineraryId: number, previousTrailerId: number | null, trailerId: number | null) => void
  onViewLogs: (itineraryId: number) => void
  readOnly?: boolean
}) {
  return (
    <div className="reports-blueprint-card overflow-x-auto">
      <table className="w-full text-left font-ui text-sm">
        <thead className="border-b border-reports-hairline">
          <tr>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Booking
            </th>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Origin → Destination
            </th>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Time Slot
            </th>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Driver
            </th>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Helper
            </th>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Truck
            </th>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Trailer
            </th>
            <th className="px-4 py-3 text-[11px] font-medium tracking-[0.1em] text-neutral-500 uppercase">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itinerary_id} className="border-b border-reports-hairline last:border-0">
              <td className="px-4 py-3 text-reports-ink">
                <Link
                  to={`/dashboard/bookings?booking=${row.booking_id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  #{row.booking_id}
                </Link>
              </td>
              <td className="px-4 py-3 text-neutral-600">
                {row.pickup_location} → {row.delivery_location}
              </td>
              <td className="px-4 py-3 text-neutral-600">
                <div className="flex flex-col items-start gap-1">
                  {row.trip_start_at ? (
                    <span className="whitespace-nowrap">{formatSlot(row.trip_start_at, row.trip_end_at)}</span>
                  ) : (
                    <>
                      <span className="whitespace-nowrap">{formatDate(row.trip_date_from)}</span>
                      <span className="text-[11px] font-medium text-amber-700">No time set</span>
                    </>
                  )}
                  {isOverdue(row, now) && (
                    <span className="border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 uppercase">
                      Overdue
                    </span>
                  )}
                  {!readOnly && canEditStatus && (
                    <button
                      type="button"
                      onClick={() => onEditTime(row)}
                      disabled={savingId === row.itinerary_id}
                      className="text-[11px] font-semibold text-accent-700 underline hover:text-accent-900"
                    >
                      {row.trip_start_at ? 'Edit time' : 'Set time'}
                    </button>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col items-start gap-1.5">
                  {canEditStatus && (!readOnly || canFreelyEditStatus) ? (
                    <select
                      value={row.status}
                      disabled={savingId === row.itinerary_id}
                      onChange={(e) => onStatusChange(row.itinerary_id, row.status, e.target.value)}
                      // Fixed width: the long "(assign … first)" option text would
                      // otherwise stretch it; the open list still shows it in full.
                      className={`w-44 border px-2 py-1 text-xs font-semibold tracking-[0.03em] uppercase focus:outline-none ${
                        STATUS_SELECT_STYLES[row.status] ?? 'border-neutral-300 text-neutral-600'
                      }`}
                    >
                      {(canFreelyEditStatus
                        ? STATUS_FLOW
                        : // Dispatcher: current status + the very next step only.
                          STATUS_FLOW.slice(
                            STATUS_FLOW.indexOf(row.status),
                            STATUS_FLOW.indexOf(row.status) + 2,
                          )
                      ).map((status) => (
                        <option
                          key={status}
                          value={status}
                          // Same rule as the driver's side: a trip can't
                          // leave Awaiting without a driver, truck and
                          // trailer (helper is optional).
                          // ...nor before the booking's downpayment is paid (or waived).
                          disabled={
                            row.status === 'Awaiting' &&
                            status !== 'Awaiting' &&
                            (!isFullyAssigned(row) || !tripsMayStart(row.downpayment))
                          }
                        >
                          {STATUS_LABELS[status]}
                          {row.status === 'Awaiting' && status !== 'Awaiting' && !isFullyAssigned(row)
                            ? ` (assign ${missingForDispatch(row)} first)`
                            : row.status === 'Awaiting' && status !== 'Awaiting' && !tripsMayStart(row.downpayment)
                              ? ' (downpayment first)'
                              : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`border px-2 py-1 text-xs font-semibold tracking-[0.03em] uppercase ${
                        STATUS_SELECT_STYLES[row.status] ?? 'border-neutral-300 text-neutral-600'
                      }`}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  )}
                  {row.status === 'Awaiting' && row.downpayment && !tripsMayStart(row.downpayment) && (
                    <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      Awaiting downpayment — {formatMoney(row.downpayment.missing)} to go
                      <span className="block font-normal">
                        {formatMoney(row.downpayment.paid)} of {formatMoney(row.downpayment.required)} paid
                      </span>
                    </span>
                  )}
                  {row.status === 'Awaiting' && row.downpayment?.waived && !row.downpayment.met && (
                    <span className="text-[11px] font-medium text-neutral-500">Downpayment waived by Admin</span>
                  )}
                  {/* Same as picking Delivered in the dropdown -- opens
                  MarkDeliveredModal, where damage is recorded. */}
                  {canEditStatus && !readOnly && row.status === 'InTransit' && (
                    <button
                      type="button"
                      onClick={() => onStatusChange(row.itinerary_id, row.status, 'Delivered')}
                      disabled={savingId === row.itinerary_id}
                      className="text-left text-xs font-semibold text-accent-700 underline hover:text-accent-900"
                    >
                      Mark delivered
                    </button>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                {readOnly ? (
                  <span className="text-xs text-reports-ink">{row.assigned_driver_name ?? '—'}</span>
                ) : (
                  <CrewSelect
                    row={row}
                    crewRole="Driver"
                    people={drivers}
                    allRows={allRows}
                    leaveByEmployee={leaveByEmployee}
                    now={now}
                    disabled={savingId === row.itinerary_id}
                    onChange={(id) => onCrewChange(row.itinerary_id, 'Driver', row.assigned_employee_id, id)}
                  />
                )}
              </td>
              <td className="px-4 py-3">
                {readOnly ? (
                  <span className="text-xs text-reports-ink">{row.assigned_helper_name ?? '—'}</span>
                ) : (
                  <CrewSelect
                    row={row}
                    crewRole="Helper"
                    people={helpers}
                    allRows={allRows}
                    leaveByEmployee={leaveByEmployee}
                    now={now}
                    disabled={savingId === row.itinerary_id}
                    onChange={(id) => onCrewChange(row.itinerary_id, 'Helper', row.assigned_helper_employee_id, id)}
                  />
                )}
              </td>
              <td className="px-4 py-3">
                {readOnly ? (
                  <span className="text-xs text-reports-ink">{row.plate_number ?? '—'}</span>
                ) : (
                  <select
                    value={row.plate_number ?? ''}
                    disabled={savingId === row.itinerary_id}
                    onChange={(e) => onTruckChange(row.itinerary_id, row.plate_number, e.target.value || null)}
                    className="w-full min-w-36 border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {trucks.map((truck) => {
                      const hint = vehicleHint(
                        row,
                        allRows,
                        truck,
                        (r) => r.plate_number === truck.plate_number,
                      )
                      return (
                        <option key={truck.plate_number} value={truck.plate_number} disabled={hint?.blocked ?? false}>
                          {truck.plate_number}
                          {hint ? ` (${hint.label})` : ''}
                        </option>
                      )
                    })}
                  </select>
                )}
              </td>
              <td className="px-4 py-3">
                {readOnly ? (
                  <span className="text-xs text-reports-ink">{row.trailer_id === null ? '—' : (trailers.find((t) => t.trailer_id === row.trailer_id)?.plate_number ?? `#${row.trailer_id}`)}</span>
                ) : (
                  <select
                    value={row.trailer_id ?? ''}
                    disabled={savingId === row.itinerary_id}
                    onChange={(e) =>
                      onTrailerChange(
                        row.itinerary_id,
                        row.trailer_id,
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                    className="w-full min-w-36 border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {/* Only trailers of the type the booking asked for (when it asked for one) */}
                    {trailers
                      .filter((t) => !row.required_trailer_type || t.trailer_type === row.required_trailer_type)
                      .map((trailer) => {
                      const hint = vehicleHint(
                        row,
                        allRows,
                        trailer,
                        (r) => r.trailer_id === trailer.trailer_id,
                      )
                      return (
                        <option key={trailer.trailer_id} value={trailer.trailer_id} disabled={hint?.blocked ?? false}>
                          {trailer.plate_number ?? `#${trailer.trailer_id}`}
                          {hint ? ` (${hint.label})` : ''}
                        </option>
                      )
                    })}
                  </select>
                )}
              </td>
              <td className="px-4 py-3">
                <ActionsMenu
                  onViewLogs={() => onViewLogs(row.itinerary_id)}
                  // Same conditions the old inline "Request correction"
                  // button used; a pending request shows as a disabled item.
                  correction={
                    canEditStatus && !canFreelyEditStatus && row.status !== 'Awaiting'
                      ? {
                          pending: pendingCorrectionIds.has(row.itinerary_id),
                          onRequest: () => onRequestCorrection(row),
                        }
                      : null
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
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
    const { data: itineraryRows, error: itineraryError } = await supabase
      .from('itineraries')
      .select(
        'itinerary_id, booking_id, trip_date_from, trip_date_to, trip_start_at, trip_end_at, place_of_pickup_id, place_of_delivery_id, itinerary_status, plate_number, trailer_id',
      )
      .neq('itinerary_status', 'Cancelled')
      .order('trip_date_from', { ascending: false })

    if (itineraryError) {
      setError(itineraryError.message)
      setLoading(false)
      return
    }

    // Trucks/trailers to populate the assignment dropdowns -- needed
    // even when there are no active itineraries yet, so load them
    // regardless.
    const [trucksResult, trailersResult, startSettingResult] = await Promise.all([
      supabase.from('truck_profiles').select('plate_number, current_status').order('plate_number'),
      supabase.from('trailers').select('trailer_id, plate_number, trailer_type, current_status').order('trailer_id'),
      supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'default_trip_start_time')
        .maybeSingle(),
    ])
    // Missing setting just keeps the 6 AM fallback.
    if (startSettingResult.data) setDefaultStartMinutes(Number(startSettingResult.data.setting_value))

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
    const { data: bookingTypeRows, error: bookingTypeError } = await supabase
      .from('bookings')
      .select('booking_id, trailer_type, hours_per_trip, rate_of_delivery_service, cost_per_trip, amount_paid, downpayment_waived_at')
      .in('booking_id', bookingIds)
    if (bookingTypeError) {
      setError(bookingTypeError.message)
      setLoading(false)
      return
    }
    const trailerTypeByBooking = new Map(
      bookingTypeRows.map((b) => [b.booking_id as number, b.trailer_type as string | null]),
    )
    const hoursPerTripByBooking = new Map(
      bookingTypeRows.map((b) => [b.booking_id as number, b.hours_per_trip as number | null]),
    )
    // Downpayment per booking: trips = its non-cancelled itineraries (the
    // board already loads exactly those).
    const tripCountByBooking = new Map<number, number>()
    itineraryRows.forEach((it) =>
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
      supabase.from('places').select('place_id, place_name').in('place_id', placeIds),
      supabase
        .from('itinerary_crews')
        .select('itinerary_id, employee_id, crew_role')
        .in('crew_role', ['Driver', 'Helper'])
        .eq('is_active', true)
        .in('itinerary_id', itineraryIds),
      supabase
        .from('users')
        .select('employee_id')
        .eq('user_role', 'Driver')
        .not('employee_id', 'is', null),
      supabase
        .from('users')
        .select('employee_id')
        .eq('user_role', 'Helper')
        .not('employee_id', 'is', null),
      loadApprovedLeave(toManilaDate(new Date())),
    ])

    if (leaveResult.error) {
      setError(leaveResult.error)
      setLoading(false)
      return
    }
    setLeaveByEmployee(leaveResult.byEmployee)

    if (placesResult.error) {
      setError(placesResult.error.message)
      setLoading(false)
      return
    }
    if (crewResult.error) {
      setError(crewResult.error.message)
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
      placesResult.data.map((p) => [p.place_id, p.place_name]),
    )
    const assignedDriverIdByItinerary = new Map(
      crewResult.data
        .filter((c) => c.crew_role === 'Driver')
        .map((c) => [c.itinerary_id, c.employee_id as number]),
    )
    const assignedHelperIdByItinerary = new Map(
      crewResult.data
        .filter((c) => c.crew_role === 'Helper')
        .map((c) => [c.itinerary_id, c.employee_id as number]),
    )

    // 3. Employee names, for every assignable driver plus whoever's
    // currently assigned (in case their `users` role ever changed).
    const employeeIds = new Set<number>(
      driverUsersResult.data.map((u) => u.employee_id as number),
    )
    helperUsersResult.data.forEach((u) => employeeIds.add(u.employee_id as number))
    crewResult.data.forEach((c) => employeeIds.add(c.employee_id as number))

    const [employeesResult, statusesResult] = await Promise.all([
      employeeIds.size > 0
        ? supabase
            .from('employees')
            .select('employee_id, full_name, employment_status_id')
            .in('employee_id', Array.from(employeeIds))
        : Promise.resolve({
            data: [] as { employee_id: number; full_name: string; employment_status_id: number | null }[],
            error: null,
          }),
      supabase.from('employment_status').select('status_id, status_name'),
    ])

    const employeeError = employeesResult.error ?? statusesResult.error
    if (employeeError) {
      setError(employeeError.message)
      setLoading(false)
      return
    }
    const employeeRows = employeesResult.data ?? []

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
        .map((e) => ({ employee_id: e.employee_id, full_name: e.full_name }))
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
          required_trailer_type: trailerTypeByBooking.get(it.booking_id) ?? null,
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

  async function handleCrewChange(
    itineraryId: number,
    crewRole: 'Driver' | 'Helper',
    previousEmployeeId: number | null,
    newEmployeeId: number | null,
  ) {
    setSavingId(itineraryId)
    setError(null)

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
        return
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
        return
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
  ) {
    setSavingId(itineraryId)
    setError(null)

    const { error: updateError } = await supabase
      .from('itineraries')
      .update({ plate_number: plateNumber })
      .eq('itinerary_id', itineraryId)

    if (updateError) {
      setError(updateError.message)
      setSavingId(null)
      return
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
  }

  async function handleTrailerChange(
    itineraryId: number,
    previousTrailerId: number | null,
    trailerId: number | null,
  ) {
    // Guard the dropdown filter: the trailer must match what the booking asked for.
    const row = rows.find((r) => r.itinerary_id === itineraryId)
    const picked = trailers.find((t) => t.trailer_id === trailerId)
    if (row?.required_trailer_type && picked && picked.trailer_type !== row.required_trailer_type) {
      setError(`This booking needs a ${row.required_trailer_type} trailer.`)
      return
    }

    setSavingId(itineraryId)
    setError(null)

    const { error: updateError } = await supabase
      .from('itineraries')
      .update({ trailer_id: trailerId })
      .eq('itinerary_id', itineraryId)

    if (updateError) {
      setError(updateError.message)
      setSavingId(null)
      return
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
  const activeRows = visibleRows.filter((r) => r.status !== 'Delivered')
  const completedRows = visibleRows.filter((r) => r.status === 'Delivered')
  const hasFullCrew = isFullyAssigned
  const needsAssignmentRows = activeRows.filter((r) => !hasFullCrew(r))
  const assignedRows = activeRows.filter(hasFullCrew)

  const tableProps = {
    allRows: rows,
    leaveByEmployee,
    drivers,
    helpers,
    trucks,
    trailers,
    canEditStatus,
    canFreelyEditStatus,
    savingId,
    onStatusChange: handleStatusChange,
    onRequestCorrection: handleRequestCorrection,
    pendingCorrectionIds: new Set(
      myRequests.filter((r) => r.status === 'Pending').map((r) => r.itinerary_id),
    ),
    onCrewChange: handleCrewChange,
    onTruckChange: handleTruckChange,
    onTrailerChange: handleTrailerChange,
    onViewLogs: setLogsItineraryId,
    now,
    onEditTime: setEditTimeRow,
  }

  const tabs = [
    { id: 'needs', label: 'Needs Assignment', rows: needsAssignmentRows, empty: 'Nothing waiting on a driver, truck, or trailer.' },
    { id: 'assigned', label: 'Assigned — In Progress', rows: assignedRows, empty: 'No fully-crewed trips in progress.' },
    { id: 'completed', label: 'Completed', rows: completedRows, empty: 'No delivered trips yet.' },
  ] as const
  const activeTab = tabs.find((t) => t.id === tab) ?? tabs[0]

  return (
    <div>
      <PageHeader
        title="Dispatch Board"
        subtitle="Assign drivers, helpers, trucks and trailers, and track each booking through delivery."
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Booking #, place, driver, helper or plate"
          aria-label="Search trips"
          className="min-w-0 flex-1 border border-reports-hairline bg-transparent px-3 py-1.5 font-ui text-sm text-reports-ink focus:border-accent-500 focus:outline-none sm:max-w-sm"
        />
        {/* Drivers move trips from their phones -- reload to see it. */}
        <button
          type="button"
          onClick={() => {
            loadDispatchBoard()
            if (isDispatcher(role) && employeeId) loadMyRequests(employeeId)
          }}
          disabled={loading}
          className="border border-reports-hairline px-3 py-1.5 font-ui text-sm font-medium text-reports-ink hover:border-accent-500 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="mt-4 border border-red-200 bg-red-50 px-4 py-3 font-ui text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 font-ui text-neutral-500">Loading dispatch board...</p>
      ) : rows.length === 0 ? (
        <EmptyState message="No trips right now." className="mt-4" />
      ) : visibleRows.length === 0 ? (
        <p className="mt-4 font-ui text-neutral-500">
          No trips match "{search}".{' '}
          <button
            type="button"
            onClick={() => setSearch('')}
            className="font-medium text-accent-700 underline hover:text-accent-900"
          >
            Clear search
          </button>
        </p>
      ) : (
        // One table at a time; the tabs switch between them.
        <div className="mt-8">
          <div role="tablist" className="flex flex-wrap gap-1 border-b border-reports-hairline">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px flex items-center gap-2 border border-b-0 px-4 py-2 font-ui text-[11px] font-semibold tracking-[0.16em] uppercase ${
                  tab === t.id
                    ? 'border-reports-hairline bg-white text-reports-ink'
                    : 'border-transparent text-neutral-500 hover:text-reports-ink'
                }`}
              >
                {t.label}
                <span className="border border-reports-hairline px-2 py-0.5 text-[11px] text-neutral-600">
                  {t.rows.length}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3">
            {activeTab.rows.length === 0 ? (
              <p className="font-ui text-sm text-neutral-500">{activeTab.empty}</p>
            ) : (
              <DispatchTable rows={activeTab.rows} {...tableProps} readOnly={tab === 'completed'} />
            )}
          </div>
        </div>
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
          // Same booking, later in trip order, not started yet.
          laterTrips={rows
            .filter(
              (r) =>
                r.booking_id === editTimeRow.booking_id &&
                r.itinerary_id > editTimeRow.itinerary_id &&
                r.status === 'Awaiting',
            )
            .sort((a, b) => a.itinerary_id - b.itinerary_id)}
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
