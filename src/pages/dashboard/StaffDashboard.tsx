import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { rangeStartManila } from '../../lib/expenseTotals'
import { loadCashAdvanceTotals } from '../../lib/cashAdvanceRequests'
import { toManilaDate } from '../../lib/payslip'
import { loadApprovedLeave } from '../../lib/leaveRequests'
import {
  fetchAll,
  loadMaintenanceExpenses,
  loadOperationalExpenses,
  loadPayrollExpenses,
} from '../../lib/dashboardExpenses'
import TopCreditorsCard from './staff/TopCreditorsCard'
import StatusBadge from '../../components/StatusBadge'
import { formatMoney, formatSlot } from '../../lib/format'
import EmptyState from '../../components/EmptyState'

// A truck/trailer at one of these statuses (Fleet's current_status) isn't
// operational.
const NOT_OPERATIONAL = new Set(['Under Maintenance', 'Out of Service'])

// Today's deliveries = trips scheduled today that aren't Cancelled (a plain
// .neq() would drop rows whose status is still null) OR trips already on the
// road, even if they started on an earlier day.
function todaysTripsFilter(today: string) {
  return (
    `and(trip_date_from.eq.${today},itinerary_status.is.null),` +
    `and(trip_date_from.eq.${today},itinerary_status.neq.Cancelled),` +
    'itinerary_status.in.(Dispatched,PickedUp,InTransit)'
  )
}

// `page` = the name of the page `to` opens, shown after the label.
type DashboardAlert = { label: string; count: number; to: string; page: string }

// Counts of things waiting on the admin, each linking to the page that fixes
// it. Head-only count queries; a failed one counts as 0 so the strip never
// blocks the page.
async function loadAlerts(): Promise<DashboardAlert[]> {
  const nowIso = new Date().toISOString()
  const in24h = new Date(Date.now() + 24 * 3_600_000).toISOString()
  const awaiting = 'itinerary_status.is.null,itinerary_status.eq.Awaiting'
  const count = (q: PromiseLike<{ count: number | null; error: unknown }>) =>
    q.then((r) => (r.error ? 0 : (r.count ?? 0)))

  const [overdue, noTruck, maintenance, leave, cash] = await Promise.all([
    count(
      supabase
        .from('itineraries')
        .select('itinerary_id', { count: 'exact', head: true })
        .or(awaiting)
        .lt('trip_start_at', nowIso),
    ),
    count(
      supabase
        .from('itineraries')
        .select('itinerary_id', { count: 'exact', head: true })
        .or(awaiting)
        .gte('trip_start_at', nowIso)
        .lte('trip_start_at', in24h)
        .is('plate_number', null),
    ),
    count(
      supabase
        .from('maintenance_requests')
        .select('request_id', { count: 'exact', head: true })
        .eq('status', 'Pending'),
    ),
    count(
      supabase
        .from('leave_requests')
        .select('leave_id', { count: 'exact', head: true })
        .eq('status', 'Pending'),
    ),
    count(
      supabase
        .from('cash_advances')
        .select('cash_advance_id', { count: 'exact', head: true })
        .eq('status', 'Pending'),
    ),
  ])

  return [
    { label: 'trips past their start time and still Awaiting', count: overdue, to: '/dashboard/dispatch', page: 'Dispatch Board' },
    { label: 'trips starting within 24 hours with no truck', count: noTruck, to: '/dashboard/dispatch', page: 'Dispatch Board' },
    { label: 'maintenance requests to review', count: maintenance, to: '/dashboard/reports', page: 'Reports' },
    { label: 'leave requests to review', count: leave, to: '/dashboard/attendance', page: 'Attendance' },
    { label: 'cash advance requests to review', count: cash, to: '/dashboard/cash-advance', page: 'Cash Advances' },
  ].filter((a) => a.count > 0)
}

// Every dashboard panel uses this same white box with a 2px border
// (.card in index.css).
const CARD = 'card'
// Panel heading, and the small grey "1 Month" / "Today" tag beside it.
const PANEL_TITLE = 'text-base leading-6 font-semibold text-ink'
const PANEL_TAG = 'rounded-[2px] bg-slate-200 px-2 py-1 text-xs font-medium text-ink-secondary'

