import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { rangeStartManila } from '../../lib/expenseTotals'
import MaintenanceExpensesCard from './staff/MaintenanceExpensesCard'
import OperationalExpensesCard from './staff/OperationalExpensesCard'

const ACTIVE_WORK_ORDER_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']

// Outlined, square-cornered badges (mono accent ramp only, no rainbow
// fills) to match the blueprint card style -- text color is the only
// thing that varies per status, darker as a trip gets closer to done.
const ITINERARY_STATUS_STYLES: Record<string, string> = {
  Awaiting: 'border-neutral-300 text-neutral-500',
  Dispatched: 'border-accent-300 text-accent-500',
  PickedUp: 'border-accent-500 text-accent-700',
  InTransit: 'border-accent-700 text-accent-700',
  Delivered: 'border-accent-900 text-accent-900',
  Cancelled: 'border-red-300 text-red-700',
}

function ItineraryStatusBadge({ status }: { status: string }) {
  const styles = ITINERARY_STATUS_STYLES[status] ?? 'border-neutral-300 text-neutral-500'
  return (
    <span
      className={`rounded-full border px-2.5 py-1 font-ui text-[11px] font-semibold tracking-[0.05em] uppercase ${styles}`}
    >
      {status}
    </span>
  )
}

// The period dropdown. Each `period` is one fixed object so the expense
// cards (which reload when it changes) don't reload on every render.
const REVENUE_RANGES = [
  { value: '1D', label: 'Today', period: { days: 1 } },
  { value: '1W', label: '1 Week', period: { days: 7 } },
  { value: '2W', label: '2 Weeks', period: { days: 14 } },
  { value: '1M', label: '1 Month', period: { months: 1 } },
  { value: '3M', label: '3 Months', period: { months: 3 } },
  { value: '6M', label: '6 Months', period: { months: 6 } },
  { value: '1Y', label: '1 Year', period: { months: 12 } },
] as const

type TodayDelivery = {
  itinerary_id: number
  from: string
  to: string
  rate: number | null
  truckPlateNumber: string | null
  trailerPlateNumber: string | null
  status: string
}

