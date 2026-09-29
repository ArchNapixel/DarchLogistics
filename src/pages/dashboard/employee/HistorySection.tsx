// HistorySection: "My History" page for Driver/Helper/Mechanic -- a table
// of past trips (drivers and helpers) or work orders (mechanics).
//
// Drivers/Helpers: reads real completed/cancelled itineraries via
// itinerary_crews (same lookup pattern as DriverTasks.tsx), filtered by
// the matching crew_role, joined with places for the pickup/delivery
// names.
// Mechanics: reads real completed/cancelled work_orders assigned to
// them, joined with trailers for the vehicle label when the work order
// is for a trailer rather than a truck (same pattern as
// MaintenanceSection.tsx). The date shown is when the job was actually
// completed (latest work_order_completions.completed_at -- a reopened job
// can have more than one), newest first; Cancelled jobs have no
// completion, so they show their scheduled date instead.
//
// Drivers/Helpers can click a trip row to open TripDetailModal (below):
// route, dates, truck/trailer, and the expenses
// they logged on that trip -- loaded fresh when the row is opened.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { formatDate } from '../../../lib/quoteRequest'

type HistoryStatus = 'Completed' | 'Cancelled'

type HistoryEntry = {
  history_id: number
  date: string
  description: string
  status: HistoryStatus
}

