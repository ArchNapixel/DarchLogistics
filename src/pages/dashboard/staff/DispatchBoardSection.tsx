// DispatchBoardSection: board of itineraries (everything but Cancelled)
// for staff to advance status and assign a driver, split into 3 tables --
// Needs Assignment (missing driver, truck, or trailer), Assigned (fully
// crewed, just not delivered yet), and Completed (status Delivered --
// previously excluded from this page entirely, now shown read-into
// instead of vanishing). Each table is newest trip date first.
//
// Status editing: Admin gets the full free-choice dropdown (any status,
// any direction) and can go backward directly. Dispatcher's dropdown
// only ever offers the current status plus whatever comes after it in
// STATUS_FLOW -- going backward (e.g. Delivered -> InTransit) isn't a
// dropdown option at all for them. Instead Dispatcher gets a "Request
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
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { isAdmin, isDispatcher } from '../../../lib/roles'
import { syncBookingStatusIfFullyDelivered } from '../../../lib/bookingStatus'
import RequestStatusRelogModal from '../../../components/RequestStatusRelogModal'
import ItineraryLogModal from './ItineraryLogModal'

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
}

type DriverOption = {
  employee_id: number
  full_name: string
}

type TruckOption = {
  plate_number: string
}

type TrailerOption = {
  trailer_id: number
  plate_number: string | null
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
// regardless of which bucket a row is in.
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
  onCrewChange,
  onTruckChange,
  onTrailerChange,
  onViewLogs,
}: {
  rows: DispatchRow[]
  drivers: DriverOption[]
  helpers: DriverOption[]
  trucks: TruckOption[]
  trailers: TrailerOption[]
  canEditStatus: boolean
  canFreelyEditStatus: boolean
  savingId: number | null
  onStatusChange: (itineraryId: number, previousStatus: string, newStatus: string) => void
  onRequestCorrection: (row: DispatchRow) => void
  onCrewChange: (
    itineraryId: number,
    crewRole: 'Driver' | 'Helper',
    previousEmployeeId: number | null,
    newEmployeeId: number | null,
  ) => void
  onTruckChange: (itineraryId: number, previousPlateNumber: string | null, plateNumber: string | null) => void
  onTrailerChange: (itineraryId: number, previousTrailerId: number | null, trailerId: number | null) => void
  onViewLogs: (itineraryId: number) => void
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
              <td className="px-4 py-3 text-reports-ink">#{row.booking_id}</td>
              <td className="px-4 py-3 text-neutral-600">
                {row.pickup_location} → {row.delivery_location}
              </td>
              <td className="px-4 py-3 text-neutral-600">
                {row.trip_date_from}
                {row.trip_date_to ? ` – ${row.trip_date_to}` : ''}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col items-start gap-1.5">
                  {canEditStatus && (
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
                        : STATUS_FLOW.slice(STATUS_FLOW.indexOf(row.status))
                      ).map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  )}
                  {canEditStatus && !canFreelyEditStatus && (
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
                  className="w-full border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {drivers.map((driver) => (
                    <option key={driver.employee_id} value={driver.employee_id}>
                      {driver.full_name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3">
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
                  className="w-full border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {helpers.map((helper) => (
                    <option key={helper.employee_id} value={helper.employee_id}>
                      {helper.full_name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3">
                <select
                  value={row.plate_number ?? ''}
                  disabled={savingId === row.itinerary_id}
                  onChange={(e) => onTruckChange(row.itinerary_id, row.plate_number, e.target.value || null)}
                  className="w-full border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {trucks.map((truck) => (
                    <option key={truck.plate_number} value={truck.plate_number}>
                      {truck.plate_number}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3">
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
                  className="w-full border border-reports-hairline bg-transparent px-2 py-1.5 text-xs text-reports-ink focus:border-accent-500 focus:outline-none"
                >
                  <option value="">Unassigned</option>
                  {trailers.map((trailer) => (
                    <option key={trailer.trailer_id} value={trailer.trailer_id}>
                      {trailer.plate_number ?? `#${trailer.trailer_id}`}
                    </option>
                  ))}
                </select>
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
  const [logsItineraryId, setLogsItineraryId] = useState<number | null>(null)
  const [rows, setRows] = useState<DispatchRow[]>([])
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [helpers, setHelpers] = useState<DriverOption[]>([])
  const [trucks, setTrucks] = useState<TruckOption[]>([])
  const [trailers, setTrailers] = useState<TrailerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)

  useEffect(() => {
    loadDispatchBoard()
  }, [])

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
      supabase.from('truck_profiles').select('plate_number').order('plate_number'),
      supabase.from('trailers').select('trailer_id, plate_number').order('trailer_id'),
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

    const { data: employeeRows, error: employeeError } =
      employeeIds.size > 0
        ? await supabase
            .from('employees')
            .select('employee_id, full_name')
            .in('employee_id', Array.from(employeeIds))
        : { data: [], error: null }

    if (employeeError) {
      setError(employeeError.message)
      setLoading(false)
      return
    }

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
        .filter((e) => driverEmployeeIds.has(e.employee_id))
        .map((e) => ({ employee_id: e.employee_id, full_name: e.full_name }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    )
    setHelpers(
      employeeRows
        .filter((e) => helperEmployeeIds.has(e.employee_id))
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
    setSavingId(itineraryId)
    setError(null)

    const { error: updateError } = await supabase
      .from('itineraries')
      .update({ itinerary_status: newStatus })
      .eq('itinerary_id', itineraryId)

    if (updateError) {
      setError(updateError.message)
      setSavingId(null)
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
    if (newStatus === 'Delivered') {
      // Trip's done -- free up whatever truck/trailer were on it. Best
      // effort: the itinerary status change itself already went through,
      // so a failure here isn't worth blocking on or alarming the user
      // over (matches the "not blocking" tone of the log-failure warning
      // just below).
      const finishedRow = rows.find((r) => r.itinerary_id === itineraryId)
      if (finishedRow?.plate_number) {
        supabase
          .from('truck_profiles')
          .update({ current_status: 'Available' })
          .eq('plate_number', finishedRow.plate_number)
          .then(({ error }) => {
            if (error) console.error('Failed to free up truck status:', error)
          })
      }
      if (finishedRow?.trailer_id) {
        supabase
          .from('trailers')
          .update({ current_status: 'Available' })
          .eq('trailer_id', finishedRow.trailer_id)
          .then(({ error }) => {
            if (error) console.error('Failed to free up trailer status:', error)
          })
      }

      // If this was the last itinerary on its booking still not
      // Delivered, flip the booking itself to Delivered too.
      syncBookingStatusIfFullyDelivered(itineraryId).then(({ error }) => {
        if (error) console.error('Failed to sync booking status:', error)
      })
    }

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
    // history row instead of deleted.
    if (previousEmployeeId !== null) {
      const { error: deactivateError } = await supabase
        .from('itinerary_crews')
        .update({ is_active: false, completed_at: new Date().toISOString() })
        .eq('itinerary_id', itineraryId)
        .eq('employee_id', previousEmployeeId)
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
        setError(
          `The previous ${crewRole.toLowerCase()} was removed, but assigning the new one ` +
            `failed (${assignError.message}). This itinerary now has no ` +
            `driver assigned -- please pick one again.`,
        )
        setSavingId(null)
        setRows((prev) =>
          prev.map((r) =>
            r.itinerary_id === itineraryId
              ? { ...r, assigned_employee_id: null, assigned_driver_name: null }
              : r,
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
  // equivalent table for trucks/trailers). The fleet status sync below
  // (new truck -> "In Transit", the one it replaced -> "Available") is
  // best effort, same reasoning as the Delivered handling above.
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

    setSavingId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }

    if (plateNumber) {
      supabase
        .from('truck_profiles')
        .update({ current_status: 'In Transit' })
        .eq('plate_number', plateNumber)
        .then(({ error }) => {
          if (error) console.error('Failed to update truck status:', error)
        })
    }
    if (previousPlateNumber && previousPlateNumber !== plateNumber) {
      supabase
        .from('truck_profiles')
        .update({ current_status: 'Available' })
        .eq('plate_number', previousPlateNumber)
        .then(({ error }) => {
          if (error) console.error('Failed to free up truck status:', error)
        })
    }

    setRows((prev) =>
      prev.map((r) =>
        r.itinerary_id === itineraryId ? { ...r, plate_number: plateNumber } : r,
      ),
    )
  }

  async function handleTrailerChange(
    itineraryId: number,
    previousTrailerId: number | null,
    trailerId: number | null,
  ) {
    setSavingId(itineraryId)
    setError(null)

    const { error: updateError } = await supabase
      .from('itineraries')
      .update({ trailer_id: trailerId })
      .eq('itinerary_id', itineraryId)

    setSavingId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }

    if (trailerId !== null) {
      supabase
        .from('trailers')
        .update({ current_status: 'In Transit' })
        .eq('trailer_id', trailerId)
        .then(({ error }) => {
          if (error) console.error('Failed to update trailer status:', error)
        })
    }
    if (previousTrailerId !== null && previousTrailerId !== trailerId) {
      supabase
        .from('trailers')
        .update({ current_status: 'Available' })
        .eq('trailer_id', previousTrailerId)
        .then(({ error }) => {
          if (error) console.error('Failed to free up trailer status:', error)
        })
    }

    setRows((prev) =>
      prev.map((r) =>
        r.itinerary_id === itineraryId ? { ...r, trailer_id: trailerId } : r,
      ),
    )
  }

  const activeRows = rows.filter((r) => r.status !== 'Delivered')
  const completedRows = rows.filter((r) => r.status === 'Delivered')
  const hasFullCrew = (r: DispatchRow) =>
    r.assigned_employee_id !== null && r.plate_number !== null && r.trailer_id !== null
  const needsAssignmentRows = activeRows.filter((r) => !hasFullCrew(r))
  const assignedRows = activeRows.filter(hasFullCrew)

  const tableProps = {
    drivers,
    helpers,
    trucks,
    trailers,
    canEditStatus,
    canFreelyEditStatus,
    savingId,
    onStatusChange: handleStatusChange,
    onRequestCorrection: setRelogRequestRow,
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

      {error && (
        <p className="mt-4 border border-red-200 bg-red-50 px-4 py-3 font-ui text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 font-ui text-neutral-500">Loading dispatch board...</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 font-ui text-neutral-500">No trips right now.</p>
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
            </div>
            {completedRows.length === 0 ? (
              <p className="mt-2 font-ui text-sm text-neutral-500">No delivered trips yet.</p>
            ) : (
              <div className="mt-2">
                <DispatchTable rows={completedRows} {...tableProps} />
              </div>
            )}
          </div>
        </>
      )}

      {relogRequestRow && employeeId && (
        <RequestStatusRelogModal
          targetType="itinerary"
          itineraryId={relogRequestRow.itinerary_id}
          currentStatus={relogRequestRow.status}
          statusOptions={STATUS_FLOW.filter((status) => status !== relogRequestRow.status)}
          employeeId={employeeId}
          onClose={() => setRelogRequestRow(null)}
          onRequested={() => setRelogRequestRow(null)}
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
