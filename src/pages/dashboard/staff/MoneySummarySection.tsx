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
// Summary tab order (2026-11-16): tiles with "vs last month", Money in / Money
// out, Cash on hand + Government remittances, Where we stand today, net
// result + Revenue by client (billed vs collected), Per trip + six-month
// trend, the Collected-vs-Revenue gap. The extra panels live in
// FinanceSummaryPanels.tsx.
//
// Second tab, "Expense Breakdown" (?tab=expenses): the Admin dashboard's
// Operational / Payroll / Maintenance expense cards, fully opened, for the
// same month. The dashboard cards link here (#op / #pay / #mt scrolls to
// the one clicked). Those cards use their own loaders (dashboardExpenses.ts),
// so their totals can differ a little from the Summary tab's Expenses.
import { previewCsv } from '../../../components/CsvPreview'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { loadProfitLoss } from '../../../lib/profitLoss'
import { loadRevenueReconciliation } from '../../../lib/revenueReconciliation'
import { gapByReason } from '../../../lib/revenueReconTotals'
import { buildMoneySummary, buildMoneySummaryCsv, monthLabel, shiftMonth, type CashFlow, type MoneySummary } from '../../../lib/moneySummary'
import { loadCashFlow } from '../../../lib/cashFlow'
import { loadCollectedByClient } from '../../../lib/financeSnapshot'
import { billedVsCollected } from '../../../lib/moneySummary'
import {
  BilledVsCollectedCard,
  CashOnHandCard,
  ChangeNote,
  PerTripCard,
  RemittancesCard,
  StandingStrip,
  TrendCard,
} from './FinanceSummaryPanels'
import OperationalExpensesCard from './OperationalExpensesCard'
import PayrollExpensesCard from './PayrollExpensesCard'
import MaintenanceExpensesCard from './MaintenanceExpensesCard'

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'expenses', label: 'Expense Breakdown' },
] as const

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

function BigNumber({ label, value, tone, children }: { label: string; value: string; tone?: string; children?: ReactNode }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-sm font-medium text-ink-secondary">{label}</p>
      <p className={`text-[26px] leading-[34px] font-bold tracking-[-0.01em] tabular-nums ${tone ?? 'text-ink'}`}>{value}</p>
      {children}
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
        <span className="font-bold tabular-nums">{formatMoney(summary.collected)}</span>
      </div>
    </section>
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
function GapCard({ gap, error }: { gap: Gap | null; error: string | null }) {
  const difference = gap ? gap.collected - gap.billed : 0
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
        </>
      )}
    </div>
  )
}

// "Money in / Money out": cash that actually moved this month, separate from
// profit (lib/cashFlow.ts says what each line counts). Loads on its own like
// GapCard, so a failure here doesn't hide the rest of the page.
function CashFlowCard({
  flow,
  error,
  before,
  month,
}: {
  flow: CashFlow | null
  error: string | null
  before: number | null | undefined // last month's net, for "▲ x% vs Oct"
  month: string
}) {
  const column = (title: string, lines: CashFlow['moneyIn'], total: number, sign: string) => (
    <div>
      <h4 className="text-[13px] font-semibold tracking-wide text-ink-secondary uppercase">{title}</h4>
      <ul className="mt-2 flex flex-col">
        {lines.map((line) => (
          <li key={line.label} className="flex justify-between gap-3 border-b border-slate-200 py-2 text-sm">
            <span className={line.amount === 0 ? 'text-ink-muted' : 'text-ink-secondary'}>{line.label}</span>
            <span className="font-medium tabular-nums whitespace-nowrap">
              {line.amount === 0 ? '—' : `${sign} ${formatMoney(line.amount)}`}
            </span>
          </li>
        ))}
        <li className="flex justify-between gap-3 py-2 text-sm font-semibold text-ink">
          <span>Total</span>
          <span className="tabular-nums whitespace-nowrap">
            {sign} {formatMoney(total)}
          </span>
        </li>
      </ul>
    </div>
  )
  return (
    <section className="card mt-4 px-5 py-4">
      <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-ink">Money in / Money out</h3>
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : !flow ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-3 grid gap-6 md:grid-cols-2">
            {column('Money in', flow.moneyIn, flow.totalIn, '+')}
            {column('Money out', flow.moneyOut, flow.totalOut, '−')}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3 border border-line bg-slate-50 px-4 py-3 text-sm">
            <span className="font-semibold text-ink">Net money movement</span>
            <span className="text-right">
              <span className={`font-bold tabular-nums ${flow.net < 0 ? 'text-red-700' : 'text-green-800'}`}>
                {flow.net < 0 ? '− ' : '+ '}
                {formatMoney(Math.abs(flow.net))}
              </span>
              <ChangeNote now={flow.net} before={before} month={month} />
            </span>
          </div>
        </>
      )}
    </section>
  )
}