const STATUS_STYLES: Record<HistoryStatus, string> = {
  Completed: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

function HistoryStatusBadge({ status }: { status: HistoryStatus }) {
  return (
    <span
      className={`px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

type TripDetail = {
  // From the get_trip_client_and_rate RPC -- drivers/helpers can't read
  // bookings/clients directly, the RPC returns just these two fields
  // for a trip they're on. null = couldn't be loaded.
  client_name: string | null
  rate: number | null
  route: string
  dates: string
  status: string
  truck: string | null
  trailer: string | null
  expenses: { amount: number; description: string }[]
}

function DetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{value}</span>
    </div>
  )
}

// One past trip, loaded by itinerary_id when its History row is clicked.
function TripDetailModal({
  itineraryId,
  employeeId,
  onClose,
}: {
  itineraryId: number
  employeeId: number
  onClose: () => void
}) {
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: trip, error: tripError } = await supabase
        .from('itineraries')
        .select(
          'trip_date_from, trip_date_to, itinerary_status, place_of_pickup_id, place_of_delivery_id, plate_number, trailer_id',
        )
        .eq('itinerary_id', itineraryId)
        .maybeSingle()

      if (tripError || !trip) {
        setError(tripError?.message ?? 'This trip could not be found.')
        return
      }

      const [placesResult, trailerResult, expensesResult, clientRateResult] = await Promise.all([
        supabase
          .from('places')
          .select('place_id, place_name')
          .in('place_id', [trip.place_of_pickup_id, trip.place_of_delivery_id]),
        trip.trailer_id !== null
          ? supabase.from('trailers').select('plate_number').eq('trailer_id', trip.trailer_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('itinerary_expenses')
          .select('amount, description')
          .eq('itinerary_id', itineraryId)
          .eq('employee_id', employeeId)
          .order('created_at', { ascending: true }),
        supabase
          .rpc('get_trip_client_and_rate', { p_itinerary_id: itineraryId })
          .maybeSingle<{ client_name: string; rate_of_delivery_service: number | null }>(),
      ])

      const lookupError =
        placesResult.error ??
        trailerResult.error ??
        expensesResult.error ??
        clientRateResult.error
      if (lookupError) {
        setError(lookupError.message)
        return
      }

      const placeName = new Map((placesResult.data ?? []).map((p) => [p.place_id, p.place_name]))
      const rate = clientRateResult.data?.rate_of_delivery_service
      setDetail({
        client_name: clientRateResult.data?.client_name ?? null,
        rate: rate != null ? Number(rate) : null,
        route: `${placeName.get(trip.place_of_pickup_id) ?? '—'} → ${placeName.get(trip.place_of_delivery_id) ?? '—'}`,
        dates: trip.trip_date_to
          ? `${formatDate(trip.trip_date_from)} – ${formatDate(trip.trip_date_to)}`
          : formatDate(trip.trip_date_from),
        status: trip.itinerary_status,
        truck: trip.plate_number,
        trailer:
          trip.trailer_id !== null
            ? (trailerResult.data?.plate_number ?? `Trailer #${trip.trailer_id}`)
            : null,
        expenses: expensesResult.data ?? [],
      })
    }

    void load()
  }, [itineraryId, employeeId])

  const expenseTotal = (detail?.expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Trip #{itineraryId}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : !detail ? (
          <p className="mt-4 text-slate-500">Loading trip...</p>
        ) : (
          <>
            <div className="mt-4 divide-y divide-slate-100">
              <DetailRow label="Client" value={detail.client_name ?? '—'} />
              <DetailRow
                label="Trip rate"
                value={detail.rate !== null ? `₱${detail.rate.toLocaleString()}` : '—'}
              />
              <DetailRow label="Route" value={detail.route} />
              <DetailRow label="Date" value={detail.dates} />
              <DetailRow
                label="Status"
                value={detail.status === 'Delivered' ? 'Completed' : detail.status}
              />
              <DetailRow label="Truck" value={detail.truck ?? '—'} />
              <DetailRow label="Trailer" value={detail.trailer ?? '—'} />
            </div>

            <h4 className="mt-5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Your expenses
            </h4>
            {detail.expenses.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">None logged.</p>
            ) : (
              <div className="mt-1 divide-y divide-slate-100">
                {detail.expenses.map((e, i) => (
                  <DetailRow
                    key={i}
                    label={e.description}
                    value={`₱${Number(e.amount).toLocaleString()}`}
                  />
                ))}
                <DetailRow
                  label={<span className="font-medium text-slate-700">Total</span>}
                  value={<span className="font-medium">₱{expenseTotal.toLocaleString()}</span>}
                />
              </div>
            )}
          </>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function HistorySection() {
  const { role, employeeId } = useAuth()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openTripId, setOpenTripId] = useState<number | null>(null)
  // Only trip rows (Driver/Helper) open a detail view.
  const rowsClickable = role === 'Driver' || role === 'Helper'

  useEffect(() => {
    if (!employeeId) {
      setLoading(false)
      return
    }

    if (role === 'Driver' || role === 'Helper') {
      loadTripHistory(employeeId, role)
    } else if (role === 'Mechanic') {
      loadMechanicHistory(employeeId)
    } else {
      setLoading(false)
    }
  }, [role, employeeId])

  async function loadTripHistory(crewEmployeeId: number, crewRole: 'Driver' | 'Helper') {
    setLoading(true)

    const { data: crewRows, error: crewError } = await supabase
      .from('itinerary_crews')
      .select('itinerary_id')
      .eq('employee_id', crewEmployeeId)
      .eq('crew_role', crewRole)
      // Skip trips they were reassigned off of -- they didn't do them.
      .eq('is_active', true)

    if (crewError) {
      setError(crewError.message)
      setLoading(false)
      return
    }

    const itineraryIds = crewRows.map((row) => row.itinerary_id)
    if (itineraryIds.length === 0) {
      setHistory([])
      setError(null)
      setLoading(false)
      return
    }

    const { data: itineraries, error: itineraryError } = await supabase
      .from('itineraries')
      .select(
        'itinerary_id, trip_date_from, trip_date_to, itinerary_status, place_of_pickup_id, place_of_delivery_id',
      )
      .in('itinerary_id', itineraryIds)
      .in('itinerary_status', ['Delivered', 'Cancelled'])
      .order('trip_date_from', { ascending: false })

    if (itineraryError) {
      setError(itineraryError.message)
      setLoading(false)
      return
    }

    const placeIds = Array.from(
      new Set(
        itineraries.flatMap((trip) => [
          trip.place_of_pickup_id,
          trip.place_of_delivery_id,
        ]),
      ),
    )

    const { data: places, error: placesError } =
      placeIds.length > 0
        ? await supabase
            .from('places')
            .select('place_id, place_name')
            .in('place_id', placeIds)
        : { data: [], error: null }

    if (placesError) {
      setError(placesError.message)
      setLoading(false)
      return
    }

    const placeNameById = new Map(
      places.map((place) => [place.place_id, place.place_name]),
    )

    setHistory(
      itineraries.map((trip) => ({
        history_id: trip.itinerary_id,
        date: trip.trip_date_to ?? trip.trip_date_from,
        description: `${placeNameById.get(trip.place_of_pickup_id) ?? '—'} → ${placeNameById.get(trip.place_of_delivery_id) ?? '—'}`,
        status: trip.itinerary_status === 'Delivered' ? 'Completed' : 'Cancelled',
      })),
    )
    setError(null)
    setLoading(false)
  }

  async function loadMechanicHistory(mechanicEmployeeId: number) {
    setLoading(true)

    const { data: orders, error: orderError } = await supabase
      .from('work_orders')
      .select(
        'work_order_id, work_order_number, plate_number, trailer_id, maintenance_type, work_order_status, scheduled_start_date',
      )
      .eq('assigned_mechanic_id', mechanicEmployeeId)
      .in('work_order_status', ['Completed', 'Cancelled'])
      .order('scheduled_start_date', { ascending: false })

    if (orderError) {
      setError(orderError.message)
      setLoading(false)
      return
    }

    const trailerIds = Array.from(
      new Set(orders.filter((o) => o.trailer_id != null).map((o) => o.trailer_id)),
    )

    const { data: trailers, error: trailerError } =
      trailerIds.length > 0
        ? await supabase
            .from('trailers')
            .select('trailer_id, plate_number')
            .in('trailer_id', trailerIds)
        : { data: [], error: null }

    if (trailerError) {
      setError(trailerError.message)
      setLoading(false)
      return
    }

    const trailerPlateById = new Map(
      trailers.map((t) => [t.trailer_id, t.plate_number]),
    )

    const { data: completions, error: completionError } =
      orders.length > 0
        ? await supabase
            .from('work_order_completions')
            .select('work_order_id, completed_at')
            .in('work_order_id', orders.map((o) => o.work_order_id))
        : { data: [], error: null }

    if (completionError) {
      setError(completionError.message)
      setLoading(false)
      return
    }

    // Latest completion per work order, as a timestamp (ms).
    const completedAtById = new Map<number, number>()
    for (const c of completions) {
      const time = new Date(c.completed_at).getTime()
      if (time > (completedAtById.get(c.work_order_id) ?? 0)) {
        completedAtById.set(c.work_order_id, time)
      }
    }

    const entries = orders.map((order) => {
      const vehicleLabel = order.plate_number
        ? `Truck ${order.plate_number}`
        : `Trailer ${trailerPlateById.get(order.trailer_id) ?? `#${order.trailer_id}`}`
      const completedAt = completedAtById.get(order.work_order_id)
      const sortTime =
        completedAt ??
        (order.scheduled_start_date ? new Date(order.scheduled_start_date).getTime() : 0)

      return {
        sortTime,
        history_id: order.work_order_id,
        date: completedAt
          ? new Date(completedAt).toLocaleDateString('en-PH', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : order.scheduled_start_date
            ? formatDate(order.scheduled_start_date)
            : '—',
        description: `${order.work_order_number} — ${order.maintenance_type} (${vehicleLabel})`,
        status: (order.work_order_status === 'Completed' ? 'Completed' : 'Cancelled') as HistoryStatus,
      }
    })

    entries.sort((a, b) => b.sortTime - a.sortTime)
    setHistory(entries)
    setError(null)
    setLoading(false)
  }

  const emptyMessage =
    role === 'Mechanic' ? 'No past work orders yet.' : 'No past trips yet.'

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">My History</h2>

      {loading && <p className="mt-4 text-slate-500">Loading your history...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}

      {!loading && !error && history.length === 0 ? (
        <p className="mt-4 text-slate-500">{emptyMessage}</p>
      ) : (
        !loading &&
        !error && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr
                    key={entry.history_id}
                    {...(rowsClickable && {
                      onClick: () => setOpenTripId(entry.history_id),
                      onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setOpenTripId(entry.history_id)
                        }
                      },
                      tabIndex: 0,
                      role: 'button',
                      'aria-label': `View details for ${entry.description}`,
                    })}
                    className={`border-b border-slate-100 last:border-0 ${
                      rowsClickable
                        ? 'cursor-pointer hover:bg-slate-50 focus:bg-slate-50 focus:outline-none'
                        : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-slate-600">{entry.date}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {entry.description}
                    </td>
                    <td className="px-4 py-3">
                      <HistoryStatusBadge status={entry.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {openTripId !== null && employeeId && (
        <TripDetailModal
          itineraryId={openTripId}
          employeeId={employeeId}
          onClose={() => setOpenTripId(null)}
        />
      )}
    </div>
  )
}

export default HistorySection