// Small outline icons (24x24 SVG paths, same style as the sidebar's).
const ICONS = {
  warning:
    'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chevron: 'M9 6l6 6-6 6',
  check: 'M20 6L9 17l-5-5',
  down: 'M23 18l-9.5-9.5-5 5L1 6M17 18h6v-6',
  up: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
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
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

// One row of small squares: filled = operational/available, hollow amber =
// not. Capped at 12 so a big fleet doesn't wrap.
function UnitSquares({ ok, total }: { ok: number; total: number }) {
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      {Array.from({ length: Math.min(total, 12) }, (_, i) => (
        <span
          key={i}
          className={i < ok ? 'h-3 w-3 bg-primary' : 'h-3 w-3 border-2 border-amber-800 bg-white'}
        />
      ))}
    </span>
  )
}

// Label + amount over a bar. Bars in the Financial Summary share one scale
// (the biggest of the four figures = full width). `big` = the top row's
// larger amount.
function MoneyBar({
  label,
  value,
  max,
  tone,
  to,
  big = false,
}: {
  label: string
  value: number | null
  max: number
  tone: string
  to: string
  big?: boolean
}) {
  return (
    <Link to={to} className="flex flex-col gap-1.5 hover:opacity-80">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink-secondary">{label}</span>
        <span
          className={`text-ink-metric tabular-nums ${big ? 'text-xl leading-7 font-bold' : 'text-base leading-6 font-semibold'}`}
        >
          {value === null ? '--' : formatMoney(value)}
        </span>
      </div>
      <div className="h-3 bg-slate-200">
        {/* A tiny but non-zero amount still shows a sliver. */}
        <div
          className={`h-3 ${tone} ${value ? 'min-w-1' : ''}`}
          style={{ width: `${max > 0 && value ? (value / max) * 100 : 0}%` }}
        />
      </div>
    </Link>
  )
}