function StaffDashboard() {
  const { username } = useAuth()
  const [summary, setSummary] = useState({
    pendingQuotes: 0,
    activeBookings: 0,
    todayDeliveries: 0,
    truckCount: 0,
    trailerCount: 0,
    trucksOperational: 0,
    trailersOperational: 0,
    underMaintenance: 0,
  })
  const [loading, setLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [revenueRange, setRevenueRange] =
    useState<(typeof REVENUE_RANGES)[number]['value']>('1M')
  // Bumped by the Refresh button; revenue and both cost cards reload on change.
  const [refreshKey, setRefreshKey] = useState(0)
  const rangePeriod = REVENUE_RANGES.find((r) => r.value === revenueRange)!.period
  const [revenue, setRevenue] = useState(0)
  const [revenueLoading, setRevenueLoading] = useState(true)
  const [revenueError, setRevenueError] = useState<string | null>(null)
  const [todayDeliveryRows, setTodayDeliveryRows] = useState<TodayDelivery[]>([])
  const [todayDeliveriesLoading, setTodayDeliveriesLoading] = useState(true)
  const [todayDeliveriesError, setTodayDeliveriesError] = useState<string | null>(
    null,
  )

  useEffect(() => {
    async function loadSummary() {
      try {
        const today = new Date().toISOString().slice(0, 10)

        const [quotes, bookings, deliveries, trucks, trailers, activeWorkOrders] =
          await Promise.all([
            supabase
              .from('quote_requests')
              .select('quote_request_id', { count: 'exact', head: true })
              .eq('request_status', 'Pending'),
            supabase
              .from('bookings')
              .select('booking_id', { count: 'exact', head: true })
              .in('booking_status', ['Confirmed', 'InProgress']),
            supabase
              .from('itineraries')
              .select('itinerary_id', { count: 'exact', head: true })
              .eq('trip_date_from', today),
            supabase
              .from('truck_profiles')
              .select('plate_number', { count: 'exact', head: true }),
            supabase
              .from('trailers')
              .select('trailer_id', { count: 'exact', head: true }),
            supabase
              .from('work_orders')
              .select('plate_number, trailer_id')
              .in('work_order_status', ACTIVE_WORK_ORDER_STATUSES),
          ])

        if (
          quotes.error ||
          bookings.error ||
          deliveries.error ||
          trucks.error ||
          trailers.error ||
          activeWorkOrders.error
        ) {
          const firstError =
            quotes.error ??
            bookings.error ??
            deliveries.error ??
            trucks.error ??
            trailers.error ??
            activeWorkOrders.error!
          console.error('Failed to load dashboard summary', firstError)
          setSummaryError(
            `Couldn't load the dashboard summary (${firstError.message}). Try refreshing the page.`,
          )
          return
        }

        setSummaryError(null)

        // A truck/trailer can have more than one active work order -- count
        // distinct vehicles, not distinct work orders.
        const trucksUnderMaintenance = new Set(
          activeWorkOrders.data
            .filter((w) => w.plate_number)
            .map((w) => w.plate_number),
        ).size
        const trailersUnderMaintenance = new Set(
          activeWorkOrders.data
            .filter((w) => w.trailer_id)
            .map((w) => w.trailer_id),
        ).size

        const truckCount = trucks.count ?? 0
        const trailerCount = trailers.count ?? 0

        setSummary({
          pendingQuotes: quotes.count ?? 0,
          activeBookings: bookings.count ?? 0,
          todayDeliveries: deliveries.count ?? 0,
          truckCount,
          trailerCount,
          trucksOperational: truckCount - trucksUnderMaintenance,
          trailersOperational: trailerCount - trailersUnderMaintenance,
          underMaintenance: trucksUnderMaintenance + trailersUnderMaintenance,
        })
      } catch (error) {
        console.error('Failed to load dashboard summary', error)
        setSummaryError(
          "Couldn't load the dashboard summary. Try refreshing the page.",
        )
      } finally {
        setLoading(false)
      }
    }

    loadSummary()
  }, [])

  useEffect(() => {
    async function loadRevenue() {
      setRevenueLoading(true)

      // Same Manila-time start date the expense cards use, so all three agree.
      const cutoffDate = rangeStartManila(
        REVENUE_RANGES.find((r) => r.value === revenueRange)!.period,
      )

      // Cash actually collected (amount_paid), not rate x deliveries --
      // Financial Records (FinancialSection.tsx) can record payment
      // ahead of delivery (e.g. "Paid Full" against the whole contract),
      // so this tracks real money in hand rather than earned-on-delivery
      // revenue. amount_paid is written directly by that page; nothing
      // here needs the itineraries table at all.
      const { data: bookingRows, error: bookingError } = await supabase
        .from('bookings')
        .select('amount_paid')
        .neq('booking_status', 'Cancelled')
        .gte('booking_date', cutoffDate)

      if (bookingError) {
        console.error('Failed to load revenue', bookingError)
        setRevenueError(`Couldn't load revenue (${bookingError.message}).`)
        setRevenueLoading(false)
        return
      }

      setRevenueError(null)
      setRevenue(
        bookingRows.reduce((sum, booking) => sum + (booking.amount_paid ?? 0), 0),
      )
      setRevenueLoading(false)
    }

    loadRevenue()
  }, [revenueRange, refreshKey])

  useEffect(() => {
    async function loadTodayDeliveries() {
      setTodayDeliveriesLoading(true)

      const today = new Date().toISOString().slice(0, 10)

      const { data: itineraryRows, error: itineraryError } = await supabase
        .from('itineraries')
        .select(
          'itinerary_id, booking_id, place_of_pickup_id, place_of_delivery_id, itinerary_status, plate_number, trailer_id',
        )
        .eq('trip_date_from', today)

      if (itineraryError) {
        console.error('Failed to load today\'s deliveries', itineraryError)
        setTodayDeliveriesError(
          `Couldn't load today's deliveries (${itineraryError.message}).`,
        )
        setTodayDeliveriesLoading(false)
        return
      }

      if (itineraryRows.length === 0) {
        setTodayDeliveryRows([])
        setTodayDeliveriesError(null)
        setTodayDeliveriesLoading(false)
        return
      }

      const placeIds = Array.from(
        new Set(
          itineraryRows.flatMap((row) => [
            row.place_of_pickup_id,
            row.place_of_delivery_id,
          ]),
        ),
      )
      const bookingIds = Array.from(
        new Set(itineraryRows.map((row) => row.booking_id)),
      )

      const trailerIds = Array.from(
        new Set(
          itineraryRows
            .map((row) => row.trailer_id)
            .filter((id): id is number => id !== null),
        ),
      )

      const [placesResult, bookingsResult, trailersResult] = await Promise.all([
        supabase.from('places').select('place_id, place_name').in('place_id', placeIds),
        supabase
          .from('bookings')
          .select('booking_id, rate_of_delivery_service')
          .in('booking_id', bookingIds),
        trailerIds.length > 0
          ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
          : Promise.resolve({ data: [], error: null }),
      ])

      if (placesResult.error || bookingsResult.error || trailersResult.error) {
        const combinedError =
          placesResult.error ?? bookingsResult.error ?? trailersResult.error!
        console.error('Failed to load today\'s deliveries', combinedError)
        setTodayDeliveriesError(
          `Couldn't load today's deliveries (${combinedError.message}).`,
        )
        setTodayDeliveriesLoading(false)
        return
      }

      setTodayDeliveriesError(null)

      const placeNameById = new Map(
        placesResult.data.map((p) => [p.place_id, p.place_name]),
      )
      const rateByBookingId = new Map(
        bookingsResult.data.map((b) => [b.booking_id, b.rate_of_delivery_service]),
      )
      const trailerPlateById = new Map(
        trailersResult.data.map((t) => [t.trailer_id, t.plate_number]),
      )

      setTodayDeliveryRows(
        itineraryRows.map((row) => ({
          itinerary_id: row.itinerary_id,
          from: placeNameById.get(row.place_of_pickup_id) ?? '—',
          to: placeNameById.get(row.place_of_delivery_id) ?? '—',
          rate: rateByBookingId.get(row.booking_id) ?? null,
          truckPlateNumber: row.plate_number,
          trailerPlateNumber:
            row.trailer_id !== null
              ? trailerPlateById.get(row.trailer_id) ?? `#${row.trailer_id}`
              : null,
          status: row.itinerary_status ?? 'Awaiting',
        })),
      )
      setTodayDeliveriesLoading(false)
    }

    loadTodayDeliveries()
  }, [])

  const summaryCards = [
    { label: 'Pending Quotes', value: summary.pendingQuotes },
    { label: 'Active Bookings', value: summary.activeBookings },
    { label: "Today's Deliveries", value: summary.todayDeliveries },
    { label: 'Truck Count', value: summary.truckCount },
    { label: 'Trailer Count', value: summary.trailerCount },
    { label: 'Trucks Operational', value: summary.trucksOperational },
    { label: 'Trailers Operational', value: summary.trailersOperational },
    { label: 'Under Maintenance', value: summary.underMaintenance },
  ]

  return (
    <div className="bg-reports-bg -m-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-condensed text-2xl font-semibold tracking-tight text-reports-ink">
          Welcome, {username}
        </h1>
        <p className="font-ui text-sm text-neutral-500">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      </div>

      {summaryError && (
        <p className="rounded-lg mt-4 border border-red-200 bg-red-50 px-4 py-3 font-ui text-sm text-red-700">
          {summaryError}
        </p>
      )}

      <div className="reports-blueprint-card mt-8 px-[22px] pt-[22px] pb-5">
        <div className="flex items-center justify-between">
          <p className="font-ui text-sm font-medium text-neutral-500">
            Total Revenue <span className="normal-case">(collected)</span>
          </p>
          <div className="flex items-center gap-2">
            <select
              value={revenueRange}
              onChange={(e) =>
                setRevenueRange(e.target.value as (typeof REVENUE_RANGES)[number]['value'])
              }
              className="rounded-lg border border-reports-hairline px-2 py-1 font-ui text-sm text-reports-ink focus:border-accent-500 focus:outline-none"
            >
              {REVENUE_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="rounded-lg border border-reports-hairline px-2 py-1 font-ui text-sm text-reports-ink hover:border-accent-500"
            >
              Refresh
            </button>
          </div>
        </div>
        {revenueError ? (
          <p className="mt-2 font-ui text-sm text-red-700">{revenueError}</p>
        ) : (
          <p className="font-condensed mt-2 text-[40px] leading-none font-bold text-reports-ink">
            {revenueLoading ? '--' : `₱${revenue.toLocaleString()}`}
          </p>
        )}
      </div>

      {/* Costs for the same period as the revenue dropdown above. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <OperationalExpensesCard period={rangePeriod} refreshKey={refreshKey} />
        <MaintenanceExpensesCard period={rangePeriod} refreshKey={refreshKey} />
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="reports-blueprint-card px-[22px] pt-[22px] pb-5">
            <p className="font-ui text-base text-reports-ink">{card.label}</p>
            <p className="font-condensed mt-2.5 text-[34px] leading-none font-semibold text-reports-ink">
              {loading ? '--' : card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="font-ui text-sm font-medium text-neutral-500">
          Today's Deliveries
        </h2>

        {todayDeliveriesLoading && (
          <p className="mt-3 font-ui text-neutral-500">Loading today's deliveries...</p>
        )}
        {!todayDeliveriesLoading && todayDeliveriesError && (
          <p className="mt-3 font-ui text-red-700">{todayDeliveriesError}</p>
        )}
        {!todayDeliveriesLoading &&
          !todayDeliveriesError &&
          todayDeliveryRows.length === 0 && (
            <p className="mt-3 font-ui text-neutral-500">
              No deliveries scheduled for today.
            </p>
          )}

        {!todayDeliveriesLoading && todayDeliveryRows.length > 0 && (
          <div className="rounded-lg mt-3 max-h-96 overflow-y-auto overflow-x-auto border border-reports-hairline bg-reports-bg">
            <table className="w-full text-left font-ui text-sm">
              <thead className="sticky top-0 border-b border-reports-hairline bg-reports-bg text-[11px] tracking-[0.1em] text-neutral-500 uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">From</th>
                  <th className="px-4 py-3 font-medium">To</th>
                  <th className="px-4 py-3 font-medium">Rate</th>
                  <th className="px-4 py-3 font-medium">Truck Assigned</th>
                  <th className="px-4 py-3 font-medium">Trailer Assigned</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {todayDeliveryRows.map((row) => (
                  <tr
                    key={row.itinerary_id}
                    className="border-b border-reports-hairline last:border-0"
                  >
                    <td className="px-4 py-3 text-reports-ink">{row.from}</td>
                    <td className="px-4 py-3 text-neutral-600">{row.to}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      {row.rate != null ? `₱${row.rate.toLocaleString()}` : 'N/A'}
                    </td>
                    <td
                      className={
                        row.truckPlateNumber
                          ? 'px-4 py-3 text-neutral-600'
                          : 'px-4 py-3 text-neutral-400'
                      }
                    >
                      {row.truckPlateNumber ?? 'Unassigned'}
                    </td>
                    <td
                      className={
                        row.trailerPlateNumber
                          ? 'px-4 py-3 text-neutral-600'
                          : 'px-4 py-3 text-neutral-400'
                      }
                    >
                      {row.trailerPlateNumber ?? 'Unassigned'}
                    </td>
                    <td className="px-4 py-3">
                      <ItineraryStatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default StaffDashboard
