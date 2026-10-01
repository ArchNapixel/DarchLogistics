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
// can't leave Awaiting without a truck, and picking "Delivered" opens
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
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate } from '../../../lib/quoteRequest'
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

type DispatchRow = {
  itinerary_id: number
  booking_id: number
  pickup_location: string
  delivery_location: string
  trip_date_from: string
  trip_date_to: string | null
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

// " (on booking #X)" after a driver/helper already on another active
// trip -- a hint only, they can still be picked.
function crewHint(row: DispatchRow, rows: DispatchRow[], isOnRow: (r: DispatchRow) => boolean) {
  if (isOnRow(row)) return ''
  const otherTrip = rows.find((r) => r !== row && r.status !== 'Delivered' && isOnRow(r))
  return otherTrip ? ` (on booking #${otherTrip.booking_id})` : ''
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
}: {
  rows: DispatchRow[]
  allRows: DispatchRow[]
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
              Trip Date
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
              Logs
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
              <td className="whitespace-nowrap px-4 py-3 text-neutral-600">
                {formatDate(row.trip_date_from)}
                {row.trip_date_to ? ` – ${formatDate(row.trip_date_to)}` : ''}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col items-start gap-1.5">
                  {canEditStatus && (!readOnly || canFreelyEditStatus) ? (
                    <select
                      value={row.status}
                      disabled={savingId === row.itinerary_id}
                      onChange={(e) => onStatusChange(row.itinerary_id, row.status, e.target.value)}
                      className={`border px-2 py-1 text-xs font-semibold tracking-[0.03em] uppercase focus:outline-none ${
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
                          // leave Awaiting without a truck on it.
                          disabled={row.status === 'Awaiting' && status !== 'Awaiting' && !row.plate_number}
                        >
                          {STATUS_LABELS[status]}
                          {row.status === 'Awaiting' && status !== 'Awaiting' && !row.plate_number
                            ? ' (assign truck first)'
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
                  {canEditStatus &&
                    !canFreelyEditStatus &&
                    row.status !== 'Awaiting' &&
                    pendingCorrectionIds.has(row.itinerary_id) && (
                      <span className="text-xs text-neutral-500">Correction pending</span>
                    )}
                  {canEditStatus &&
                    !canFreelyEditStatus &&
                    row.status !== 'Awaiting' &&
                    !pendingCorrectionIds.has(row.itinerary_id) && (
                    <button
                      type="button"
                      onClick={() => onRequestCorrection(row)}
                      className="text-left text-xs font-medium text-neutral-500 underline hover:text-neutral-700"
                    >
                      Request correction
                    </button>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                {readOnly ? (
                  <span className="text-xs text-reports-ink">{row.assigned_driver_name ?? '—'}</span>
                ) : (
                  <select
                    value={row.assigned_employee_id ?? ''}
                    disabled={savingId === row.itinerary_id}
                    onChange={(e) =>
                      onCrewChange(
                        row.itinerary_id,
                        'Driver',
                        row.assigned_employee_id,
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                    className="w-full min-w-36 border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((driver) => (
                      <option key={driver.employee_id} value={driver.employee_id}>
                        {driver.full_name}
                        {crewHint(row, allRows, (r) => r.assigned_employee_id === driver.employee_id)}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td className="px-4 py-3">
                {readOnly ? (
                  <span className="text-xs text-reports-ink">{row.assigned_helper_name ?? '—'}</span>
                ) : (
                  <select
                    value={row.assigned_helper_employee_id ?? ''}
                    disabled={savingId === row.itinerary_id}
                    onChange={(e) =>
                      onCrewChange(
                        row.itinerary_id,
                        'Helper',
                        row.assigned_helper_employee_id,
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                    className="w-full min-w-36 border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {helpers.map((helper) => (
                      <option key={helper.employee_id} value={helper.employee_id}>
                        {helper.full_name}
                        {crewHint(row, allRows, (r) => r.assigned_helper_employee_id === helper.employee_id)}
                      </option>
                    ))}
                  </select>
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
                <button
                  type="button"
                  onClick={() => onViewLogs(row.itinerary_id)}
                  className="text-xs font-medium text-accent-700 underline hover:text-accent-900"
                >
                  Logs
                </button>
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
  const [showCompleted, setShowCompleted] = useState(false)
  const [logsItineraryId, setLogsItineraryId] = useState<number | null>(null)
  const [rows, setRows] = useState<DispatchRow[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [helpers, setHelpers] = useState<DriverOption[]>([])
  const [trucks, setTrucks] = useState<TruckOption[]>([])
  const [trailers, setTrailers] = useState<TrailerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [myRequests, setMyRequests] = useState<MyItineraryRelogRequest[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadDispatchBoard()
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
        'itinerary_id, booking_id, trip_date_from, trip_date_to, place_of_pickup_id, place_of_delivery_id, itinerary_status, plate_number, trailer_id',
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
    const [trucksResult, trailersResult] = await Promise.all([
      supabase.from('truck_profiles').select('plate_number, current_status').order('plate_number'),
      supabase.from('trailers').select('trailer_id, plate_number, trailer_type, current_status').order('trailer_id'),
    ])

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
      .select('booking_id, trailer_type')
      .in('booking_id', bookingIds)
    if (bookingTypeError) {
      setError(bookingTypeError.message)
      setLoading(false)
      return
    }
    const trailerTypeByBooking = new Map(
      bookingTypeRows.map((b) => [b.booking_id as number, b.trailer_type as string | null]),
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
    const [placesResult, crewResult, driverUsersResult, helperUsersResult] = await Promise.all([
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
    ])

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
        setError(
          `The previous ${role} was removed, but assigning the new one ` +
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
  const hasFullCrew = (r: DispatchRow) =>
    r.assigned_employee_id !== null && r.plate_number !== null && r.trailer_id !== null
  const needsAssignmentRows = activeRows.filter((r) => !hasFullCrew(r))
  const assignedRows = activeRows.filter(hasFullCrew)

  const tableProps = {
    allRows: rows,
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
  }

  return (
    <div className="bg-reports-bg -m-6 p-6">
      <h2 className="font-condensed text-3xl font-bold tracking-[0.02em] text-reports-ink uppercase">
        Dispatch Board
      </h2>
      <p className="mt-1 font-ui text-sm text-neutral-500">
        Assign drivers, helpers, trucks and trailers, and track each booking through delivery.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
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
        <p className="mt-4 font-ui text-neutral-500">No trips right now.</p>
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
        <>
          <div className="mt-8">
            <div className="flex items-center gap-2">
              <h3 className="font-ui text-[11px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">
                Needs Assignment
              </h3>
              <span className="border border-reports-hairline px-2 py-0.5 font-ui text-[11px] font-semibold text-neutral-600">
                {needsAssignmentRows.length}
              </span>
            </div>
            {needsAssignmentRows.length === 0 ? (
              <p className="mt-2 font-ui text-sm text-neutral-500">
                Nothing waiting on a driver, truck, or trailer.
              </p>
            ) : (
              <div className="mt-2">
                <DispatchTable rows={needsAssignmentRows} {...tableProps} />
              </div>
            )}
          </div>

          <div className="mt-8">
            <div className="flex items-center gap-2">
              <h3 className="font-ui text-[11px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">
                Assigned — In Progress
              </h3>
              <span className="border border-reports-hairline px-2 py-0.5 font-ui text-[11px] font-semibold text-neutral-600">
                {assignedRows.length}
              </span>
            </div>
            {assignedRows.length === 0 ? (
              <p className="mt-2 font-ui text-sm text-neutral-500">
                No fully-crewed trips in progress.
              </p>
            ) : (
              <div className="mt-2">
                <DispatchTable rows={assignedRows} {...tableProps} />
              </div>
            )}
          </div>

          <div className="mt-8">
            <div className="flex items-center gap-2">
              <h3 className="font-ui text-[11px] font-semibold tracking-[0.16em] text-neutral-500 uppercase">
                Completed
              </h3>
              <span className="border border-reports-hairline px-2 py-0.5 font-ui text-[11px] font-semibold text-neutral-600">
                {completedRows.length}
              </span>
              {completedRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCompleted((shown) => !shown)}
                  aria-expanded={showCompleted}
                  className="font-ui text-xs font-medium text-accent-700 underline hover:text-accent-900"
                >
                  {showCompleted ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
            {completedRows.length === 0 ? (
              <p className="mt-2 font-ui text-sm text-neutral-500">No delivered trips yet.</p>
            ) : (
              showCompleted && (
                <div className="mt-2">
                  <DispatchTable rows={completedRows} {...tableProps} readOnly />
                </div>
              )
            )}
          </div>
        </>
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
                    {new Date(request.created_at).toLocaleDateString()}
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