// A small bordered tile with a label and a big number (Fleet & Crew, etc.).
// `squares` sit beside the number; `note` is a small amber warning beside
// the label.
function StatTile({
  label,
  to,
  note,
  squares,
  children,
}: {
  label: string
  to: string
  note?: string
  squares?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link to={to} className="flex flex-col justify-center gap-0.5 border border-line px-3 py-2 hover:border-primary">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-medium text-ink-secondary">{label}</span>
        {note && <span className="text-xs font-semibold text-amber-800">{note}</span>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-2xl font-semibold tracking-[-0.01em] text-ink-metric tabular-nums">{children}</span>
        {squares}
      </div>
    </Link>
  )
}

// Today's Deliveries shows this many trips per page (no scrolling box).
const DELIVERIES_PER_PAGE = 5

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
  booking_id: number
  driver: string | null
  startAt: string | null
  endAt: string | null
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
  })
  const [loading, setLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [revenueRange, setRevenueRange] =
    useState<(typeof REVENUE_RANGES)[number]['value']>('1M')
  // Bumped by the Refresh button; revenue and both cost cards reload on change.
  const [refreshKey, setRefreshKey] = useState(0)
  const rangePeriod = REVENUE_RANGES.find((r) => r.value === revenueRange)!.period
  // True from a Refresh click until the summary has reloaded.
  const [refreshing, setRefreshing] = useState(false)
  // Expense totals for the period (same loaders Money Summary's expense
  // cards use). Operational already includes payroll.
  const [expenses, setExpenses] = useState<{ ops: number; payroll: number; maint: number } | null>(null)
  const [expensesError, setExpensesError] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<DashboardAlert[]>([])
  const [revenue, setRevenue] = useState(0)
  const [revenueLoading, setRevenueLoading] = useState(true)
  const [revenueError, setRevenueError] = useState<string | null>(null)
  const [todayDeliveryRows, setTodayDeliveryRows] = useState<TodayDelivery[]>([])
  const [deliveryPage, setDeliveryPage] = useState(0)
  const [todayDeliveriesLoading, setTodayDeliveriesLoading] = useState(true)
  const [todayDeliveriesError, setTodayDeliveriesError] = useState<string | null>(
    null,
  )

  useEffect(() => {
    async function loadSummary() {
      try {
        // Manila date, not UTC (toISOString gave yesterday before 8 AM).
        const today = toManilaDate(new Date())

        const [quotes, bookings, deliveries, trucks, trailers] =
          await Promise.all([
            supabase
              .from('quote_requests')
              .select('quote_request_id', { count: 'exact', head: true })
              // Staff's turn: new requests to price + client counter-offers.
              .in('request_status', ['Pending', 'Countered']),
            supabase
              .from('bookings')
              .select('booking_id', { count: 'exact', head: true })
              .in('booking_status', ['Confirmed', 'InProgress']),
            supabase
              .from('itineraries')
              .select('itinerary_id', { count: 'exact', head: true })
              .or(todaysTripsFilter(today)),
            supabase.from('truck_profiles').select('current_status').eq('is_active', true),
            supabase.from('trailers').select('current_status').eq('is_active', true),
          ])

        if (
          quotes.error ||
          bookings.error ||
          deliveries.error ||
          trucks.error ||
          trailers.error
        ) {
          const firstError =
            quotes.error ??
            bookings.error ??
            deliveries.error ??
            trucks.error ??
            trailers.error!
          console.error('Failed to load dashboard summary', firstError)
          setSummaryError(
            `Couldn't load the dashboard summary (${firstError.message}). Try refreshing the page.`,
          )
          return
        }

        setSummaryError(null)

        // Operational = the vehicle's own Fleet status isn't Under
        // Maintenance / Out of Service (null counts as Available, same as
        // the Fleet page's badge).
        const operational = (rows: { current_status: string | null }[]) =>
          rows.filter((r) => !NOT_OPERATIONAL.has(r.current_status ?? 'Available')).length

        setSummary({
          pendingQuotes: quotes.count ?? 0,
          activeBookings: bookings.count ?? 0,
          todayDeliveries: deliveries.count ?? 0,
          truckCount: trucks.data.length,
          trailerCount: trailers.data.length,
          trucksOperational: operational(trucks.data),
          trailersOperational: operational(trailers.data),
        })
      } catch (error) {
        console.error('Failed to load dashboard summary', error)
        setSummaryError(
          "Couldn't load the dashboard summary. Try refreshing the page.",
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    }

    loadSummary()
  }, [refreshKey])

  // "Needs attention" strip.
  useEffect(() => {
    loadAlerts().then(setAlerts)
  }, [refreshKey])

  useEffect(() => {
    async function loadRevenue() {
      setRevenueLoading(true)

      // Same Manila-time start date the expense cards use, so all three agree.
      const cutoffDate = rangeStartManila(
        REVENUE_RANGES.find((r) => r.value === revenueRange)!.period,
      )

      // Cash actually collected in the period: every non-voided payment in
      // booking_payments by the date it was received, refunds (negative
      // amounts) subtracted -- the same money the Collections page lists.
      // Counts payments on any booking, incl. older and Cancelled ones.
      const payments = await fetchAll<{ amount: number | string }>((from, to) =>
        supabase
          .from('booking_payments')
          .select('amount')
          .is('voided_at', null)
          .gte('paid_on', cutoffDate)
          .range(from, to),
      )

      if (payments.error) {
        console.error('Failed to load revenue', payments.error)
        setRevenueError(`Couldn't load revenue (${payments.error}).`)
        setRevenueLoading(false)
        return
      }

      setRevenueError(null)
      setRevenue(payments.rows.reduce((sum, p) => sum + Number(p.amount), 0))
      setRevenueLoading(false)
    }

    loadRevenue()
  }, [revenueRange, refreshKey])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadOperationalExpenses(rangePeriod),
      loadPayrollExpenses(rangePeriod),
      loadMaintenanceExpenses(rangePeriod),
    ]).then(([ops, pay, maint]) => {
      if (cancelled) return
      const err = ops.error ?? pay.error ?? maint.error
      if (err || !ops.data || !pay.data || !maint.data) {
        console.error('Failed to load expenses', err)
        setExpensesError(`Couldn't load expenses (${err ?? 'no data'}).`)
        return
      }
      setExpensesError(null)
      setExpenses({ ops: ops.data.total, payroll: pay.data.total, maint: maint.data.total })
    })
    return () => {
      cancelled = true
    }
  }, [rangePeriod, refreshKey])

  // Cash advance totals (same four numbers as the Cash Advance page ledger)
  const [cashAdvance, setCashAdvance] = useState<{
    pending: number
    issued: number
    deducted: number
    current: number
  } | null>(null)
  const [cashAdvanceError, setCashAdvanceError] = useState<string | null>(null)
  useEffect(() => {
    loadCashAdvanceTotals().then(({ totals, error }) => {
      if (error) {
        console.error('Failed to load cash advance totals', error)
        setCashAdvanceError(`Couldn't load cash advances (${error}).`)
        return
      }
      setCashAdvanceError(null)
      setCashAdvance(totals)
    })
  }, [refreshKey])

  // Human Resource card numbers. Employees = everyone not Deactivated/
  // Terminated. A driver is "available" unless they're active crew on a
  // trip that's on the road (Dispatched / PickedUp / InTransit) or on
  // approved leave today.
  const [hr, setHr] = useState<{ total: number; drivers: number; available: number } | null>(null)
  const [hrError, setHrError] = useState<string | null>(null)
  useEffect(() => {
    async function loadHr() {
      const today = toManilaDate(new Date())
      const [statuses, employees, crews, trips, leave] = await Promise.all([
        supabase.from('employment_status').select('status_id, status_name'),
        supabase.from('employees').select('employee_id, position, employment_status_id'),
        supabase
          .from('itinerary_crews')
          .select('employee_id, itinerary_id')
          .eq('crew_role', 'Driver')
          .eq('is_active', true),
        supabase
          .from('itineraries')
          .select('itinerary_id')
          .in('itinerary_status', ['Dispatched', 'PickedUp', 'InTransit']),
        loadApprovedLeave(today),
      ])
      // Check the error FIRST (a failed query has no data either).
      const err =
        statuses.error?.message ??
        employees.error?.message ??
        crews.error?.message ??
        trips.error?.message ??
        leave.error
      if (err || !statuses.data || !employees.data || !crews.data || !trips.data) {
        console.error('Failed to load HR summary', err)
        setHrError(`Couldn't load employees (${err ?? 'no data'}).`)
        return
      }
      setHrError(null)
      const inactiveIds = new Set(
        statuses.data
          .filter((s) => s.status_name === 'Deactivated' || s.status_name === 'Terminated')
          .map((s) => s.status_id),
      )
      const current = employees.data.filter(
        (e) => e.employment_status_id === null || !inactiveIds.has(e.employment_status_id),
      )
      const drivers = current.filter((e) => e.position === 'Driver')
      const onRoad = new Set(trips.data.map((t) => t.itinerary_id))
      const busy = new Set(
        crews.data.filter((c) => onRoad.has(c.itinerary_id)).map((c) => c.employee_id),
      )
      // On approved leave covering today (dates are 'yyyy-mm-dd', so plain
      // string comparison works).
      for (const [employeeId, ranges] of leave.byEmployee) {
        if (ranges.some((r) => r.start_date <= today && today <= r.end_date)) busy.add(employeeId)
      }
      setHr({
        total: current.length,
        drivers: drivers.length,
        available: drivers.filter((d) => !busy.has(d.employee_id)).length,
      })
    }
    loadHr()
  }, [refreshKey])

  useEffect(() => {
    async function loadTodayDeliveries() {
      setTodayDeliveriesLoading(true)

      const today = toManilaDate(new Date())

      const { data: itineraryRows, error: itineraryError } = await supabase
        .from('itineraries')
        .select(
          'itinerary_id, booking_id, place_of_pickup_id, place_of_delivery_id, itinerary_status, plate_number, trailer_id, trip_start_at, trip_end_at, trip_rate',
        )
        .or(todaysTripsFilter(today))
        .order('trip_start_at', { ascending: true, nullsFirst: false })

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

      const [placesResult, bookingsResult, trailersResult, crewResult] = await Promise.all([
        supabase.from('places').select('place_id, place_name').in('place_id', placeIds),
        supabase
          .from('bookings')
          .select('booking_id, rate_of_delivery_service')
          .in('booking_id', bookingIds),
        trailerIds.length > 0
          ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('itinerary_crews')
          .select('itinerary_id, employee_id')
          .eq('crew_role', 'Driver')
          .eq('is_active', true)
          .in('itinerary_id', itineraryRows.map((row) => row.itinerary_id)),
      ])

      // Driver names are a second hop: crews -> employees.
      const driverIds = Array.from(new Set((crewResult.data ?? []).map((c) => c.employee_id)))
      const driversResult =
        driverIds.length > 0
          ? await supabase.from('employees').select('employee_id, full_name').in('employee_id', driverIds)
          : { data: [], error: null }

      if (
        placesResult.error ||
        bookingsResult.error ||
        trailersResult.error ||
        crewResult.error ||
        driversResult.error
      ) {
        const combinedError =
          placesResult.error ??
          bookingsResult.error ??
          trailersResult.error ??
          crewResult.error ??
          driversResult.error!
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

      const driverNameById = new Map((driversResult.data ?? []).map((d) => [d.employee_id, d.full_name]))
      const driverByTrip = new Map(
        (crewResult.data ?? []).map((c) => [c.itinerary_id, driverNameById.get(c.employee_id) ?? null]),
      )

      setTodayDeliveryRows(
        itineraryRows.map((row) => ({
          itinerary_id: row.itinerary_id,
          booking_id: row.booking_id,
          driver: driverByTrip.get(row.itinerary_id) ?? null,
          startAt: row.trip_start_at,
          endAt: row.trip_end_at,
          from: placeNameById.get(row.place_of_pickup_id) ?? '—',
          to: placeNameById.get(row.place_of_delivery_id) ?? '—',
          // This trip's own rate (cargo lines can be priced differently).
          rate: row.trip_rate ?? rateByBookingId.get(row.booking_id) ?? null,
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
  }, [refreshKey])

  // Things for the "Needs attention" banner that come from the summary
  // numbers already loaded, ahead of the ones loadAlerts() counts.
  const trucksDown = summary.truckCount - summary.trucksOperational
  const allAlerts: DashboardAlert[] = loading
    ? alerts
    : [
        {
          label: `${trucksDown === 1 ? 'truck' : 'trucks'} not operational`,
          count: trucksDown,
          to: '/dashboard/maintenance-monitoring',
          page: 'Truck Monitoring',
        },
        {
          label: `${summary.pendingQuotes === 1 ? 'quotation' : 'quotations'} pending`,
          count: summary.pendingQuotes,
          to: '/dashboard/quotations',
          page: 'Quotations',
        },
        ...alerts,
      ].filter((a) => a.count > 0)

  // Net = cash collected - (operational + maintenance expenses). Operational
  // already includes payroll, so payroll is not subtracted again.
  const net =
    !revenueLoading && !revenueError && expenses ? revenue - expenses.ops - expenses.maint : null
  const barMax = Math.max(revenue, expenses?.ops ?? 0, expenses?.payroll ?? 0, expenses?.maint ?? 0)
  const rangeLabel = REVENUE_RANGES.find((r) => r.value === revenueRange)!.label

  const deliveredCount = todayDeliveryRows.filter((r) => r.status === 'Delivered').length

  // Today's Deliveries: 5 per page instead of a scrolling box.
  const deliveryPageCount = Math.max(Math.ceil(todayDeliveryRows.length / DELIVERIES_PER_PAGE), 1)
  // Clamp in case the list got shorter (e.g. after a refresh).
  const safeDeliveryPage = Math.min(deliveryPage, deliveryPageCount - 1)
  const deliveriesOnPage = todayDeliveryRows.slice(
    safeDeliveryPage * DELIVERIES_PER_PAGE,
    (safeDeliveryPage + 1) * DELIVERIES_PER_PAGE,
  )

  const tripLink = (row: TodayDelivery) =>
    `/dashboard/bookings?booking=${row.booking_id}&trip=${row.itinerary_id}`

  return (
    <div className="flex flex-col gap-4">
      {/* Header: title, "Needs attention" banner, period + Refresh */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 border-l-[3px] border-primary pl-4">
          <h1 className="text-xl leading-7 font-bold text-ink">Dashboard</h1>
          <p className="text-sm text-ink-muted">
            Welcome, {username} ·{' '}
            {new Date().toLocaleDateString('en-US', {
              timeZone: 'Asia/Manila',
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        {allAlerts.length > 0 && (
          <section
            aria-label="Needs attention"
            className="flex min-w-0 flex-1 basis-[480px] flex-wrap items-center gap-x-7 border border-amber-600 bg-amber-100 px-4 text-sm text-amber-900"
          >
            <strong className="flex min-h-11 items-center gap-2 font-bold">
              <Icon name="warning" size={18} />
              Needs Attention
            </strong>
            {allAlerts.map((a) => (
              <Link
                key={a.label}
                to={a.to}
                className="flex min-h-11 items-center gap-2 font-medium underline underline-offset-2 hover:no-underline"
              >
                <span>
                  <strong>{a.count} {a.label}</strong> · {a.page}
                </span>
                <Icon name="arrow" />
              </Link>
            ))}
          </section>
        )}

        {/* Period for revenue + every expense figure; Refresh reloads the whole page. */}
        <div className="ml-auto flex items-center gap-3">
          <label htmlFor="dashboard-period" className="text-sm font-medium text-ink-secondary">
            Period
          </label>
          <select
            id="dashboard-period"
            value={revenueRange}
            onChange={(e) =>
              setRevenueRange(e.target.value as (typeof REVENUE_RANGES)[number]['value'])
            }
            className="h-11 rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric"
          >
            {REVENUE_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setRefreshing(true)
              setRefreshKey((k) => k + 1)
            }}
            disabled={refreshing}
            className="btn-secondary flex h-11 items-center gap-2 px-4 text-sm font-medium"
          >
            <Icon name="refresh" className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {summaryError && (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{summaryError}</p>
      )}

      {/* Financial Summary: net on the left, the four figures as bars */}
      <section aria-labelledby="fin-h" className={`${CARD} flex flex-col gap-3 px-5 pt-3.5 pb-[18px]`}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="fin-h" className={PANEL_TITLE}>Financial Summary</h2>
          <span className={PANEL_TAG}>{rangeLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-14 gap-y-4">
          <div
            className="flex shrink grow-0 basis-[420px] flex-col gap-1"
            title="Cash received this period vs. costs incurred (incl. estimated diesel and draft payslips). A guide, not an accounting profit."
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-neutral-500">Net Result</span>
              {net !== null && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 text-xs font-semibold ${
                    net < 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                  }`}
                >
                  <Icon name={net < 0 ? 'down' : 'up'} size={14} />
                  {net < 0 ? 'Net Loss' : 'Net Profit'}
                </span>
              )}
            </div>
            <p
              className={`text-4xl font-bold tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere] sm:text-5xl sm:leading-14 ${
                net !== null && net < 0 ? 'text-red-700' : 'text-ink-metric'
              }`}
            >
              {net === null ? '--' : `${net < 0 ? '−' : ''}${formatMoney(Math.abs(net))}`}
            </p>
          </div>

          {revenueError || expensesError ? (
            <p className="flex-1 text-sm text-red-700">{revenueError ?? expensesError}</p>
          ) : (
            // Read left-to-right: Revenue | Operational, then Payroll | Maintenance.
            <div className="grid flex-1 basis-[560px] gap-x-10 gap-y-4 sm:grid-cols-2">
              <MoneyBar
                label="Total Revenue (collected)"
                value={revenueLoading ? null : revenue}
                max={barMax}
                tone="bg-primary"
                to="/dashboard/collections"
                big
              />
              <MoneyBar
                label="Operational Expenses"
                value={expenses?.ops ?? null}
                max={barMax}
                tone="bg-ink-secondary"
                to="/dashboard/money-summary?tab=expenses#op"
                big
              />
              <MoneyBar
                label="Payroll Expenses"
                value={expenses?.payroll ?? null}
                max={barMax}
                tone="bg-ink-secondary"
                to="/dashboard/money-summary?tab=expenses#pay"
              />
              <MoneyBar
                label="Maintenance Expenses (parts)"
                value={expenses?.maint ?? null}
                max={barMax}
                tone="bg-ink-secondary"
                to="/dashboard/money-summary?tab=expenses#mt"
              />
            </div>
          )}
        </div>
      </section>

      {/* Today's Deliveries */}
      <section aria-labelledby="del-h" className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-1">
          <div className="flex min-h-11 items-center gap-3">
            <h2 id="del-h" className={PANEL_TITLE}>Today's Deliveries</h2>
            <span className={PANEL_TAG}>Today</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 text-sm">
            {todayDeliveryRows.length > 0 && (
              <span className="flex items-center gap-3 font-semibold text-green-800">
                <span className="flex gap-1" aria-hidden="true">
                  {todayDeliveryRows.slice(0, 10).map((r) => (
                    <span
                      key={r.itinerary_id}
                      className={`h-2 w-7 ${r.status === 'Delivered' ? 'bg-green-700' : 'bg-slate-200'}`}
                    />
                  ))}
                </span>
                {deliveredCount} of {todayDeliveryRows.length} delivered
              </span>
            )}
            <Link to="/dashboard/dispatch" className="flex min-h-11 items-center gap-2 font-semibold text-primary hover:underline">
              Open Dispatch Board
              <Icon name="arrow" />
            </Link>
          </div>
        </div>

        {todayDeliveriesLoading && (
          <p className="border-t border-line px-5 py-4 text-sm text-ink-muted">Loading today's deliveries...</p>
        )}
        {!todayDeliveriesLoading && todayDeliveriesError && (
          <p className="border-t border-line px-5 py-4 text-sm text-red-700">{todayDeliveriesError}</p>
        )}
        {!todayDeliveriesLoading && !todayDeliveriesError && todayDeliveryRows.length === 0 && (
          <EmptyState message="No deliveries scheduled for today." className="m-4" />
        )}

        {!todayDeliveriesLoading && todayDeliveryRows.length > 0 && (
          <>
            {/* Phone: one stacked row per delivery (the table is too wide) */}
            <div className="flex flex-col border-t border-line sm:hidden">
              {deliveriesOnPage.map((row) => (
                <Link
                  key={row.itinerary_id}
                  to={tripLink(row)}
                  className="border-b border-slate-200 px-4 py-3 text-sm last:border-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-primary">
                      Trip #{row.itinerary_id}{' '}
                      <span className="font-normal text-ink-muted">· Booking #{row.booking_id}</span>
                    </span>
                    <StatusBadge status={row.status} icon />
                  </div>
                  <p className="mt-1 text-ink-metric">
                    {row.from} <span className="text-ink-muted">→</span> {row.to}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {row.startAt ? formatSlot(row.startAt, row.endAt) : 'No time set'} ·{' '}
                    {row.driver ?? 'Unassigned'} · {row.rate != null ? formatMoney(row.rate) : 'N/A'}
                  </p>
                </Link>
              ))}
            </div>

            <div className="hidden overflow-x-auto border-t border-line sm:block">
              {/* Header row style comes from index.css (thead th). */}
              <table className="w-full text-left text-sm text-ink-metric">
                <thead>
                  <tr>
                    <th className="px-4 py-2">Trip / Booking</th>
                    <th className="px-4 py-2">Time slot</th>
                    <th className="px-4 py-2">Driver</th>
                    <th className="px-4 py-2">Route</th>
                    <th className="px-4 py-2 text-right">Rate</th>
                    <th className="px-4 py-2">Truck / Trailer</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="w-11 px-2 py-2">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deliveriesOnPage.map((row) => (
                    <tr key={row.itinerary_id} className="border-b border-slate-200 last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Link to={tripLink(row)} className="font-semibold text-primary hover:underline">
                          Trip #{row.itinerary_id}
                        </Link>
                        <p className="text-[13px] leading-[18px] text-ink-muted">Booking #{row.booking_id}</p>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {row.startAt ? formatSlot(row.startAt, row.endAt) : '—'}
                      </td>
                      <td className={`px-4 py-2 ${row.driver ? '' : 'text-ink-muted'}`}>
                        {row.driver ?? 'Unassigned'}
                      </td>
                      <td className="px-4 py-2">
                        <p>{row.from}</p>
                        <p className="flex items-center gap-1.5 text-ink-muted">
                          <Icon name="arrow" size={14} />
                          {row.to}
                        </p>
                      </td>
                      <td className="px-4 py-2 text-right font-semibold whitespace-nowrap tabular-nums">
                        {row.rate != null ? formatMoney(row.rate) : 'N/A'}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <p className={`font-semibold ${row.truckPlateNumber ? '' : 'font-normal text-ink-muted'}`}>
                          {row.truckPlateNumber ?? 'No truck'}
                        </p>
                        <p className="text-[13px] leading-[18px] text-ink-muted">{row.trailerPlateNumber ?? 'No trailer'}</p>
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={row.status} icon />
                      </td>
                      <td className="px-0 py-0">
                        <Link
                          to={tripLink(row)}
                          aria-label={`Open trip #${row.itinerary_id}`}
                          className="flex h-11 w-11 items-center justify-center text-primary"
                        >
                          <Icon name="chevron" size={18} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {deliveryPageCount > 1 && (
              <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-2 text-sm text-ink-secondary">
                <button
                  type="button"
                  onClick={() => setDeliveryPage((p) => Math.max(p - 1, 0))}
                  disabled={safeDeliveryPage === 0}
                  className="btn-secondary h-11 px-3.5 font-medium"
                >
                  ‹ Previous
                </button>
                <span>
                  Page {safeDeliveryPage + 1} of {deliveryPageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setDeliveryPage((p) => Math.min(p + 1, deliveryPageCount - 1))}
                  disabled={safeDeliveryPage >= deliveryPageCount - 1}
                  className="btn-secondary h-11 px-3.5 font-medium"
                >
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Bottom row: Fleet & Crew, Cash Advance, Clients & Bookings */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-labelledby="fleet-h" className={`${CARD} flex flex-col gap-2.5 px-5 pt-3.5 pb-4`}>
          <h2 id="fleet-h" className={PANEL_TITLE}>Fleet &amp; Crew</h2>
          {hrError && <p className="text-xs text-red-700">{hrError}</p>}
          <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-3">
            <StatTile
              label="Trucks Operational"
              to="/dashboard/fleet"
              note={!loading && trucksDown > 0 ? `${trucksDown} not operational` : undefined}
              squares={!loading && <UnitSquares ok={summary.trucksOperational} total={summary.truckCount} />}
            >
              {loading ? '--' : `${summary.trucksOperational}/${summary.truckCount}`}
            </StatTile>
            <StatTile
              label="Trailers Operational"
              to="/dashboard/fleet"
              squares={!loading && <UnitSquares ok={summary.trailersOperational} total={summary.trailerCount} />}
            >
              {loading ? '--' : `${summary.trailersOperational}/${summary.trailerCount}`}
            </StatTile>
            <StatTile
              label="Drivers Available"
              to="/dashboard/schedule-overview"
              squares={hr && <UnitSquares ok={hr.available} total={hr.drivers} />}
            >
              {hr ? `${hr.available}/${hr.drivers}` : '--'}
            </StatTile>
            <StatTile label="Total Employees" to="/dashboard/employees">
              {hr?.total ?? '--'}
            </StatTile>
          </div>
        </section>

        <Link to="/dashboard/cash-advance" className={`${CARD} flex flex-col gap-2.5 px-5 pt-3.5 pb-4 hover:border-primary`}>
          <h2 className={PANEL_TITLE}>Cash Advance</h2>
          {cashAdvanceError ? (
            <p className="text-sm text-red-700">{cashAdvanceError}</p>
          ) : (
            <div className="flex flex-1 flex-wrap items-center gap-x-7 gap-y-3">
              <div className="flex flex-1 basis-[190px] flex-col gap-1.5">
                <div>
                  <p className="text-sm font-medium text-neutral-500">Current Balance</p>
                  <p className="text-[40px] leading-12 font-bold tracking-[-0.02em] text-primary tabular-nums">
                    {cashAdvance ? formatMoney(cashAdvance.current) : '--'}
                  </p>
                  <p className="text-sm text-ink-muted">Disbursed − deducted</p>
                </div>
                {/* Share of what was disbursed that has been paid back */}
                <div className="h-3 bg-[#dbe5ee]">
                  <div
                    className="h-3 bg-ink-secondary"
                    style={{
                      width: `${
                        cashAdvance && cashAdvance.issued > 0
                          ? Math.min((cashAdvance.deducted / cashAdvance.issued) * 100, 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 bg-ink-secondary" /> Deducted
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 border border-line-control bg-[#dbe5ee]" /> Balance
                  </span>
                </p>
              </div>
              <dl className="flex-1 basis-[170px] text-sm">
                {(
                  [
                    ['Disbursed', cashAdvance?.issued],
                    ['Deducted', cashAdvance?.deducted],
                    ['Pending Approval', cashAdvance?.pending],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 border-t border-slate-200 py-2.5 last:pb-0">
                    <dt className="font-medium text-ink-secondary">{label}</dt>
                    <dd className="font-semibold text-ink-metric tabular-nums">{value == null ? '--' : formatMoney(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Link>

        <section aria-labelledby="cli-h" className={`${CARD} flex flex-col gap-2.5 px-5 pt-3.5 pb-4`}>
          <h2 id="cli-h" className={PANEL_TITLE}>Clients &amp; Bookings</h2>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/dashboard/quotations" className="flex flex-col gap-0.5 border border-line px-3 py-2 hover:border-primary">
              <span className="text-sm font-medium text-ink-secondary">Pending Quotes</span>
              <span className="flex items-center justify-between gap-3">
                <span className="text-2xl font-semibold tracking-[-0.01em] text-primary tabular-nums">
                  {loading ? '--' : summary.pendingQuotes}
                </span>
                {!loading && summary.pendingQuotes > 0 && (
                  <span className="text-sm font-semibold text-primary">Review</span>
                )}
              </span>
            </Link>
            <Link to="/dashboard/bookings" className="flex flex-col gap-0.5 border border-line px-3 py-2 hover:border-primary">
              <span className="text-sm font-medium text-ink-secondary">Active Bookings</span>
              <span className="text-2xl font-semibold tracking-[-0.01em] text-ink-metric tabular-nums">
                {loading ? '--' : summary.activeBookings}
              </span>
            </Link>
          </div>
          <h3 className="text-sm font-semibold text-ink">Top Unpaid Clients</h3>
          <div className="flex min-h-32 flex-1 flex-col">
            <TopCreditorsCard refreshKey={refreshKey} />
          </div>
        </section>
      </div>
    </div>
  )
}

export default StaffDashboard
