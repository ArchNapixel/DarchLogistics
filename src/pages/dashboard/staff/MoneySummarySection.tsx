// MoneySummarySection: Finance -> Financial Summary (/dashboard/money-summary,
// Admin only). One month, laid out top to bottom:
//   header         month range + "vs last month" (or "No <month> data to compare")
//   alert          government remittances still due for the month
//   tiles          Net profit (margin), Revenue (trips), Expenses (% of
//                  revenue), Collected (% of revenue, "why?" -> the gap card)
//   Profit         how the net result is worked out + why Collected != Revenue
//                  ("Show trips" under Paid ahead / Paid for earlier months)
//   Cash           Money in / Money out
//   Government remittances   due vs remitted per agency
//   Where we stand today     balances as of today
//   Trends         six-month columns + revenue by client (billed vs collected)
//
// Profit numbers: loadProfitLoss() -> buildMoneySummary() (lib/moneySummary.ts).
// Cash: lib/cashFlow.ts. Gap card: loadRevenueReconciliation + gapByReason,
// its trips loadGapTrips (lib/revenueReconciliation.ts).
// Remittances / standing: lib/financeSnapshot.ts. Each block
// loads on its own, so one failing doesn't hide the rest.
//
// Second tab, "Expense breakdown" (?tab=expenses): the Admin dashboard's
// Operational / Payroll / Maintenance expense cards, fully opened, for the
// same month. The dashboard cards link here (#op / #pay / #mt scrolls to
// the one clicked). Those cards use their own loaders (dashboardExpenses.ts),
// so their totals can differ a little from the Summary tab's Expenses.
import { previewCsv } from '../../../components/CsvPreview'
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import PageHeader, { SectionHeader } from '../../../components/PageHeader'
import { formatDate, formatMoney } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { loadProfitLoss } from '../../../lib/profitLoss'
import { loadGapTrips, loadRevenueReconciliation, type GapBooking } from '../../../lib/revenueReconciliation'
import { gapByReason } from '../../../lib/revenueReconTotals'
import {
  billedVsCollected,
  buildMoneySummary,
  buildMoneySummaryCsv,
  monthLabel,
  shiftMonth,
  type CashFlow,
  type MoneySummary,
} from '../../../lib/moneySummary'
import { loadCashFlow } from '../../../lib/cashFlow'
import { loadCollectedByClient, loadRemittances, type Remittances } from '../../../lib/financeSnapshot'
import {
  BilledVsCollectedCard,
  ChangeNote,
  RemittanceAlert,
  RemittancesTable,
  StandingStrip,
  TrendCard,
} from './FinanceSummaryPanels'
import OperationalExpensesCard from './OperationalExpensesCard'
import PayrollExpensesCard from './PayrollExpensesCard'
import MaintenanceExpensesCard from './MaintenanceExpensesCard'

const TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'expenses', label: 'Expense breakdown' },
] as const

const pctOf = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—')
const hasData = (s: MoneySummary | null): s is MoneySummary => !!s && (s.earned !== 0 || s.spent !== 0 || s.collected !== 0)

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

