import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import RoleBadge from '../../components/RoleBadge'
import { supabase } from '../../lib/supabaseClient'

const ACTIVE_WORK_ORDER_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']

const ITINERARY_STATUS_STYLES: Record<string, string> = {
  Awaiting: 'bg-gray-100 text-gray-700',
  Dispatched: 'bg-blue-100 text-blue-700',
  PickedUp: 'bg-purple-100 text-purple-700',
  InTransit: 'bg-orange-100 text-orange-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

function ItineraryStatusBadge({ status }: { status: string }) {
  const styles = ITINERARY_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

const REVENUE_RANGES = [
  { value: '1M', label: '1 Month', months: 1 },
  { value: '3M', label: '3 Months', months: 3 },
  { value: '6M', label: '6 Months', months: 6 },
  { value: '1Y', label: '1 Year', months: 12 },
] as const

function getCutoffDate(months: number) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  return cutoff.toISOString().slice(0, 10)
}

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
  const { username, role } = useAuth()
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
  const [revenueRange, setRevenueRange] =
    useState<(typeof REVENUE_RANGES)[number]['value']>('1M')
  const [revenue, setRevenue] = useState(0)
  const [revenueLoading, setRevenueLoading] = useState(true)
  const [todayDeliveryRows, setTodayDeliveryRows] = useState<TodayDelivery[]>([])
  const [todayDeliveriesLoading, setTodayDeliveriesLoading] = useState(true)

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
              .in('booking_status', ['Confirmed', 'Dispatched', 'InProgress']),
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
          console.error('Failed to load dashboard summary')
          return
        }

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
      } finally {
        setLoading(false)
      }
    }

    loadSummary()
  }, [])

  useEffect(() => {
    async function loadRevenue() {
      setRevenueLoading(true)

      const rangeInfo = REVENUE_RANGES.find((r) => r.value === revenueRange)!
      const cutoffDate = getCutoffDate(rangeInfo.months)

      const { data, error } = await supabase
        .from('bookings')
        .select('rate_of_delivery_service')
        .neq('booking_status', 'Cancelled')
        .gte('booking_date', cutoffDate)

      if (error) {
        console.error('Failed to load revenue', error)
        setRevenueLoading(false)
        return
      }

      setRevenue(
        data.reduce((sum, row) => sum + (row.rate_of_delivery_service ?? 0), 0),
      )
      setRevenueLoading(false)
    }

    loadRevenue()
  }, [revenueRange])

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
        setTodayDeliveriesLoading(false)
        return
      }

      if (itineraryRows.length === 0) {
        setTodayDeliveryRows([])
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
        console.error(
          'Failed to load today\'s deliveries',
          placesResult.error ?? bookingsResult.error ?? trailersResult.error,
        )
        setTodayDeliveriesLoading(false)
        return
      }

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
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {username}
        </h1>
        <RoleBadge role={role} />
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">Total Revenue</p>
          <select
            value={revenueRange}
            onChange={(e) =>
              setRevenueRange(e.target.value as (typeof REVENUE_RANGES)[number]['value'])
            }
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900"
          >
            {REVENUE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-3xl font-bold text-slate-900">
          {revenueLoading ? '--' : `₱${revenue.toLocaleString()}`}
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {loading ? '--' : card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-bold text-slate-900">
          Today's Deliveries
        </h2>

        {todayDeliveriesLoading && (
          <p className="mt-4 text-slate-500">Loading today's deliveries...</p>
        )}
        {!todayDeliveriesLoading && todayDeliveryRows.length === 0 && (
          <p className="mt-4 text-slate-500">
            No deliveries scheduled for today.
          </p>
        )}

        {!todayDeliveriesLoading && todayDeliveryRows.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
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
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 text-slate-900">{row.from}</td>
                    <td className="px-4 py-3 text-slate-600">{row.to}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.rate != null ? `₱${row.rate.toLocaleString()}` : 'N/A'}
                    </td>
                    <td
                      className={
                        row.truckPlateNumber
                          ? 'px-4 py-3 text-slate-600'
                          : 'px-4 py-3 text-slate-400'
                      }
                    >
                      {row.truckPlateNumber ?? 'Unassigned'}
                    </td>
                    <td
                      className={
                        row.trailerPlateNumber
                          ? 'px-4 py-3 text-slate-600'
                          : 'px-4 py-3 text-slate-400'
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
