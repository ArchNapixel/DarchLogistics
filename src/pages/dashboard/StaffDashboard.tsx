import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import RoleBadge from '../../components/RoleBadge'
import { supabase } from '../../lib/supabaseClient'

const ACTIVE_WORK_ORDER_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']

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
              .from('bookings')
              .select('booking_id', { count: 'exact', head: true })
              .eq('booking_date', today),
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
        .select('amount_to_pay')
        .neq('booking_status', 'Cancelled')
        .gte('booking_date', cutoffDate)

      if (error) {
        console.error('Failed to load revenue', error)
        setRevenueLoading(false)
        return
      }

      setRevenue(
        data.reduce((sum, row) => sum + (row.amount_to_pay ?? 0), 0),
      )
      setRevenueLoading(false)
    }

    loadRevenue()
  }, [revenueRange])

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
    </div>
  )
}

export default StaffDashboard
