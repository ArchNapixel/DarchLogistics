// MoneySummarySection: Expenses -> Money Summary (/dashboard/money-summary,
// Admin only). One month: revenue (trips delivered that month), expenses
// (salaries, diesel, trip expenses, truck repairs, damage the company
// paid), net profit, the cash actually collected, and two breakdowns:
// revenue per client and expenses per category. Read-only.
//
// Numbers come from loadProfitLoss() (lib/profitLoss.ts) -- the same
// figures as the rest of the app -- turned into this summary by
// buildMoneySummary() (lib/moneySummary.ts). Supplier bills are left out
// for now (Accounts Payable is hidden).
import { useEffect, useState } from 'react'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { loadProfitLoss } from '../../../lib/profitLoss'
import { buildMoneySummary, monthLabel, shiftMonth, type MoneySummary } from '../../../lib/moneySummary'

async function fetchMoneySummary(month: string): Promise<MoneySummary> {
  const { data, error } = await loadProfitLoss(month)
  if (error || !data) throw new Error(error ?? 'Could not load this month.')
  return buildMoneySummary({
    earned: data.totalRevenue,
    revenueRows: data.revenueRows,
    collected: data.memo.collected,
    tripCount: data.tripCount,
    salaries: data.parts.payroll,
    diesel: data.parts.diesel,
    tripExpenses: data.parts.tripExpenses,
    repairs: data.parts.maintenanceParts,
    damage: data.parts.companyDamage,
  })
}

function BigNumber({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${tone ?? 'text-slate-900'}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

// A titled list of amounts with bars sized against the biggest one.
function Breakdown({
  title,
  lines,
  empty,
  barClass,
}: {
  title: string
  lines: { label: string; amount: number }[]
  empty: string
  barClass: string
}) {
  const biggest = Math.max(...lines.map((l) => Math.abs(l.amount)), 0)
  return (
    <div className="border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {lines.map((line) => (
            <li key={line.label} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate text-slate-700">{line.label}</span>
                <span className={`font-medium ${line.amount < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                  {formatMoney(line.amount)}
                </span>
              </div>
              <div className="mt-1 h-2 bg-slate-100">
                <div
                  className={`h-full ${barClass}`}
                  style={{ width: `${biggest > 0 ? (Math.abs(line.amount) / biggest) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MoneySummarySection() {
  const [month, setMonth] = useState(() => toManilaDate(new Date()).slice(0, 7))
  const [summary, setSummary] = useState<MoneySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const thisMonth = toManilaDate(new Date()).slice(0, 7)

  useEffect(() => {
    let cancelled = false
    fetchMoneySummary(month)
      .then((s) => {
        if (cancelled) return
        setSummary(s)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [month])

  function go(delta: number) {
    setSummary(null)
    setMonth((m) => shiftMonth(m, delta))
  }

  return (
    <div>
      <PageHeader title="Money Summary" subtitle="Revenue, expenses and net profit -- one month at a time." />

      <div className="flex items-center gap-3">
        <button type="button" aria-label="Previous month" onClick={() => go(-1)} className="border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50">
          ‹
        </button>
        <span className="min-w-36 text-center text-lg font-semibold text-slate-900">{monthLabel(month)}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => go(1)}
          disabled={month >= thisMonth}
          className="border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
        >
          ›
        </button>
      </div>

      {error ? (
        <p className="mt-6 text-red-700">{error}</p>
      ) : !summary ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <BigNumber
              label="Revenue"
              value={formatMoney(summary.earned)}
              note={`from ${summary.tripCount} delivered trip${summary.tripCount === 1 ? '' : 's'}`}
            />
            <BigNumber label="Expenses" value={formatMoney(summary.spent)} />
            <BigNumber
              label={summary.left < 0 ? 'Net loss' : 'Net profit'}
              value={formatMoney(summary.left)}
              tone={summary.left < 0 ? 'text-red-700' : 'text-green-700'}
              note={
                summary.earned > 0
                  ? `${Math.round((summary.left / summary.earned) * 1000) / 10}% of revenue`
                  : undefined
              }
            />
          </div>

          <p className="mt-4 text-sm text-slate-600">
            Collected this month: <span className="font-semibold text-slate-900">{formatMoney(summary.collected)}</span>
            <span className="text-slate-400"> (client payments actually received)</span>
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Breakdown
              title="Revenue breakdown (by client)"
              lines={summary.revenueByClient}
              empty="No revenue this month."
              barClass="bg-green-600"
            />
            <Breakdown
              title="Expenses breakdown"
              lines={summary.spending}
              empty="No expenses recorded this month."
              barClass="bg-slate-700"
            />
          </div>
        </>
      )}
    </div>
  )
}

export default MoneySummarySection
