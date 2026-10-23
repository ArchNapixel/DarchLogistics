import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { rangeStartManila } from '../../lib/expenseTotals'
import { loadCashAdvanceTotals } from '../../lib/cashAdvanceRequests'
import { toManilaDate } from '../../lib/payslip'
import { loadApprovedLeave } from '../../lib/leaveRequests'
import { fetchAll } from '../../lib/dashboardExpenses'
import MaintenanceExpensesCard from './staff/MaintenanceExpensesCard'
import OperationalExpensesCard from './staff/OperationalExpensesCard'
import PayrollExpensesCard from './staff/PayrollExpensesCard'
import TopCreditorsCard from './staff/TopCreditorsCard'
import PageHeader from '../../components/PageHeader'
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

type DashboardAlert = { label: string; count: number; to: string }

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
    { label: 'trips past their start time and still Awaiting', count: overdue, to: '/dashboard/dispatch' },
    { label: 'trips starting within 24 hours with no truck', count: noTruck, to: '/dashboard/dispatch' },
    { label: 'maintenance requests to review', count: maintenance, to: '/dashboard/reports' },
    { label: 'leave requests to review', count: leave, to: '/dashboard/attendance' },
    { label: 'cash advance requests to review', count: cash, to: '/dashboard/cash-advance' },
  ].filter((a) => a.count > 0)
}

