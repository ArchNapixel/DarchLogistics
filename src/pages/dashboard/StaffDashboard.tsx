import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { rangeStartManila } from '../../lib/expenseTotals'
import { loadCashAdvanceTotals } from '../../lib/cashAdvanceRequests'
import MaintenanceExpensesCard from './staff/MaintenanceExpensesCard'
import OperationalExpensesCard from './staff/OperationalExpensesCard'
import PayrollExpensesCard from './staff/PayrollExpensesCard'
import TopCreditorsCard from './staff/TopCreditorsCard'
import PageHeader from '../../components/PageHeader'
import StatusBadge from '../../components/StatusBadge'
import { formatMoney } from '../../lib/format'
import EmptyState from '../../components/EmptyState'

const ACTIVE_WORK_ORDER_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']

// Cards whose number means "someone needs to act" -- shown in the accent
// color (see the design system notes in index.css).
const ATTENTION_CARDS = new Set(['Pending Quotes', 'Pending Approval', 'Current Balance'])

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
  // Expense cards show only their big number until the pointer is over one
  // (key of the hovered card, or null).
  const [openCard, setOpenCard] = useState<string | null>(null)
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

  // Cash advance totals (same four numbers as the Cash Advance page ledger)
  const [cashAdvance, setCashAdvance] = useState<string[] | null>(null)
  useEffect(() => {
    loadCashAdvanceTotals().then(({ totals, error }) => {
      if (error) {
        console.error('Failed to load cash advance totals', error)
        return
      }
      setCashAdvance(
        [totals.pending, totals.issued, totals.deducted, totals.current].map(
          (n) => `${formatMoney(n)}`,
        ),
      )
    })
  }, [refreshKey])

  // Human Resource card numbers. Employees = everyone not Deactivated/
  // Terminated. A driver is "available" unless they're active crew on a
  // trip that's on the road (Dispatched / PickedUp / InTransit).
  const [hr, setHr] = useState<{ total: number; drivers: number; available: number } | null>(null)
  useEffect(() => {
    async function loadHr() {
      const [statuses, employees, crews, trips] = await Promise.all([
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
      ])
      const err = statuses.error ?? employees.error ?? crews.error ?? trips.error
      if (!statuses.data || !employees.data || !crews.data || !trips.data) return
      if (err) {
        console.error('Failed to load HR summary', err)
        return
      }
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

  // Cards grouped by the same module names as the sidebar
  const summaryGroups = [
    {
      title: 'Operations',
      cards: [
        { label: 'Pending Quotes', value: summary.pendingQuotes },
        { label: 'Active Bookings', value: summary.activeBookings },
        { label: "Today's Deliveries", value: summary.todayDeliveries },
      ],
    },
    {
      title: 'Maintenance',
      cards: [
        { label: 'Trucks Operational', value: `${summary.trucksOperational}/${summary.truckCount}` },
        { label: 'Trailers Operational', value: `${summary.trailersOperational}/${summary.trailerCount}` },
      ],
    },
    {
      title: 'Human Resource',
      cards: [
        { label: 'Total Employees', value: hr?.total ?? '--' },
        { label: 'Drivers Available', value: hr ? `${hr.available}/${hr.drivers}` : '--' },
      ],
    },
    {
      title: 'Cash Advance',
      cards: [
        { label: 'Pending Approval', value: cashAdvance?.[0] ?? '--' },
        { label: 'Disbursed', value: cashAdvance?.[1] ?? '--' },
        { label: 'Deducted', value: cashAdvance?.[2] ?? '--' },
        { label: 'Current Balance', value: cashAdvance?.[3] ?? '--' },
      ],
    },
  ]

  // Title + one row of cards (as many equal columns as there are cards).
  // Used both beside Top Unpaid Clients and in the lower rows.
  const renderGroup = (group: (typeof summaryGroups)[number], columns = group.cards.length, large = false) => (
    <>
      <h2 className="font-ui text-sm font-medium text-neutral-500">{group.title}</h2>
      <div
        className="mt-2 grid flex-1 gap-2 sm:gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {group.cards.map((card) => (
          <div
            key={card.label}
            className={`reports-blueprint-card dashboard-card-bold ${
              large ? 'flex flex-col justify-center px-5 py-4' : 'px-3 py-2.5 sm:px-4 sm:py-3'
            }`}
          >
            <p className={`font-ui leading-tight text-reports-ink ${large ? 'text-base' : 'text-xs sm:text-sm'}`}>
              {card.label}
            </p>
            <p
              className={`font-condensed leading-none font-semibold ${
                ATTENTION_CARDS.has(card.label) ? 'text-primary' : 'text-reports-ink'
              } ${large ? 'mt-3 text-5xl font-bold' : 'mt-1 text-xl sm:text-2xl'}`}
            >
              {loading ? '--' : card.value}
            </p>
          </div>
        ))}
      </div>
    </>
  )

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome, ${username} · ${new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}`}
      />

      {summaryError && (
        <p className="mt-4 border border-red-200 bg-red-50 px-4 py-3 font-ui text-sm text-red-700">
          {summaryError}
        </p>
      )}

      <div className="reports-blueprint-card dashboard-card-bold mt-4 px-[22px] py-4">
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
              className="border border-reports-hairline px-2 py-1 font-ui text-sm text-reports-ink focus:border-accent-500 focus:outline-none"
            >
              {REVENUE_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="border border-reports-hairline px-2 py-1 font-ui text-sm text-reports-ink hover:border-accent-500"
            >
              Refresh
            </button>
          </div>
        </div>
        {revenueError ? (
          <p className="mt-2 font-ui text-sm text-red-700">{revenueError}</p>
        ) : (
          <p className="font-condensed mt-2 text-[40px] leading-none font-bold text-reports-ink">
            {revenueLoading ? '--' : `${formatMoney(revenue)}`}
          </p>
        )}
      </div>

      {/* Costs for the same period as the revenue dropdown above. */}
      {/* Stacked in a column on the left; hovering a card expands just that one. */}
      <div className="mt-5 flex flex-col gap-3 sm:gap-5 lg:flex-row lg:items-start">
      <div className="flex flex-col gap-3 sm:gap-5 lg:w-1/3">
        {[
          <OperationalExpensesCard key="op" period={rangePeriod} refreshKey={refreshKey} collapsed={openCard !== 'op'} />,
          <PayrollExpensesCard key="pay" period={rangePeriod} refreshKey={refreshKey} collapsed={openCard !== 'pay'} />,
          <MaintenanceExpensesCard key="mt" period={rangePeriod} refreshKey={refreshKey} collapsed={openCard !== 'mt'} />,
        ].map((card) => (
          <div
            key={card.key}
            onPointerEnter={() => setOpenCard(card.key as string)}
            onPointerLeave={() => setOpenCard(null)}
          >
            {card}
          </div>
        ))}
      </div>
      {/* Leaderboard to the right of the expense cards */}
      {/* Middle column: Top Unpaid Clients stretches to the full height of the row */}
      {/* ponytail: side columns are a fixed 376px (= 3 collapsed expense cards) so
          they don't grow when an expense card expands; update if card sizes change */}
      <div className="lg:h-[376px] lg:w-1/3">
        <TopCreditorsCard refreshKey={refreshKey} />
      </div>
      {/* Right column: the remaining summary groups, stacked */}
      <div className="flex flex-col gap-4 lg:h-[376px] lg:w-1/3">
        {summaryGroups
          .filter((g) => ['Maintenance', 'Human Resource'].includes(g.title))
          .map((group) => (
            <div key={group.title} className="flex flex-1 flex-col">{renderGroup(group, group.cards.length, true)}</div>
          ))}
      </div>
      </div>

      {/* Cash Advance with Operations to its right (width shared by card count) */}
      <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:gap-5">
        {['Cash Advance', 'Operations'].map((title) => {
          const group = summaryGroups.find((g) => g.title === title)!
          return (
            <div key={title} className="xl:min-w-0" style={{ flex: `${group.cards.length} 1 0` }}>
              {renderGroup(group)}
            </div>
          )
        })}
      </div>

      <div className="mt-5">
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
            <EmptyState message="No deliveries scheduled for today." className="mt-3" />
          )}

        {!todayDeliveriesLoading && todayDeliveryRows.length > 0 && (
          <>
          {/* Phone: one stacked card per delivery (the table is too wide) */}
          <div className="mt-3 flex flex-col gap-3 sm:hidden">
            {todayDeliveryRows.map((row) => (
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
                  {row.rate != null ? `${formatMoney(row.rate)}` : 'N/A'} · Truck{' '}
                  {row.truckPlateNumber ?? 'Unassigned'} · Trailer{' '}
                  {row.trailerPlateNumber ?? 'Unassigned'}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-3 hidden max-h-96 overflow-y-auto overflow-x-auto border-2 border-slate-400 bg-reports-bg sm:block">
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
                      {row.rate != null ? `${formatMoney(row.rate)}` : 'N/A'}
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
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  )
}

export default StaffDashboard
