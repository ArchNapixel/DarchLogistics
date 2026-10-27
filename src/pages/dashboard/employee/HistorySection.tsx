// HistorySection: "My History" page for Driver/Helper/Mechanic -- past
// trips (drivers and helpers; "My Trips History", the canvas's Driver
// History board) or work orders (mechanics).
//
// Drivers/Helpers: reads real delivered/cancelled itineraries via
// itinerary_crews (same lookup pattern as DriverTasks.tsx), filtered by
// the matching crew_role, joined with places (route) and trailers (plate).
// A Status filter (All / Delivered / Cancelled), 10 per page. Clicking a
// row opens TripDetailModal (below): client, trip rate, date, route,
// truck/trailer and the expenses they logged on that trip -- loaded fresh
// when the row is opened.
// Mechanics: reads real completed/cancelled work_orders assigned to
// them, joined with trailers for the vehicle label when the work order
// is for a trailer rather than a truck (same pattern as
// MaintenanceSection.tsx). The date shown is when the job was actually
// completed (latest work_order_completions.completed_at -- a reopened job
// can have more than one), newest first; Cancelled jobs have no
// completion, so they show their scheduled date instead.
import { useEffect, useEffectEvent, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { usePaged } from '../../../lib/usePaged'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import EmptyState from '../../../components/EmptyState'
import { formatMoney, formatDate, formatSlot } from '../../../lib/format'

type HistoryStatus = 'Completed' | 'Cancelled'

// A mechanic's past work order.
type HistoryEntry = {
  history_id: number
  work_order_number: string
  vehicle: string
  maintenance_type: string
  // What the mechanic wrote at completion (null for Cancelled jobs).
  work_done: string | null
  date: string
  status: HistoryStatus
}

// A driver's / helper's past trip.
type TripRow = {
  itinerary_id: number
  booking_id: number
  when: string
  pickup: string
  delivery: string
  truck: string | null
  trailer: string | null
  status: 'Delivered' | 'Cancelled'
}

type TripDetail = {
  // From the get_trip_client_and_rate RPC -- drivers/helpers can't read
  // bookings/clients directly, the RPC returns just these two fields
  // for a trip they're on. null = couldn't be loaded.
  client_name: string | null
  rate: number | null
  booking_id: number
  route: string
  dates: string
  status: string
  truck: string | null
  trailer: string | null
  expenses: { amount: number; category: string | null; description: string }[]
}

const STATUS_FILTERS = ['All', 'Delivered', 'Cancelled'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]
const WORK_STATUS_FILTERS = ['All', 'Completed', 'Cancelled'] as const
type WorkStatusFilter = (typeof WORK_STATUS_FILTERS)[number]

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'm-0 text-[15px] leading-[22px] font-semibold text-ink'

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
          'booking_id, trip_date_from, trip_date_to, trip_start_at, trip_end_at, itinerary_status, place_of_pickup_id, place_of_delivery_id, plate_number, trailer_id',
        )
        .eq('itinerary_id', itineraryId)
        .maybeSingle()

      if (tripError || !trip) {
        setError(tripError?.message ?? 'This trip could not be found.')
        return
      }

      const [placesResult, trailerResult, expensesResult, clientRateResult] = await Promise.all([
        supabase.from('places').select('place_id, place_name').in('place_id', [trip.place_of_pickup_id, trip.place_of_delivery_id]),
        trip.trailer_id !== null
          ? supabase.from('trailers').select('plate_number').eq('trailer_id', trip.trailer_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('itinerary_expenses')
          .select('amount, category, description')
          .eq('itinerary_id', itineraryId)
          .eq('employee_id', employeeId)
          .order('created_at', { ascending: true }),
        supabase
          .rpc('get_trip_client_and_rate', { p_itinerary_id: itineraryId })
          .maybeSingle<{ client_name: string; rate_of_delivery_service: number | null }>(),
      ])

      const lookupError = placesResult.error ?? trailerResult.error ?? expensesResult.error ?? clientRateResult.error
      if (lookupError) {
        setError(lookupError.message)
        return
      }

      const placeName = new Map((placesResult.data ?? []).map((p) => [p.place_id, p.place_name]))
      const rate = clientRateResult.data?.rate_of_delivery_service
      setDetail({
        client_name: clientRateResult.data?.client_name ?? null,
        rate: rate != null ? Number(rate) : null,
        booking_id: trip.booking_id,
        route: `${placeName.get(trip.place_of_pickup_id) ?? '—'} → ${placeName.get(trip.place_of_delivery_id) ?? '—'}`,
        dates: trip.trip_start_at
          ? formatSlot(trip.trip_start_at, trip.trip_end_at)
          : trip.trip_date_to
            ? `${formatDate(trip.trip_date_from)} – ${formatDate(trip.trip_date_to)}`
            : formatDate(trip.trip_date_from),
        status: trip.itinerary_status,
        truck: trip.plate_number,
        trailer: trip.trailer_id !== null ? (trailerResult.data?.plate_number ?? `Trailer #${trip.trailer_id}`) : null,
        expenses: expensesResult.data ?? [],
      })
    }

    void load()
  }, [itineraryId, employeeId])

  const expenseTotal = (detail?.expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-detail-title"
        className="card w-full max-w-[680px]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="trip-detail-title" className="text-xl leading-7 font-bold text-ink">
              Trip #{itineraryId}
              {detail && ` · Booking #${detail.booking_id}`}
            </h2>
            {detail && <StatusBadge status={detail.status} icon />}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex flex-col gap-5 px-6 py-5">
          {error ? (
            <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          ) : !detail ? (
            <p className="text-ink-muted">Loading trip...</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 sm:grid-cols-3">
                <div>
                  <dt className={LABEL}>Client</dt>
                  <dd className={VALUE}>{detail.client_name ?? '—'}</dd>
                </div>
                <div>
                  <dt className={LABEL}>Trip rate</dt>
                  <dd className={`${VALUE} tabular-nums`}>{detail.rate !== null ? formatMoney(detail.rate) : '—'}</dd>
                </div>
                <div>
                  <dt className={LABEL}>Date</dt>
                  <dd className={VALUE}>{detail.dates}</dd>
                </div>
                <div className="col-span-full">
                  <dt className={LABEL}>Route</dt>
                  <dd className={VALUE}>{detail.route}</dd>
                </div>
                <div>
                  <dt className={LABEL}>Truck</dt>
                  <dd className={VALUE}>{detail.truck ?? '—'}</dd>
                </div>
                <div>
                  <dt className={LABEL}>Trailer</dt>
                  <dd className={VALUE}>{detail.trailer ?? '—'}</dd>
                </div>
              </dl>

              <section aria-labelledby="trip-detail-expenses">
                <h3 id="trip-detail-expenses" className="mb-1.5 border-b border-line pb-2 text-sm font-semibold text-ink">
                  Your expenses
                </h3>
                {detail.expenses.length === 0 ? (
                  <p className="py-2 text-sm text-ink-muted">None logged.</p>
                ) : (
                  <>
                    {detail.expenses.map((e, i) => (
                      <div key={i} className="grid min-h-11 grid-cols-[110px_minmax(0,1fr)_120px] items-center gap-3 border-b border-slate-200 text-sm text-ink-secondary">
                        <span>{e.category ?? '—'}</span>
                        <span>{e.description}</span>
                        <span className="text-right tabular-nums">{formatMoney(Number(e.amount))}</span>
                      </div>
                    ))}
                    <div className="grid min-h-11 grid-cols-[110px_minmax(0,1fr)_120px] items-center gap-3 text-sm font-bold text-ink">
                      <span />
                      <span>Total</span>
                      <span className="text-right tabular-nums">{formatMoney(expenseTotal)}</span>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="flex justify-end border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="btn-primary px-7 text-sm">
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}

function HistorySection() {
  const { role, employeeId } = useAuth()
  const isCrew = role === 'Driver' || role === 'Helper'
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [trips, setTrips] = useState<TripRow[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  // Mechanics: Status + Search filters over their work orders.
  const [workFilter, setWorkFilter] = useState<WorkStatusFilter>('All')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openTripId, setOpenTripId] = useState<number | null>(null)

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
      setTrips([])
      setError(null)
      setLoading(false)
      return
    }

    const { data: itineraries, error: itineraryError } = await supabase
      .from('itineraries')
      .select(
        'itinerary_id, booking_id, trip_date_from, trip_date_to, trip_start_at, trip_end_at, itinerary_status, place_of_pickup_id, place_of_delivery_id, plate_number, trailer_id',
      )
      .in('itinerary_id', itineraryIds)
      .in('itinerary_status', ['Delivered', 'Cancelled'])
      .order('trip_date_from', { ascending: false })
      .order('itinerary_id', { ascending: false })

    if (itineraryError) {
      setError(itineraryError.message)
      setLoading(false)
      return
    }

    const placeIds = Array.from(new Set(itineraries.flatMap((trip) => [trip.place_of_pickup_id, trip.place_of_delivery_id])))
    const trailerIds = Array.from(new Set(itineraries.map((t) => t.trailer_id).filter((id): id is number => id !== null)))

    const [placesResult, trailersResult] = await Promise.all([
      placeIds.length > 0
        ? supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
        : Promise.resolve({ data: [] as { place_id: number; place_name: string }[], error: null }),
      trailerIds.length > 0
        ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
        : Promise.resolve({ data: [] as { trailer_id: number; plate_number: string | null }[], error: null }),
    ])

    const lookupError = placesResult.error ?? trailersResult.error
    if (lookupError) {
      setError(lookupError.message)
      setLoading(false)
      return
    }

    const placeNameById = new Map((placesResult.data ?? []).map((place) => [place.place_id, place.place_name]))
    const trailerPlateById = new Map((trailersResult.data ?? []).map((t) => [t.trailer_id, t.plate_number]))

    setTrips(
      itineraries.map((trip) => ({
        itinerary_id: trip.itinerary_id,
        booking_id: trip.booking_id,
        when: trip.trip_start_at
          ? formatSlot(trip.trip_start_at, trip.trip_end_at)
          : formatDate(trip.trip_date_to ?? trip.trip_date_from),
        pickup: placeNameById.get(trip.place_of_pickup_id) ?? '—',
        delivery: placeNameById.get(trip.place_of_delivery_id) ?? '—',
        truck: trip.plate_number,
        trailer: trip.trailer_id !== null ? (trailerPlateById.get(trip.trailer_id) ?? `Trailer #${trip.trailer_id}`) : null,
        status: trip.itinerary_status === 'Delivered' ? 'Delivered' : 'Cancelled',
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
            .select('work_order_id, completed_at, description')
            .in('work_order_id', orders.map((o) => o.work_order_id))
        : { data: [], error: null }

    if (completionError) {
      setError(completionError.message)
      setLoading(false)
      return
    }

    // Latest completion per work order, as a timestamp (ms), and what was done.
    const completedAtById = new Map<number, number>()
    const workDoneById = new Map<number, string | null>()
    for (const c of completions) {
      const time = new Date(c.completed_at).getTime()
      if (time > (completedAtById.get(c.work_order_id) ?? 0)) {
        completedAtById.set(c.work_order_id, time)
        workDoneById.set(c.work_order_id, c.description)
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
          ? formatDate(completedAt)
          : order.scheduled_start_date
            ? formatDate(order.scheduled_start_date)
            : '—',
        work_order_number: order.work_order_number,
        vehicle: vehicleLabel,
        maintenance_type: order.maintenance_type,
        work_done: workDoneById.get(order.work_order_id) ?? null,
        status: (order.work_order_status === 'Completed' ? 'Completed' : 'Cancelled') as HistoryStatus,
      }
    })

    entries.sort((a, b) => b.sortTime - a.sortTime)
    setHistory(entries)
    setError(null)
    setLoading(false)
  }

  // Load when this opens and whenever the login (role / employeeId) changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    if (employeeId && (role === 'Driver' || role === 'Helper')) {
      void loadTripHistory(employeeId, role)
    } else if (employeeId && role === 'Mechanic') {
      void loadMechanicHistory(employeeId)
    } else {
      // No linked employee row (or a role with no history): nothing to load.
      setLoading(false)
    }
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [role, employeeId])

  const shownTrips = trips.filter((t) => statusFilter === 'All' || t.status === statusFilter)
  // One page at a time (back to page 1 when the filter changes).
  const paged = usePaged(shownTrips, statusFilter)
  const term = search.trim().toLowerCase()
  const shownWork = history.filter(
    (h) =>
      (workFilter === 'All' || h.status === workFilter) &&
      (!term || h.work_order_number.toLowerCase().includes(term) || h.vehicle.toLowerCase().includes(term)),
  )
  const pagedWork = usePaged(shownWork, `${workFilter}|${search}`)
  const filterControl =
    'min-h-11 rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric focus:border-primary'

  return (
    <div>
      <PageHeader
        title={
          role === 'Driver' ? (
            'My Trips History'
          ) : (
            <>
              My History{' '}
              {role === 'Mechanic' && (
                <span className="ml-1 rounded-[2px] bg-slate-200 px-2 py-0.5 align-middle text-xs font-semibold text-ink-secondary">View only</span>
              )}
            </>
          )
        }
        subtitle={
          role === 'Mechanic'
            ? 'Your past completed and cancelled work orders.'
            : 'Your delivered and cancelled trips. Select a trip to see its details.'
        }
        actions={
          role === 'Mechanic' ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary">
                Status
                <select value={workFilter} onChange={(e) => setWorkFilter(e.target.value as WorkStatusFilter)} className={`${filterControl} w-40`}>
                  {WORK_STATUS_FILTERS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary">
                Search
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Work order or vehicle"
                  className={`${filterControl} w-60 font-normal placeholder:text-ink-muted`}
                />
              </label>
            </div>
          ) : (
          isCrew && (
            <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary">
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="min-h-11 w-40 rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric focus:border-primary"
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          ))
        }
      />

      {loading && <p className="text-ink-muted">Loading your history...</p>}
      {error && <p className="text-red-700">{error}</p>}

      {!loading && !error && isCrew && (
        <section aria-label="Past trips" className="card flex min-h-[calc(100dvh-14rem)] flex-col">
          <div className="flex-1 overflow-x-auto">
            {shownTrips.length === 0 ? (
              <EmptyState
                message={trips.length === 0 ? 'No past trips yet.' : `No ${statusFilter.toLowerCase()} trips.`}
                className="m-5"
              />
            ) : (
              <table className="w-full min-w-[960px] text-left text-sm text-ink-metric">
                <thead>
                  <tr>
                    <th className={TH}>Trip</th>
                    <th className={TH}>Date · Time Slot</th>
                    <th className={TH}>Route</th>
                    <th className={TH}>Truck · Trailer</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((t) => (
                    <tr
                      key={t.itinerary_id}
                      onClick={() => setOpenTripId(t.itinerary_id)}
                      className="h-16 cursor-pointer border-b border-slate-200 hover:bg-slate-50"
                    >
                      <td className={`${TD} font-bold text-ink`}>
                        Trip #{t.itinerary_id} <span className="text-[13px] font-medium text-ink-muted">· Booking #{t.booking_id}</span>
                      </td>
                      <td className={TD}>{t.when}</td>
                      <td className={TD}>
                        <span className="block">{t.pickup}</span>
                        <span className="flex items-center gap-1.5 text-ink-muted">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M5 12h14 M13 6l6 6-6 6" />
                          </svg>
                          {t.delivery}
                        </span>
                      </td>
                      <td className={TD}>
                        <strong>{t.truck ?? '—'}</strong> · {t.trailer ?? '—'}
                      </td>
                      <td className={TD}>
                        <StatusBadge status={t.status} icon />
                      </td>
                      <td className={TD}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenTripId(t.itinerary_id)
                          }}
                          aria-label={`Open details for trip #${t.itinerary_id}`}
                          className="flex h-11 w-11 items-center justify-center text-primary"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
            <span>{role === 'Driver' ? 'Delivered trips are paid on your next payslip.' : `${trips.length} past trips`}</span>
            {paged.pager.pageCount > 1 && (
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                  disabled={paged.pager.page === 0}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                  disabled={paged.pager.page >= paged.pager.pageCount - 1}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  Next ›
                </button>
              </span>
            )}
          </div>
        </section>
      )}

      {!loading && !error && role === 'Mechanic' && (
        <section aria-label="Work order history" className="card flex min-h-[calc(100dvh-14rem)] flex-col">
          <div className="flex-1 overflow-x-auto">
            {shownWork.length === 0 ? (
              <EmptyState message={history.length === 0 ? 'No past work orders yet.' : 'No work orders match these filters.'} className="m-5" />
            ) : (
              <table className="w-full min-w-[960px] text-left text-sm text-ink-metric">
                <thead>
                  <tr>
                    <th className={TH}>Work Order</th>
                    <th className={TH}>Vehicle</th>
                    <th className={TH}>Maintenance Type</th>
                    <th className={TH}>Work Done</th>
                    <th className={TH}>Completed On</th>
                    <th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedWork.rows.map((entry) => (
                    <tr key={entry.history_id} className="h-[60px] border-b border-slate-200">
                      <td className={`${TD} font-semibold text-ink`}>{entry.work_order_number}</td>
                      <td className={TD}>{entry.vehicle}</td>
                      <td className={TD}>{entry.maintenance_type}</td>
                      <td className={`${TD} max-w-[320px] ${entry.work_done ? '' : 'text-ink-muted'}`}>
                        <span className="line-clamp-2" title={entry.work_done ?? undefined}>
                          {entry.work_done ?? '—'}
                        </span>
                      </td>
                      <td className={TD}>{entry.date}</td>
                      <td className={TD}>
                        <StatusBadge status={entry.status} icon />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
            <span>The date is when you actually completed the job.</span>
            {pagedWork.pager.pageCount > 1 && (
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => pagedWork.pager.onChange(pagedWork.pager.page - 1)}
                  disabled={pagedWork.pager.page === 0}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={() => pagedWork.pager.onChange(pagedWork.pager.page + 1)}
                  disabled={pagedWork.pager.page >= pagedWork.pager.pageCount - 1}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  Next ›
                </button>
              </span>
            )}
          </div>
        </section>
      )}

      {openTripId !== null && employeeId && (
        <TripDetailModal itineraryId={openTripId} employeeId={employeeId} onClose={() => setOpenTripId(null)} />
      )}
    </div>
  )
}

export default HistorySection