// "November 1–30, 2026"
function monthRange(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${monthLabel(month).split(' ')[0]} 1–${last}, ${y}`
}

function Tile({ label, value, dark, children }: { label: string; value: string; dark?: boolean; children?: ReactNode }) {
  return (
    <div className={dark ? 'flex flex-col bg-navy px-6 py-5 text-white' : 'card flex flex-col px-6 py-5'}>
      <p className={`text-sm font-semibold ${dark ? 'text-slate-300' : 'text-ink-secondary'}`}>{label}</p>
      <p className={`mt-2 text-[28px] leading-9 font-bold tracking-[-0.01em] tabular-nums ${dark ? 'text-white' : 'text-ink'}`}>{value}</p>
      <p className={`mt-2 flex flex-wrap gap-x-2 text-sm ${dark ? 'text-slate-300' : 'text-ink-muted'}`}>{children}</p>
    </div>
  )
}

// "How the net result is worked out": revenue, each expense with its share of
// revenue, net profit under a rule. Bars sized against the biggest amount.
function NetWaterfall({ summary }: { summary: MoneySummary }) {
  const biggest = Math.max(summary.earned, ...summary.spending.map((s) => s.amount), Math.abs(summary.left), 0)
  const width = (n: number) => `${biggest > 0 ? (Math.abs(n) / biggest) * 100 : 0}%`
  const row = 'grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_48px_minmax(0,130px)] items-center gap-4 py-3.5 text-sm'
  const loss = summary.left < 0
  return (
    <section className="card px-6 py-5">
      <h3 className="border-b border-slate-200 pb-3 text-base font-semibold text-ink">How the net result is worked out</h3>
      <div className={`${row} border-b border-slate-200`}>
        <span className="font-semibold text-ink">Revenue</span>
        <div className="h-2.5 bg-slate-100" aria-hidden="true">
          <div className="h-2.5 bg-primary" style={{ width: width(summary.earned) }} />
        </div>
        <span />
        <span className="text-right font-bold tabular-nums whitespace-nowrap text-ink">+ {formatMoney(summary.earned)}</span>
      </div>
      {summary.spending.map((s) => (
        <div key={s.label} className={`${row} border-b border-slate-200 last:border-b-0`}>
          <span className="text-ink-secondary">{s.label}</span>
          <div className="h-2.5 bg-slate-100" aria-hidden="true">
            <div className="h-2.5 bg-ink-secondary" style={{ width: width(s.amount) }} />
          </div>
          <span className="text-right text-xs text-ink-muted tabular-nums">{pctOf(s.amount, summary.earned)}</span>
          <span className="text-right font-semibold tabular-nums whitespace-nowrap text-ink">− {formatMoney(s.amount)}</span>
        </div>
      ))}
      <div className={`${row} border-t-2 border-ink`}>
        <span className={`font-semibold ${loss ? 'text-red-700' : 'text-green-700'}`}>{loss ? 'Net loss' : 'Net profit'}</span>
        <div className="h-2.5 bg-slate-100" aria-hidden="true">
          <div className={`h-2.5 ${loss ? 'bg-red-700' : 'bg-green-700'}`} style={{ width: width(summary.left) }} />
        </div>
        <span className="text-right text-xs text-ink-muted tabular-nums">{pctOf(Math.abs(summary.left), summary.earned)}</span>
        <span className={`text-right font-bold tabular-nums whitespace-nowrap ${loss ? 'text-red-700' : 'text-green-700'}`}>
          {loss ? '− ' : ''}
          {formatMoney(Math.abs(summary.left))}
        </span>
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
  // The trips behind "Paid ahead" / "Paid for earlier months' trips" (loadGapTrips).
  trips: Partial<Record<string, GapBooking[]>>
  tripsError: string | null
}

async function fetchGap(month: string): Promise<Gap> {
  const { data, error } = await loadRevenueReconciliation(month)
  if (error || !data) throw new Error(error ?? 'Could not load this month.')
  const trips = await loadGapTrips(month, data.rows)
  return {
    billed: data.tripRevenue + data.adjustments,
    collected: data.collected,
    lines: gapByReason(data.rows),
    trips: { 'Paid ahead of delivery': trips.ahead, 'Paying earlier months': trips.earlier },
    tripsError: trips.error,
  }
}

// The bookings + trips under one "why" line, shown under it by "Show trips".
function GapTrips({ bookings }: { bookings: GapBooking[] }) {
  return (
    <ul className="mb-2 flex flex-col gap-2 bg-slate-50 px-4 py-3 text-sm">
      {bookings.map((b) => (
        <li key={b.booking_id}>
          <p className="flex flex-wrap justify-between gap-x-3">
            <Link to={`/dashboard/bookings?booking=${b.booking_id}`} className="font-semibold text-primary hover:underline">
              Booking #{b.booking_id} · {b.client_name}
            </Link>
            <span className="font-medium tabular-nums">{formatMoney(Math.abs(b.amount))}</span>
          </p>
          {b.trips.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No trip details found.</p>
          ) : (
            <ul className="mt-1 flex flex-col">
              {b.trips.map((t) => (
                <li key={t.itinerary_id} className="flex flex-wrap justify-between gap-x-3 text-[13px] text-ink-secondary">
                  <Link
                    to={`/dashboard/bookings?booking=${b.booking_id}&trip=${t.itinerary_id}`}
                    className="hover:text-ink hover:underline"
                  >
                    Trip #{t.itinerary_id}
                    {t.date ? ` · ${formatDate(t.date)}` : ''} · {t.note}
                  </Link>
                  <span className="tabular-nums">{formatMoney(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

// Revenue, then each reason it differs, then Collected under a rule.
function GapCard({ gap, error }: { gap: Gap | null; error: string | null }) {
  // Which line's trips are shown (null = none).
  const [openReason, setOpenReason] = useState<string | null>(null)
  const difference = gap ? gap.collected - gap.billed : 0
  const row = 'flex justify-between gap-3 border-b border-slate-200 py-3 text-sm'
  return (
    <section id="why" className="card scroll-mt-4 px-6 py-5">
      <div className="border-b border-slate-200 pb-3">
        <h3 className="text-base font-semibold text-ink">Why Collected is not the same as Revenue</h3>
        {gap && (
          <p className="text-sm text-ink-muted">
            Difference:{' '}
            <span className={`font-semibold ${difference < 0 ? 'text-red-700' : 'text-green-700'}`}>
              {difference > 0 ? '+' : difference < 0 ? '−' : ''}
              {formatMoney(Math.abs(difference))}
            </span>
          </p>
        )}
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : !gap ? (
        <p className="mt-3 text-sm text-ink-muted">Loading…</p>
      ) : (
        <ul className="flex flex-col">
          <li className={row}>
            <span className="text-ink-secondary">Revenue</span>
            <span className="font-medium tabular-nums">{formatMoney(gap.billed)}</span>
          </li>
          {gap.lines.length === 0 ? (
            <li className={`${row} text-ink-muted`}>Everything billed this month was collected.</li>
          ) : (
            gap.lines.map((line) => {
              const bookings = gap.trips[line.reason]
              const open = openReason === line.reason
              return (
                <Fragment key={line.reason}>
                  <li className={`${row} items-center`}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-secondary">
                      {GAP_LABELS[line.reason] ?? line.reason}
                      <span className="text-ink-muted">
                        · {line.bookings} booking{line.bookings === 1 ? '' : 's'}
                      </span>
                      {bookings && (
                        <button
                          type="button"
                          onClick={() => setOpenReason(open ? null : line.reason)}
                          aria-expanded={open}
                          className="rounded-[2px] border border-line-control bg-white px-2 py-0.5 text-xs font-semibold text-primary hover:bg-slate-50"
                        >
                          {open ? 'Hide trips' : 'Show trips'}
                        </button>
                      )}
                    </span>
                    <span className={`font-medium tabular-nums ${line.amount < 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {line.amount > 0 ? '+ ' : line.amount < 0 ? '− ' : ''}
                      {formatMoney(Math.abs(line.amount))}
                    </span>
                  </li>
                  {open && bookings && (
                    <li>
                      {gap.tripsError ? (
                        <p className="mb-2 bg-red-50 px-4 py-2 text-sm text-red-700">Couldn&apos;t load the trips ({gap.tripsError}).</p>
                      ) : (
                        <GapTrips bookings={bookings} />
                      )}
                    </li>
                  )}
                </Fragment>
              )
            })
          )}
          <li className="mt-px flex justify-between gap-3 border-t-2 border-ink pt-3 text-sm font-semibold text-ink">
            <span>Collected</span>
            <span className="tabular-nums">{formatMoney(gap.collected)}</span>
          </li>
        </ul>
      )}
    </section>
  )
}