// Cards whose number means "someone needs to act" -- shown in the accent
// color (see the design system notes in index.css).
const ATTENTION_CARDS = new Set(['Pending Quotes', 'Pending Approval', 'Current Balance'])

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
  // Totals reported by the expense cards, for the net figure.
  const [opsTotal, setOpsTotal] = useState<number | null>(null)
  const [maintTotal, setMaintTotal] = useState<number | null>(null)
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
              .eq('request_status', 'Pending'),
            supabase
              .from('bookings')
              .select('booking_id', { count: 'exact', head: true })
              .in('booking_status', ['Confirmed', 'InProgress']),
            supabase
              .from('itineraries')
              .select('itinerary_id', { count: 'exact', head: true })
              .or(todaysTripsFilter(today)),
            supabase.from('truck_profiles').select('current_status'),
            supabase.from('trailers').select('current_status'),
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

  // Cash advance totals (same four numbers as the Cash Advance page ledger)
  const [cashAdvance, setCashAdvance] = useState<string[] | null>(null)
  const [cashAdvanceError, setCashAdvanceError] = useState<string | null>(null)
  useEffect(() => {
    loadCashAdvanceTotals().then(({ totals, error }) => {
      if (error) {
        console.error('Failed to load cash advance totals', error)
        setCashAdvanceError(`Couldn't load cash advances (${error}).`)
        return
      }
      setCashAdvanceError(null)
      setCashAdvance(
        [totals.pending, totals.issued, totals.deducted, totals.current].map(
          (n) => `${formatMoney(n)}`,
        ),
      )
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
          'itinerary_id, booking_id, place_of_pickup_id, place_of_delivery_id, itinerary_status, plate_number, trailer_id, trip_start_at, trip_end_at',
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
  }, [refreshKey])

  // Cards grouped by the same module names as the sidebar
  const summaryGroups = [
    {
      title: 'Operations',
      cards: [
        { label: 'Pending Quotes', value: summary.pendingQuotes, to: '/dashboard/quotations' },
        { label: 'Active Bookings', value: summary.activeBookings, to: '/dashboard/bookings' },
        { label: "Today's Deliveries", value: summary.todayDeliveries, to: '/dashboard/dispatch' },
      ],
    },
    {
      title: 'Maintenance',
      cards: [
        { label: 'Trucks Operational', value: `${summary.trucksOperational}/${summary.truckCount}`, to: '/dashboard/fleet' },
        { label: 'Trailers Operational', value: `${summary.trailersOperational}/${summary.trailerCount}`, to: '/dashboard/fleet' },
      ],
    },
    {
      title: 'Human Resource',
      error: hrError,
      cards: [
        { label: 'Total Employees', value: hr?.total ?? '--', to: '/dashboard/employees' },
        { label: 'Drivers Available', value: hr ? `${hr.available}/${hr.drivers}` : '--', to: '/dashboard/driver-schedule' },
      ],
    },
    {
      title: 'Cash Advance',
      error: cashAdvanceError,
      cards: [
        { label: 'Pending Approval', value: cashAdvance?.[0] ?? '--', to: '/dashboard/cash-advance' },
        { label: 'Disbursed', value: cashAdvance?.[1] ?? '--', to: '/dashboard/cash-advance' },
        { label: 'Deducted', value: cashAdvance?.[2] ?? '--', to: '/dashboard/cash-advance' },
        { label: 'Current Balance', value: cashAdvance?.[3] ?? '--', to: '/dashboard/cash-advance' },
      ],
    },
  ]

  // Today's Deliveries: 5 per page instead of a scrolling box.
  const deliveryPageCount = Math.max(Math.ceil(todayDeliveryRows.length / DELIVERIES_PER_PAGE), 1)
  // Clamp in case the list got shorter (e.g. after a refresh).
  const safeDeliveryPage = Math.min(deliveryPage, deliveryPageCount - 1)
  const deliveriesOnPage = todayDeliveryRows.slice(
    safeDeliveryPage * DELIVERIES_PER_PAGE,
    (safeDeliveryPage + 1) * DELIVERIES_PER_PAGE,
  )

  // Title + one row of cards (as many equal columns as there are cards).
  // Used both beside Top Unpaid Clients and in the lower rows.
  const renderGroup = (group: (typeof summaryGroups)[number], columns = group.cards.length, large = false) => (
    <>
      <h2 className="font-ui text-sm font-medium text-neutral-500">{group.title}</h2>
      {'error' in group && group.error && (
        <p className="mt-1 font-ui text-xs text-red-700">{group.error}</p>
      )}
      <div
        className="mt-2 grid flex-1 gap-2 sm:gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {group.cards.map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className={`reports-blueprint-card block hover:border-accent-500 ${
              large ? 'flex flex-col justify-center px-4 py-2.5' : 'px-3 py-2 sm:px-4'
            }`}
          >
            <p className={`font-ui leading-tight text-reports-ink ${large ? 'text-sm' : 'text-xs sm:text-sm'}`}>
              {card.label}
            </p>
            <p
              className={`font-condensed leading-none font-semibold ${
                ATTENTION_CARDS.has(card.label) ? 'text-primary' : 'text-reports-ink'
              } ${large ? 'mt-1.5 text-3xl font-bold' : 'mt-1 text-xl'}`}
            >
              {loading ? '--' : card.value}
            </p>
          </Link>
        ))}
      </div>
    </>
  )

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome, ${username} · ${new Date().toLocaleDateString('en-US', {
          timeZone: 'Asia/Manila',
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}`}
        // Period for revenue + every expense card; Refresh reloads the whole page.
        actions={
          <>
            <select
              value={revenueRange}
              onChange={(e) =>
                setRevenueRange(e.target.value as (typeof REVENUE_RANGES)[number]['value'])
              }
              className="border border-reports-hairline bg-white px-2 py-1 font-ui text-sm text-reports-ink focus:border-accent-500 focus:outline-none"
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
              className="border border-reports-hairline bg-white px-2 py-1 font-ui text-sm text-reports-ink hover:border-accent-500 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {summaryError && (
        <p className="mt-4 border border-red-200 bg-red-50 px-4 py-3 font-ui text-sm text-red-700">
          {summaryError}
        </p>
      )}

      {/* Revenue and Net share one row, each only as wide as its content. */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div className="reports-blueprint-card flex min-h-[110px] flex-wrap content-center items-baseline gap-x-6 gap-y-1 px-5 py-5">
        {/* Same layout and header width as the Net card, so the amounts line up. */}
        <p className="font-ui text-[35px] leading-none font-medium text-black md:min-w-[22rem]">
          Total Revenue <span className="text-sm normal-case">(collected)</span>
        </p>
        {revenueError ? (
          <p className="font-ui text-sm text-red-700">{revenueError}</p>
        ) : (
          <p className="font-condensed text-[28px] leading-none font-bold text-black">
            {revenueLoading ? '--' : `${formatMoney(revenue)}`}
          </p>
        )}
      </div>

      {/* Net = cash collected - (operational + maintenance expenses). Operational
          already includes payroll, so the payroll card is not added again. */}
      {(() => {
        const net =
          !revenueLoading && !revenueError && opsTotal !== null && maintTotal !== null
            ? revenue - opsTotal - maintTotal
            : null
        return (
          <div
            className="reports-blueprint-card flex min-h-[110px] flex-wrap content-center items-baseline gap-x-6 gap-y-1 px-5 py-5"
            title="Cash received this period vs. costs incurred (incl. estimated diesel and draft payslips). A guide, not an accounting profit."
          >
            <p className="font-ui text-[35px] leading-none font-medium text-black md:min-w-[22rem]">
              {net !== null && net < 0 ? 'Net loss' : 'Net'}{' '}
              <span className="text-sm normal-case">(collected − expenses)</span>
            </p>
            <p
              className={`font-condensed text-[28px] leading-none font-bold ${
                net !== null && net < 0 ? 'text-red-700' : 'text-black'
              }`}
            >
              {net === null ? '--' : formatMoney(Math.abs(net))}
            </p>
          </div>
        )
      })()}
      </div>

      {alerts.length > 0 && (
        <div className="mt-3 border border-amber-300 bg-amber-50 px-4 py-3 font-ui text-sm">
          <p className="font-semibold text-amber-900">Needs attention</p>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
            {alerts.map((a) => (
              <li key={a.label}>
                <Link to={a.to} className="text-amber-900 underline underline-offset-2 hover:no-underline">
                  {a.count} {a.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Costs for the same period as the revenue dropdown above. */}
      {/* Stacked in a column on the left; each shows only its total and links
          to its full breakdown on Money Summary's "Expense Breakdown" tab. */}
      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start">
      <div className="flex flex-col gap-3 lg:w-1/3">
        {[
          <OperationalExpensesCard key="op" period={rangePeriod} refreshKey={refreshKey} collapsed onTotal={setOpsTotal} />,
          <PayrollExpensesCard key="pay" period={rangePeriod} refreshKey={refreshKey} collapsed />,
          <MaintenanceExpensesCard key="mt" period={rangePeriod} refreshKey={refreshKey} collapsed onTotal={setMaintTotal} />,
        ].map((card) => (
          <Link
            key={card.key}
            to={`/dashboard/money-summary?tab=expenses#${card.key}`}
            className="block hover:[&>div]:border-accent-500"
          >
            {card}
          </Link>
        ))}
      </div>
      {/* Leaderboard to the right of the expense cards */}
      {/* Middle column: Top Unpaid Clients stretches to the full height of the row */}
      {/* ponytail: side columns are a fixed 264px (= 3 collapsed expense cards) so
          they don't grow when an expense card expands; update if card sizes change */}
      <div className="lg:h-[264px] lg:w-1/3">
        <TopCreditorsCard refreshKey={refreshKey} />
      </div>
      {/* Right column: the remaining summary groups, stacked */}
      <div className="flex flex-col gap-3 lg:h-[264px] lg:w-1/3">
        {summaryGroups
          .filter((g) => ['Maintenance', 'Human Resource'].includes(g.title))
          .map((group) => (
            <div key={group.title} className="flex flex-1 flex-col">{renderGroup(group, group.cards.length, true)}</div>
          ))}
      </div>
      </div>

      {/* Cash Advance with Operations to its right (width shared by card count) */}
      <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:gap-3">
        {['Cash Advance', 'Operations'].map((title) => {
          const group = summaryGroups.find((g) => g.title === title)!
          return (
            <div key={title} className="xl:min-w-0" style={{ flex: `${group.cards.length} 1 0` }}>
              {renderGroup(group)}
            </div>
          )
        })}
      </div>

      <div className="mt-3">
        <h2 className="font-ui text-sm font-medium text-neutral-500">
          Today's Deliveries
          {todayDeliveryRows.length > 0 && <span className="ml-1 text-neutral-400">({todayDeliveryRows.length})</span>}
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
            <EmptyState message="No deliveries scheduled for today." className="mt-3" />
          )}

        {!todayDeliveriesLoading && todayDeliveryRows.length > 0 && (
          <>
          {/* Phone: one stacked card per delivery (the table is too wide) */}
          <div className="mt-3 flex flex-col gap-3 sm:hidden">
            {deliveriesOnPage.map((row) => (
              <div
                key={row.itinerary_id}
                className="border-2 border-slate-400 bg-reports-bg p-3 font-ui text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-reports-ink">
                    {row.from} <span className="text-neutral-400">→</span> {row.to}
                  </p>
                  <StatusBadge status={row.status} />
                </div>
                <p className="mt-2 text-xs text-neutral-600">
                  Trip #{row.itinerary_id} ·{' '}
                  <Link
                    to={`/dashboard/bookings?booking=${row.booking_id}&trip=${row.itinerary_id}`}
                    className="underline"
                  >
                    Booking #{row.booking_id}
                  </Link>
                  {row.startAt && <> · {formatSlot(row.startAt, row.endAt)}</>} · Driver{' '}
                  {row.driver ?? 'Unassigned'}
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  {row.rate != null ? `${formatMoney(row.rate)}` : 'N/A'} · Truck{' '}
                  {row.truckPlateNumber ?? 'Unassigned'} · Trailer{' '}
                  {row.trailerPlateNumber ?? 'Unassigned'}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-2 hidden overflow-x-auto border-2 border-slate-400 bg-reports-bg sm:block">
            <table className="w-full text-left font-ui text-sm">
              <thead className="border-b border-reports-hairline bg-reports-bg text-[11px] tracking-[0.1em] text-neutral-500 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Trip / Booking</th>
                  <th className="px-4 py-2 font-medium">Time slot</th>
                  <th className="px-4 py-2 font-medium">Driver</th>
                  <th className="px-4 py-2 font-medium">From</th>
                  <th className="px-4 py-2 font-medium">To</th>
                  <th className="px-4 py-2 font-medium">Rate</th>
                  <th className="px-4 py-2 font-medium">Truck Assigned</th>
                  <th className="px-4 py-2 font-medium">Trailer Assigned</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {deliveriesOnPage.map((row) => (
                  <tr
                    key={row.itinerary_id}
                    className="border-b border-reports-hairline last:border-0"
                  >
                    <td className="px-4 py-2 whitespace-nowrap text-reports-ink">
                      <Link
                        to={`/dashboard/bookings?booking=${row.booking_id}&trip=${row.itinerary_id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        #{row.itinerary_id} / #{row.booking_id}
                      </Link>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-neutral-600">
                      {row.startAt ? formatSlot(row.startAt, row.endAt) : '—'}
                    </td>
                    <td className={row.driver ? 'px-4 py-2 text-neutral-600' : 'px-4 py-2 text-neutral-400'}>
                      {row.driver ?? 'Unassigned'}
                    </td>
                    <td className="px-4 py-2 text-reports-ink">{row.from}</td>
                    <td className="px-4 py-2 text-neutral-600">{row.to}</td>
                    <td className="px-4 py-2 text-neutral-600">
                      {row.rate != null ? `${formatMoney(row.rate)}` : 'N/A'}
                    </td>
                    <td
                      className={
                        row.truckPlateNumber
                          ? 'px-4 py-2 text-neutral-600'
                          : 'px-4 py-2 text-neutral-400'
                      }
                    >
                      {row.truckPlateNumber ?? 'Unassigned'}
                    </td>
                    <td
                      className={
                        row.trailerPlateNumber
                          ? 'px-4 py-2 text-neutral-600'
                          : 'px-4 py-2 text-neutral-400'
                      }
                    >
                      {row.trailerPlateNumber ?? 'Unassigned'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {deliveryPageCount > 1 && (
            <div className="mt-2 flex items-center justify-end gap-3 font-ui text-sm text-neutral-600">
              <button
                type="button"
                onClick={() => setDeliveryPage((p) => Math.max(p - 1, 0))}
                disabled={safeDeliveryPage === 0}
                className="border border-reports-hairline px-2.5 py-1 hover:border-accent-500 disabled:opacity-40"
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
                className="border border-reports-hairline px-2.5 py-1 hover:border-accent-500 disabled:opacity-40"
              >
                Next ›
              </button>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  )
}

export default StaffDashboard