function MoneySummarySection() {
  const [month, setMonth] = useState(() => toManilaDate(new Date()).slice(0, 7))
  const [summary, setSummary] = useState<MoneySummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gap, setGap] = useState<Gap | null>(null)
  const [gapError, setGapError] = useState<string | null>(null)
  const [cashFlow, setCashFlow] = useState<CashFlow | null>(null)
  const [cashFlowError, setCashFlowError] = useState<string | null>(null)
  // The five months before this one (for "vs last month" and the trend),
  // last month's cash flow, and this month's payments per client. Each is
  // stored with the month it was loaded for, so a stale one never shows.
  const [history, setHistory] = useState<{ month: string; rows: { month: string; summary: MoneySummary }[] } | null>(null)
  const [prevFlow, setPrevFlow] = useState<{ month: string; flow: CashFlow | null } | null>(null)
  const [collected, setCollected] = useState<{
    month: string
    rows: { client_name: string; amount: number }[]
    error: string | null
  } | null>(null)
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
    void loadCashFlow(month).then(({ data, error: flowError }) => {
      if (cancelled) return
      setCashFlow(data)
      setCashFlowError(flowError)
    })
    const earlier = [5, 4, 3, 2, 1].map((n) => shiftMonth(month, -n))
    // A month that fails to load is just left out of the trend.
    void Promise.all(earlier.map((m) => fetchMoneySummary(m).then((s) => ({ month: m, summary: s }), () => null))).then(
      (rows) => !cancelled && setHistory({ month, rows: rows.filter((r) => r !== null) }),
    )
    void loadCashFlow(shiftMonth(month, -1)).then(({ data }) => !cancelled && setPrevFlow({ month, flow: data }))
    void loadCollectedByClient(month).then((r) => !cancelled && setCollected({ month, ...r }))
    return () => {
      cancelled = true
    }
  }, [month])

  // Downloads the summary shown as money_summary_YYYY-MM.csv.
  function handleExport() {
    if (!summary) return
    previewCsv(buildMoneySummaryCsv(month, summary, cashFlow), `money_summary_${month}.csv`)
  }

  const earlierRows = history?.month === month ? history.rows : null
  const prev = earlierRows?.find((r) => r.month === shiftMonth(month, -1))?.summary ?? null
  const trend = earlierRows && summary ? [...earlierRows, { month, summary }] : null
  const prevNet = prevFlow?.month === month ? (prevFlow.flow?.net ?? null) : undefined
  const clientRows =
    summary && collected?.month === month ? billedVsCollected(summary.revenueByClient, collected.rows) : null

  function go(delta: number) {
    setSummary(null)
    setGap(null)
    setCashFlow(null)
    setMonth((m) => shiftMonth(m, delta))
  }

  return (
    <div>
      <PageHeader
        title="Financial Summary"
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
            {/* Export: this month's summary as a CSV file (opens in Excel). */}
            <button
              type="button"
              onClick={handleExport}
              disabled={!summary || tab !== 'summary'}
              className="btn-secondary ml-2 flex items-center gap-2 px-4 text-sm font-medium"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12 M7 10l5 5 5-5 M5 21h14" />
              </svg>
              Export
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
            <BigNumber label="Revenue" value={formatMoney(summary.earned)}>
              <ChangeNote now={summary.earned} before={prev?.earned} month={month} />
            </BigNumber>
            <BigNumber label="Collected" value={formatMoney(summary.collected)}>
              <ChangeNote now={summary.collected} before={prev?.collected} month={month} />
            </BigNumber>
            <BigNumber label="Expenses" value={formatMoney(summary.spent)}>
              <ChangeNote now={summary.spent} before={prev?.spent} month={month} upIsGood={false} />
            </BigNumber>
            <BigNumber
              label={summary.left < 0 ? 'Net loss' : 'Net profit'}
              value={`${summary.left < 0 ? '−' : ''}${formatMoney(Math.abs(summary.left))}`}
              tone={summary.left < 0 ? 'text-red-700' : 'text-green-800'}
            >
              <ChangeNote now={summary.left} before={prev?.left} month={month} />
            </BigNumber>
          </section>

          <CashFlowCard flow={cashFlow} error={cashFlowError} before={prevNet} month={month} />

          <div className="mt-4 grid gap-4 xl:grid-cols-2 xl:items-start">
            <CashOnHandCard month={month} />
            <RemittancesCard month={month} />
          </div>

          <StandingStrip />

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
            <NetWaterfall summary={summary} />
            <BilledVsCollectedCard rows={clientRows} error={collected?.month === month ? collected.error : null} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] xl:items-start">
            <PerTripCard summary={summary} />
            <TrendCard history={trend} />
          </div>

          <GapCard gap={gap} error={gapError} />
        </>
      )}
    </div>
  )
}

export default MoneySummarySection