// Money in / Money out side by side with their totals in the headers, and
// the net movement as a footer across both (lib/cashFlow.ts).
function CashFlowCard({
  flow,
  error,
  before,
  month,
}: {
  flow: CashFlow | null
  error: string | null
  before: number | null // last month's net, null = nothing to compare
  month: string
}) {
  if (error) return <p className="card px-6 py-4 text-sm text-red-700">{error}</p>
  if (!flow) return <p className="card px-6 py-4 text-sm text-ink-muted">Loading…</p>
  const column = (title: string, lines: CashFlow['moneyIn'], total: number, sign: string, tone: string) => (
    <div className="px-6 py-5">
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 pb-3">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <span className={`text-lg font-bold tabular-nums ${tone}`}>
          {sign} {formatMoney(total)}
        </span>
      </div>
      <ul className="flex flex-col">
        {lines.map((line) => (
          <li key={line.label} className="flex justify-between gap-3 border-b border-slate-200 py-3 text-sm last:border-b-0">
            <span className={line.amount === 0 ? 'text-ink-muted' : 'text-ink-secondary'}>{line.label}</span>
            <span className={`tabular-nums whitespace-nowrap ${line.amount === 0 ? 'text-ink-muted' : 'text-ink'}`}>
              {line.amount === 0 ? '—' : `${sign} ${formatMoney(line.amount)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
  const down = flow.net < 0
  return (
    <section className="card overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-slate-200">
        {column('Money in', flow.moneyIn, flow.totalIn, '+', 'text-green-700')}
        {column('Money out', flow.moneyOut, flow.totalOut, '−', 'text-ink')}
      </div>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 ${down ? 'bg-red-50' : 'bg-green-50'}`}
      >
        <span className="text-sm font-semibold text-ink">Net money movement</span>
        <span className="flex flex-wrap items-baseline gap-3">
          <ChangeNote now={flow.net} before={before} month={month} className="text-sm" />
          <span className={`text-xl font-bold tabular-nums ${down ? 'text-red-700' : 'text-green-700'}`}>
            {down ? '− ' : '+ '}
            {formatMoney(Math.abs(flow.net))}
          </span>
        </span>
      </div>
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
  // These are stored with the month they were loaded for, so a stale one
  // (from before the month arrows were clicked) never shows.
  const [history, setHistory] = useState<{ month: string; rows: { month: string; summary: MoneySummary | null }[] } | null>(null)
  const [prevFlow, setPrevFlow] = useState<{ month: string; flow: CashFlow | null } | null>(null)
  const [collected, setCollected] = useState<{
    month: string
    rows: { client_id: number | null; client_name: string; amount: number }[]
    error: string | null
  } | null>(null)
  const [remitReload, setRemitReload] = useState(0)
  const [remit, setRemit] = useState<{ key: string; data: Remittances | null; error: string | null } | null>(null)
  const remitKey = `${month}|${remitReload}`
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
    const earlier = [5, 4, 3, 2, 1].map((n) => shiftMonth(month, -n))
    // A month that fails to load shows as "No data" in the trend.
    void Promise.all(
      earlier.map((m) =>
        fetchMoneySummary(m).then(
          (s) => ({ month: m, summary: s as MoneySummary | null }),
          () => ({ month: m, summary: null }),
        ),
      ),
    ).then((rows) => !cancelled && setHistory({ month, rows }))
    void loadCashFlow(shiftMonth(month, -1)).then(({ data }) => !cancelled && setPrevFlow({ month, flow: data }))
    void loadCollectedByClient(month).then((r) => !cancelled && setCollected({ month, ...r }))
    return () => {
      cancelled = true
    }
  }, [month])

  useEffect(() => {
    let cancelled = false
    void loadRemittances(month).then((r) => !cancelled && setRemit({ key: remitKey, ...r }))
    // Money out counts remittances actually paid, so it reloads with them.
    void loadCashFlow(month).then(({ data, error: flowError }) => {
      if (cancelled) return
      setCashFlow(data)
      setCashFlowError(flowError)
    })
    return () => {
      cancelled = true
    }
  }, [month, remitKey])

  // Downloads the summary shown as money_summary_YYYY-MM.csv.
  function handleExport() {
    if (!summary) return
    previewCsv(buildMoneySummaryCsv(month, summary, cashFlow), `money_summary_${month}.csv`)
  }

  const earlierRows = history?.month === month ? history.rows : null
  const prevSummary = earlierRows?.find((r) => r.month === shiftMonth(month, -1))?.summary ?? null
  const prev = hasData(prevSummary) ? prevSummary : null
  const prevNet = prev && prevFlow?.month === month ? (prevFlow.flow?.net ?? null) : null
  const trend = earlierRows && summary ? [...earlierRows, { month, summary }] : null
  const clientRows = summary && collected?.month === month ? billedVsCollected(summary.revenueByClient, collected.rows) : null
  const remitData = remit?.key === remitKey ? remit.data : null
  const remitError = remit?.key === remitKey ? remit.error : null
  const prevName = monthLabel(shiftMonth(month, -1)).split(' ')[0]
  const compareText = !earlierRows ? '' : prev ? ` · Compared with ${prevName}` : ` · No ${prevName} data to compare`

  function go(delta: number) {
    setSummary(null)
    setGap(null)
    setCashFlow(null)
    setMonth((m) => shiftMonth(m, delta))
  }

  const arrow = 'flex h-11 w-11 items-center justify-center text-ink-secondary hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-white'

  return (
    <div>
      <PageHeader
        title="Financial Summary"
        subtitle={`${monthRange(month)}${compareText}`}
        actions={
          <>
            <div className="flex items-stretch divide-x divide-line-control rounded-[2px] border border-line-control bg-white">
              <button type="button" aria-label="Previous month" onClick={() => go(-1)} className={arrow}>
                ‹
              </button>
              <span className="flex min-w-40 items-center justify-center px-4 text-sm font-semibold text-ink">{monthLabel(month)}</span>
              <button type="button" aria-label="Next month" onClick={() => go(1)} disabled={month >= thisMonth} className={arrow}>
                ›
              </button>
            </div>
            {/* Export: this month's summary as a CSV file (opens in Excel). */}
            <button type="button" onClick={handleExport} disabled={!summary || tab !== 'summary'} className="btn-secondary px-5 text-sm font-semibold">
              Export
            </button>
          </>
        }
      />

      <div className="mb-5 flex gap-6 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setSearchParams(t.key === 'summary' ? {} : { tab: t.key })}
            className={`-mb-px border-b-2 pb-2.5 text-sm font-semibold ${
              tab === t.key ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'expenses' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
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
          <RemittanceAlert data={remitData} month={month} />

          <section aria-label={`Totals for ${monthLabel(month)}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              dark
              label={summary.left < 0 ? 'Net loss' : 'Net profit'}
              value={`${summary.left < 0 ? '−' : ''}${formatMoney(Math.abs(summary.left))}`}
            >
              <span>
                <span className={`font-semibold ${summary.left < 0 ? 'text-red-300' : 'text-green-300'}`}>
                  {pctOf(Math.abs(summary.left), summary.earned)} {summary.left < 0 ? 'loss' : 'margin'}
                </span>{' '}
                on revenue
              </span>
              <ChangeNote now={summary.left} before={prev?.left ?? null} month={month} className="text-slate-200" />
            </Tile>
            <Tile label="Revenue" value={formatMoney(summary.earned)}>
              <span>
                {summary.tripCount} trip{summary.tripCount === 1 ? '' : 's'} delivered
              </span>
              <ChangeNote now={summary.earned} before={prev?.earned ?? null} month={month} />
            </Tile>
            <Tile label="Expenses" value={formatMoney(summary.spent)}>
              <span>{pctOf(summary.spent, summary.earned)} of revenue</span>
              <ChangeNote now={summary.spent} before={prev?.spent ?? null} month={month} upIsGood={false} />
            </Tile>
            <Tile label="Collected" value={formatMoney(summary.collected)}>
              <span>
                {pctOf(summary.collected, summary.earned)} of revenue ·{' '}
                <a href="#why" className="font-semibold text-ink underline">
                  why?
                </a>
              </span>
              <ChangeNote now={summary.collected} before={prev?.collected ?? null} month={month} />
            </Tile>
          </section>

          <div className="mt-8">
            <SectionHeader title="Profit" subtitle="Based on trips delivered this month" />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
              <NetWaterfall summary={summary} />
              <GapCard gap={gap} error={gapError} />
            </div>
          </div>

          <div className="mt-8">
            <SectionHeader title="Cash" subtitle="Money that actually came in and went out this month" />
            <CashFlowCard flow={cashFlow} error={cashFlowError} before={prevNet} month={month} />
          </div>

          <div id="remittances" className="mt-8 scroll-mt-4">
            <SectionHeader title="Government remittances" subtitle={`For ${monthLabel(month)}`} />
            <RemittancesTable month={month} data={remitData} error={remitError} onChanged={() => setRemitReload((n) => n + 1)} />
          </div>

          <div className="mt-8">
            <SectionHeader
              title="Where we stand today"
              subtitle={`Balances as of today, not limited to ${monthLabel(month).split(' ')[0]}`}
            />
            <StandingStrip />
          </div>

          <div className="mt-8">
            <SectionHeader title="Trends" />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
              <TrendCard history={trend} />
              <BilledVsCollectedCard
                rows={clientRows}
                totalRevenue={summary.earned}
                error={collected?.month === month ? collected.error : null}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default MoneySummarySection
