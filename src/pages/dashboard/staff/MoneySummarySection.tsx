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
//
// The "Why Collected differs from Revenue" card is a short version of
// Accounting -> Revenue Reconciliation (loadRevenueReconciliation +
// gapByReason). It loads on its own, so if it fails the rest of the page
// still shows.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { loadProfitLoss } from '../../../lib/profitLoss'
import { loadRevenueReconciliation } from '../../../lib/revenueReconciliation'
import { gapByReason } from '../../../lib/revenueReconTotals'
import { buildMoneySummary, monthLabel, shiftMonth, type MoneySummary } from '../../../lib/moneySummary'

// The summary plus short notes on the Expenses figure -- what in it is an
// estimate or not final yet, so the profit isn't read as exact.
type SummaryWithNotes = MoneySummary & { expenseNotes: string[] }

async function fetchMoneySummary(month: string): Promise<SummaryWithNotes> {
  const { data, error } = await loadProfitLoss(month)
  if (error || !data) throw new Error(error ?? 'Could not load this month.')
  const expenseNotes: string[] = []
  if (data.parts.dieselEstimatedTrips > 0) {
    expenseNotes.push(
      `Diesel includes ${formatMoney(data.parts.dieselEstimated)} estimated for ${data.parts.dieselEstimatedTrips} trip${
        data.parts.dieselEstimatedTrips === 1 ? '' : 's'
      } with no fuel logged.`,
    )
  }
  if (data.memo.draftPayroll > 0) {
    expenseNotes.push(`Salaries include ${formatMoney(data.memo.draftPayroll)} from draft payslips (not final yet).`)
  }
  const summary = buildMoneySummary({
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
  return { ...summary, expenseNotes }
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

// Plain-language names for the reconciliation's per-booking "why" tags.
const GAP_LABELS: Record<string, string> = {
  'Paid ahead of delivery': 'Paid ahead (trips not delivered yet)',
  'Paying earlier months': "Paid for earlier months' trips",
  'Not fully paid yet': 'Billed, not paid yet',
  'Paid in another month': 'Billed, paid in another month',
}

type Gap = {
  billed: number
  collected: number
  lines: { reason: string; amount: number; bookings: number }[]
}

async function fetchGap(month: string): Promise<Gap> {
  const { data, error } = await loadRevenueReconciliation(month)
  if (error || !data) throw new Error(error ?? 'Could not load this month.')
  return {
    billed: data.tripRevenue + data.adjustments,
    collected: data.collected,
    lines: gapByReason(data.rows),
  }
}

// "Collected vs Revenue" in plain words: the difference, and what it is made of.
function GapCard({ gap, error, summary }: { gap: Gap | null; error: string | null; summary: MoneySummary }) {
  const difference = gap ? gap.collected - gap.billed : 0
  // The cards above come from the Profit & Loss loader, this card from the
  // statement ledger; they should agree. If not, say so instead of hiding it.
  const mismatch = gap
    ? Math.abs(gap.billed - summary.earned) > 0.005 || Math.abs(gap.collected - summary.collected) > 0.005
    : false
  return (
    <div className="mt-6 border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Why Collected is not the same as Revenue</h3>
        <Link to="/dashboard/revenue-reconciliation" className="shrink-0 text-sm font-medium text-primary hover:underline">
          See details →
        </Link>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : !gap ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-slate-600">
            Collected {formatMoney(gap.collected)} − Revenue {formatMoney(gap.billed)} ={' '}
            <span className="font-semibold text-slate-900">
              {difference > 0 ? '+' : ''}
              {formatMoney(difference)}
            </span>
          </p>
          {gap.lines.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Everything billed this month was collected.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {gap.lines.map((line) => (
                <li key={line.reason} className="flex justify-between gap-3">
                  <span className="text-slate-700">
                    {GAP_LABELS[line.reason] ?? line.reason}
                    <span className="text-slate-400">
                      {' '}
                      · {line.bookings} booking{line.bookings === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className={`font-medium ${line.amount < 0 ? 'text-red-700' : 'text-slate-900'}`}>
                    {line.amount > 0 ? '+' : ''}
                    {formatMoney(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {mismatch && (
            <p className="mt-3 text-xs text-amber-700">
              These figures differ slightly from the cards above ({formatMoney(gap.billed)} billed,{' '}
              {formatMoney(gap.collected)} collected) -- check Revenue Reconciliation.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function MoneySummarySection() {
  const [month, setMonth] = useState(() => toManilaDate(new Date()).slice(0, 7))
  const [summary, setSummary] = useState<SummaryWithNotes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gap, setGap] = useState<Gap | null>(null)
  const [gapError, setGapError] = useState<string | null>(null)
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
    fetchGap(month)
      .then((g) => {
        if (cancelled) return
        setGap(g)
        setGapError(null)
      })
      .catch((e: Error) => !cancelled && setGapError(e.message))
    return () => {
      cancelled = true
    }
  }, [month])

  function go(delta: number) {
    setSummary(null)
    setGap(null)
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
            <BigNumber
              label="Expenses"
              value={formatMoney(summary.spent)}
              note={summary.expenseNotes.length > 0 ? summary.expenseNotes.join(' ') : undefined}
            />
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

          <GapCard gap={gap} error={gapError} summary={summary} />

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
