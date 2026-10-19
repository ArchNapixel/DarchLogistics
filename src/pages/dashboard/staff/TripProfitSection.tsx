// TripProfitSection (Admin, Accounting -> Trip Profitability): how much each
// delivered trip actually made. Pick a month, optionally narrow by client or
// truck. Read-only. How a trip's revenue/cost is worked out is explained in
// lib/tripProfitTotals.ts; loading is lib/tripProfit.ts.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  buildTripProfitCsv,
  currentTripProfitMonth,
  loadTripProfitReport,
  type TripProfitRow,
} from '../../../lib/tripProfit'
import { summarizeTrips } from '../../../lib/tripProfitTotals'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

// Red when a trip lost money, plain otherwise.
const profitClass = (value: number) => (value < 0 ? 'text-red-700' : 'text-slate-900')

const SETTING_LABELS: Record<string, string> = {
  diesel_price_per_liter: 'diesel price per liter',
  driver_commission_rate: 'driver commission rate',
  driver_per_trip_fee: 'driver per-trip fee',
}

function TripProfitSection() {
  const [month, setMonth] = useState(currentTripProfitMonth())
  const [rows, setRows] = useState<TripProfitRow[]>([])
  const [settingsMissing, setSettingsMissing] = useState<string[]>([])
  const [clientFilter, setClientFilter] = useState('')
  const [truckFilter, setTruckFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  async function load() {
    // The month box can be cleared -- nothing to load then.
    if (!month) return
    setLoading(true)

    const result = await loadTripProfitReport(month)

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setRows(result.rows)
    setSettingsMissing(result.settingsMissing)
    // A client/truck picked for another month might not exist in this one.
    setClientFilter('')
    setTruckFilter('')
    setError(null)
    setLoading(false)
  }

  // Dropdown choices come from what's actually in this month.
  const clients = useMemo(
    () =>
      Array.from(new Map(rows.map((r) => [r.client_id, r.client_name]))).sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [rows],
  )
  const trucks = useMemo(
    () => Array.from(new Set(rows.map((r) => r.plate_number).filter((p): p is string => !!p))).sort(),
    [rows],
  )

  const visible = rows.filter(
    (r) =>
      (!clientFilter || String(r.client_id) === clientFilter) &&
      (!truckFilter || r.plate_number === truckFilter),
  )
  const totals = summarizeTrips(visible)

  function handleDownload() {
    const csv = buildTripProfitCsv(month, visible)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `trip-profitability_${month}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const selectClass = 'border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900'

  return (
    <div>
      <PageHeader
        title="Trip Profitability"
        subtitle="Revenue and cost of each delivered trip."
        actions={<>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="trip-profit-month" className="text-sm font-medium text-slate-700">
            Month
          </label>
          <input
            id="trip-profit-month"
            type="month"
            value={month}
            max={currentTripProfitMonth()}
            onChange={(e) => setMonth(e.target.value)}
            className={selectClass}
          />
          <select
            aria-label="Filter by client"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">All clients</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by truck"
            value={truckFilter}
            onChange={(e) => setTruckFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">All trucks</option>
            {trucks.map((plate) => (
              <option key={plate} value={plate}>
                {plate}
              </option>
            ))}
          </select>
          <button
            onClick={handleDownload}
            disabled={visible.length === 0}
            className="btn-primary px-3 py-1.5 text-sm font-medium"
          >
            Download CSV
          </button>
        </div>
        </>}
      />
      {settingsMissing.length > 0 && (
        <p className="mt-4 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Not set in Settings, counted as 0:{' '}
          {settingsMissing.map((key) => SETTING_LABELS[key] ?? key).join(', ')}. Profits are
          overstated until they're filled in.
        </p>
      )}

      {loading && <p className="mt-4 text-slate-500">Loading trips...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState message="No trips were delivered in this month." className="mt-4" />
      )}
      {!loading && !error && rows.length > 0 && visible.length === 0 && (
        <EmptyState message="No trips match these filters." className="mt-4" />
      )}

      {!loading && !error && visible.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Trips" value={String(totals.trips)} />
            <Card label="Revenue" value={formatMoney(totals.revenue)} />
            <Card label="Total cost" value={formatMoney(totals.totalCost)} />
            <Card
              label="Profit"
              value={formatMoney(totals.profit)}
              note={totals.marginPct === null ? undefined : `${totals.marginPct}% margin`}
              danger={totals.profit < 0}
            />
          </div>

          <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Delivered</th>
                  <th className="px-4 py-3 font-medium">Booking</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Truck</th>
                  <th className="px-4 py-3 text-right font-medium">Revenue</th>
                  <th className="px-4 py-3 text-right font-medium">Driver pay</th>
                  <th className="px-4 py-3 text-right font-medium">Diesel</th>
                  <th className="px-4 py-3 text-right font-medium">Other</th>
                  <th className="px-4 py-3 text-right font-medium">Damage</th>
                  <th className="px-4 py-3 text-right font-medium">Profit</th>
                  <th className="px-4 py-3 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.itinerary_id} className="border-b border-slate-100">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r.delivered_on}</td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/dashboard/bookings?booking=${r.booking_id}`}
                        className="text-slate-900 hover:underline"
                      >
                        #{r.booking_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{r.client_name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.plate_number ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatMoney(r.revenue)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatMoney(r.driverPay)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                      {formatMoney(r.diesel)}
                      {r.dieselEstimated && <span className="ml-1 text-xs text-slate-400">est.</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatMoney(r.otherExpenses)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{formatMoney(r.companyDamage)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${profitClass(r.profit)}`}>
                      {formatMoney(r.profit)}
                    </td>
                    <td className={`px-4 py-3 text-right ${profitClass(r.profit)}`}>
                      {r.marginPct === null ? '—' : `${r.marginPct}%`}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold text-slate-900">
                  <td className="px-4 py-3" colSpan={4}>
                    Total
                  </td>
                  <td className="px-4 py-3 text-right">{formatMoney(totals.revenue)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(totals.driverPay)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(totals.diesel)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(totals.otherExpenses)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(totals.companyDamage)}</td>
                  <td className={`px-4 py-3 text-right ${profitClass(totals.profit)}`}>
                    {formatMoney(totals.profit)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {totals.marginPct === null ? '—' : `${totals.marginPct}%`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Card({
  label,
  value,
  note,
  danger,
}: {
  label: string
  value: string
  note?: string
  danger?: boolean
}) {
  return (
    <div className="border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${danger ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

export default TripProfitSection
