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
// The "Why Collected differs from Revenue" card comes from the revenue
// reconciliation numbers (loadRevenueReconciliation + gapByReason; the
// full Revenue Reconciliation page was removed 2026-10-23). It loads on its own, so if it fails the rest of the page
// still shows.
//
// Second tab, "Expense Breakdown" (?tab=expenses): the Admin dashboard's
// Operational / Payroll / Maintenance expense cards, fully opened, for the
// same month. The dashboard cards link here (#op / #pay / #mt scrolls to
// the one clicked). Those cards use their own loaders (dashboardExpenses.ts),
// so their totals can differ a little from the Summary tab's Expenses.
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { loadProfitLoss } from '../../../lib/profitLoss'
import { loadRevenueReconciliation } from '../../../lib/revenueReconciliation'
import { gapByReason } from '../../../lib/revenueReconTotals'
import { buildMoneySummary, monthLabel, shiftMonth, type MoneySummary } from '../../../lib/moneySummary'
import OperationalExpensesCard from './OperationalExpensesCard'
import PayrollExpensesCard from './PayrollExpensesCard'
import MaintenanceExpensesCard from './MaintenanceExpensesCard'

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'expenses', label: 'Expense Breakdown' },
] as const

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
    <div className="card px-5 py-4">
      <p className="text-sm font-medium text-ink-secondary">{label}</p>
      <p className={`text-[26px] leading-[34px] font-bold tracking-[-0.01em] tabular-nums ${tone ?? 'text-ink'}`}>{value}</p>
      {note && <p className="mt-1 text-[13px] text-ink-muted">{note}</p>}
    </div>
  )
}

