// ProfitLossSection (Admin, Accounting -> Profit & Loss): one month's
// revenue minus costs = net profit, on an accrual basis (earned / incurred
// in the month). Printable like Statements. What goes into each line, and
// what is deliberately left out so nothing counts twice, is explained in
// lib/profitLossTotals.ts; loading is lib/profitLoss.ts.
import { useEffect, useState } from 'react'
import { loadProfitLoss, type ProfitLoss } from '../../../lib/profitLoss'
import { formatReportMonth } from '../../../lib/maintenanceCostReport'
import { toManilaDate } from '../../../lib/payslip'
import { COMPANY } from '../../../lib/company'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'

function ProfitLossSection() {
  const currentMonth = toManilaDate(new Date()).slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [pl, setPl] = useState<ProfitLoss | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // The month box can be cleared -- nothing to load then.
    if (!month) return
    let ignore = false
    setLoading(true)
    loadProfitLoss(month).then((result) => {
      if (ignore) return // a newer month pick already replaced this one
      setPl(result.data)
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
        title="Profit & Loss"
        subtitle="Monthly revenue against costs."
        actions={<>
        <div className="flex items-center gap-2">
          <label htmlFor="pl-month" className="text-sm font-medium text-slate-700">Month</label>
          <input
            id="pl-month"
            type="month"
            value={month}
            max={currentMonth}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
          />
          <button
            onClick={() => window.print()}
            disabled={!pl}
            className="btn-primary px-3 py-1.5 text-sm font-medium"
          >
            Print
          </button>
        </div>
        </>}
      />

      {loading && <p className="mt-4 text-slate-500 print:hidden">Adding it all up...</p>}
      {error && <p className="mt-4 text-red-700 print:hidden">{error}</p>}

      {pl && !loading && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
            <Card label="Revenue" value={formatMoney(pl.totalRevenue)} />
            <Card label="Costs" value={formatMoney(pl.totalCosts)} />
            <Card
              label="Net profit"
              value={formatMoney(pl.net)}
              note={pl.marginPct === null ? undefined : `${pl.marginPct}% margin`}
              danger={pl.net < 0}
            />
            <Card label="Cash collected" value={formatMoney(pl.memo.collected)} note="for comparison" />
          </div>

          <div className="mt-4 max-w-3xl border border-slate-200 bg-white p-6 shadow-sm print:mt-0 print:max-w-none print:border-0 print:p-0 print:shadow-none">
            <p className="text-sm font-bold text-slate-900">{COMPANY.name}</p>
            <p className="text-xs text-slate-500">{COMPANY.address} · {COMPANY.phone}</p>
            <h3 className="mt-3 text-lg font-bold text-slate-900">Profit &amp; Loss — {formatReportMonth(month)}</h3>

            <Section title="Revenue" lines={pl.revenue} total={pl.totalRevenue} totalLabel="Total revenue" />
            <Section title="Costs" lines={pl.costs} total={pl.totalCosts} totalLabel="Total costs" />

            <div className={`mt-4 flex justify-between border-t-2 border-slate-900 pt-2 text-base font-bold ${pl.net < 0 ? 'text-red-700' : 'text-slate-900'}`}>
              <span>Net profit{pl.marginPct !== null && ` (${pl.marginPct}%)`}</span>
              <span>{formatMoney(pl.net)}</span>
            </div>

            <div className="mt-6 text-xs text-slate-500">
              <p className="font-medium uppercase tracking-wide">Not included above</p>
              <ul className="mt-1 list-disc pl-4">
                {pl.memo.partsBought > 0 && (
                  <li>Parts bought {formatMoney(pl.memo.partsBought)} — added to inventory, counted when used.</li>
                )}
                {pl.memo.dieselEstimated > 0 && (
                  <li>Estimated diesel {formatMoney(pl.memo.dieselEstimated)} for trips with no fuel logged.</li>
                )}
                {pl.memo.draftPayroll > 0 && (
                  <li>Payroll above includes {formatMoney(pl.memo.draftPayroll)} still on draft payslips.</li>
                )}
                <li>Cash collected this month: {formatMoney(pl.memo.collected)}.</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Section({
  title,
  lines,
  total,
  totalLabel,
}: {
  title: string
  lines: { label: string; amount: number }[]
  total: number
  totalLabel: string
}) {
  return (
    <div className="mt-5 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      {lines.length === 0 && <p className="py-1 text-slate-500">None this month.</p>}
      {lines.map((line) => (
        <div key={line.label} className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-slate-700">
          <span>{line.label}</span>
          <span className="whitespace-nowrap text-slate-900">{formatMoney(line.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between py-1.5 font-semibold text-slate-900">
        <span>{totalLabel}</span>
        <span>{formatMoney(total)}</span>
      </div>
    </div>
  )
}

function Card({ label, value, note, danger }: { label: string; value: string; note?: string; danger?: boolean }) {
  return (
    <div className="border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${danger ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

export default ProfitLossSection
