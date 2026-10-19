// RevenueReconciliationSection (Admin, Accounting -> Revenue Reconciliation):
// for one month, how much was BILLED (delivered trips + adjustments) versus
// COLLECTED (payments received), why they differ booking by booking, and
// how both compare with the dashboard's revenue card and Trip
// Profitability. Read-only. Math: lib/revenueReconTotals.ts; loading:
// lib/revenueReconciliation.ts.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadRevenueReconciliation } from '../../../lib/revenueReconciliation'
import { toManilaDate } from '../../../lib/payslip'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

type Data = NonNullable<Awaited<ReturnType<typeof loadRevenueReconciliation>>['data']>

function RevenueReconciliationSection() {
  const currentMonth = toManilaDate(new Date()).slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The month box can be cleared -- nothing to load then.
    if (!month) return
    let ignore = false
    setLoading(true)
    loadRevenueReconciliation(month).then((result) => {
      if (ignore) return // a newer month pick already replaced this one
      setData(result.data)
      setError(result.error)
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [month])

  return (
    <div>
      <PageHeader
        title="Revenue Reconciliation"
        subtitle="Why billed, collected and dashboard revenue differ for a month."
        actions={<>
        <div className="flex items-center gap-2">
          <label htmlFor="recon-month" className="text-sm font-medium text-slate-700">
            Month
          </label>
          <input
            id="recon-month"
            type="month"
            value={month}
            max={currentMonth}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
          />
        </div>
        </>}
      />

      {loading && <p className="mt-4 text-slate-500">Reconciling...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}

      {data && !loading && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card label="Trip revenue" value={formatMoney(data.tripRevenue)} note="Trip Profitability" />
            <Card label="Adjustments" value={formatMoney(data.adjustments)} note="damage, discounts, advance" />
            <Card label="Billed" value={formatMoney(data.tripRevenue + data.adjustments)} />
            <Card label="Collected" value={formatMoney(data.collected)} note="Collections, net of refunds" />
            <Card label="Dashboard card" value={formatMoney(data.dashboardCard)} note="bookings made this month" />
          </div>

          <div className="mt-4 border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Receivables</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-700">
              <span>Start of month <b className="text-slate-900">{formatMoney(data.opening)}</b></span>
              <span>+ billed <b className="text-slate-900">{formatMoney(data.tripRevenue + data.adjustments)}</b></span>
              <span>− collected <b className="text-slate-900">{formatMoney(data.collected)}</b></span>
              <span>= end of month <b className="text-slate-900">{formatMoney(data.closing)}</b></span>
            </div>
          </div>

          {data.rows.length === 0 ? (
            <EmptyState message="Nothing was billed or collected in this month." className="mt-4" />
          ) : (
            <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Booking</th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 text-right font-medium">Trip revenue</th>
                    <th className="px-4 py-3 text-right font-medium">Adjustments</th>
                    <th className="px-4 py-3 text-right font-medium">Collected</th>
                    <th className="px-4 py-3 text-right font-medium">Billed − collected</th>
                    <th className="px-4 py-3 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.booking_id} className="border-b border-slate-100">
                      <td className="px-4 py-3">
                        <Link to={`/dashboard/bookings?booking=${r.booking_id}`} className="text-slate-900 hover:underline">
                          #{r.booking_id}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{r.client_name}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{formatMoney(r.trip_revenue)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{formatMoney(r.adjustments)}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{formatMoney(r.collected)}</td>
                      <td className={`px-4 py-3 text-right font-medium ${r.difference < 0 ? 'text-amber-700' : 'text-slate-900'}`}>
                        {formatMoney(r.difference)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.reason}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-slate-900">
                    <td className="px-4 py-3" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right">{formatMoney(data.tripRevenue)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(data.adjustments)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(data.collected)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(data.difference)}</td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

export default RevenueReconciliationSection