// "How the net result is worked out": revenue in, each expense out, the net
// at the bottom -- every bar sized against the biggest amount.
function NetWaterfall({ summary }: { summary: MoneySummary }) {
  const lines = [
    { label: 'Revenue', amount: summary.earned, sign: '+', bar: 'bg-primary' },
    ...summary.spending.map((s) => ({ label: s.label, amount: s.amount, sign: '−', bar: 'bg-ink-secondary' })),
  ]
  const biggest = Math.max(...lines.map((l) => Math.abs(l.amount)), Math.abs(summary.left), 0)
  const width = (n: number) => `${biggest > 0 ? (Math.abs(n) / biggest) * 100 : 0}%`
  const row = 'grid min-h-16 grid-cols-[minmax(0,160px)_minmax(0,1fr)_minmax(0,150px)] items-center gap-4 border-b border-slate-200 text-sm'
  return (
    <section className="card px-5 py-4">
      <h2 className="mb-1 border-b border-line pb-2 text-sm font-semibold text-ink">How the net result is worked out</h2>
      <p className="text-[13px] text-ink-muted">Bars are scaled to the largest amount, {formatMoney(biggest)}.</p>
      {lines.map((line) => (
        <div key={line.label} className={row}>
          <span className="text-ink-secondary">{line.label}</span>
          <div className="h-4 bg-slate-200" aria-hidden="true">
            <div className={`h-4 ${line.bar} ${line.amount ? 'min-w-1' : ''}`} style={{ width: width(line.amount) }} />
          </div>
          <span className="text-right font-bold tabular-nums whitespace-nowrap">
            {line.sign} {formatMoney(line.amount)}
          </span>
        </div>
      ))}
      <div className={`${row} border-b-0`}>
        <span className={`font-semibold ${summary.left < 0 ? 'text-red-700' : 'text-green-800'}`}>
          {summary.left < 0 ? 'Net loss' : 'Net profit'}
        </span>
        <div className="h-4 bg-slate-200" aria-hidden="true">
          <div className={`h-4 ${summary.left < 0 ? 'bg-red-700' : 'bg-green-700'}`} style={{ width: width(summary.left) }} />
        </div>
        <span className={`text-right font-bold tabular-nums whitespace-nowrap ${summary.left < 0 ? 'text-red-700' : 'text-green-800'}`}>
          {summary.left < 0 ? '− ' : ''}
          {formatMoney(Math.abs(summary.left))}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3 border border-line bg-slate-50 px-4 py-3 text-sm">
        <span className="font-semibold text-ink">Collected this month</span>
        <span className="text-[13px] text-ink-muted">Client payments actually received. Shown for reference, not part of the net.</span>
        <span className="font-bold tabular-nums">{formatMoney(summary.collected)}</span>
      </div>
    </section>
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
    <div className="card px-5 py-4">
      <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-ink">{title}</h3>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {lines.map((line) => (
            <li key={line.label} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate text-ink-secondary">{line.label}</span>
                <span className={`font-semibold tabular-nums ${line.amount < 0 ? 'text-red-700' : 'text-ink'}`}>
                  {formatMoney(line.amount)}
                </span>
              </div>
              <div className="mt-1 h-3 bg-slate-200">
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
    <div className="card mt-6 px-5 py-4">
      <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-ink">Why Collected is not the same as Revenue</h3>
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
              {formatMoney(gap.collected)} collected).
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
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'expenses' ? 'expenses' : 'summary'
  const { hash } = useLocation()
  // Memoized: the expense cards reload whenever this object changes.
  const period = useMemo(() => ({ month }), [month])

  // Coming from a dashboard card (#op / #pay / #mt): scroll to that card.
  useEffect(() => {
    if (tab === 'expenses' && hash) document.getElementById(hash.slice(1))?.scrollIntoView()
  }, [tab, hash])

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
      <PageHeader
        title="Money Summary"
        subtitle="Money earned against money spent, one month at a time."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => go(-1)}
              className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span className="flex h-11 min-w-44 items-center justify-center gap-2 border border-line bg-white px-4 text-sm font-semibold text-ink">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden="true">
                <path d="M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9h16 M8 2v4 M16 2v4" />
              </svg>
              {month === thisMonth ? 'This month · ' : ''}
              {monthLabel(month)}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => go(1)}
              disabled={month >= thisMonth}
              className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-muted"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            aria-pressed={tab === t.key}
            onClick={() => setSearchParams(t.key === 'summary' ? {} : { tab: t.key })}
            className={`h-11 rounded-[2px] border px-5 text-sm font-semibold ${
              tab === t.key ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'expenses' ? (
        <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
          <div id="op" className="scroll-mt-4">
            <OperationalExpensesCard period={period} refreshKey={0} />
          </div>
          <div id="pay" className="scroll-mt-4">
            <PayrollExpensesCard period={period} refreshKey={0} />
          </div>
          <div id="mt" className="scroll-mt-4">
            <MaintenanceExpensesCard period={period} refreshKey={0} />
          </div>
        </div>
      ) : error ? (
        <p className="text-red-700">{error}</p>
      ) : !summary ? (
        <p className="text-ink-muted">Loading…</p>
      ) : (
        <>
          <section aria-label={`Totals for ${monthLabel(month)}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <BigNumber
              label="Revenue"
              value={formatMoney(summary.earned)}
              note={`from ${summary.tripCount} delivered trip${summary.tripCount === 1 ? '' : 's'}`}
            />
            <BigNumber label="Collected" value={formatMoney(summary.collected)} note="client payments received" />
            <BigNumber
              label="Expenses"
              value={formatMoney(summary.spent)}
              note={summary.expenseNotes.length > 0 ? summary.expenseNotes.join(' ') : undefined}
            />
            <BigNumber
              label={summary.left < 0 ? 'Net loss' : 'Net profit'}
              value={`${summary.left < 0 ? '−' : ''}${formatMoney(Math.abs(summary.left))}`}
              tone={summary.left < 0 ? 'text-red-700' : 'text-green-800'}
              note={
                summary.earned > 0
                  ? `${Math.round((summary.left / summary.earned) * 1000) / 10}% of revenue`
                  : undefined
              }
            />
          </section>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
            <NetWaterfall summary={summary} />
            <Breakdown
              title="Revenue by client"
              lines={summary.revenueByClient}
              empty="No revenue this month."
              barClass="bg-primary"
            />
          </div>

          <GapCard gap={gap} error={gapError} summary={summary} />
        </>
      )}
    </div>
  )
}

export default MoneySummarySection
