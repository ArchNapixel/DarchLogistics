// FinanceSummaryPanels: the extra Financial Summary panels.
//   StandingStrip       "Where we stand" today (clients / employees owe us,
//                       we owe employees, stock on the shelf)
//   ChangeNote          "▲ 12% vs October" under a tile
//   CashOnHandCard      counted cash carried forward month to month
//   RemittancesCard     what's due to SSS / PhilHealth / Pag-IBIG / BIR for the
//                       month vs what was recorded as remitted
//   PerTripCard         revenue / cost / profit per trip, collection rate
//   TrendCard           revenue, expenses, net profit for six months
//   BilledVsCollectedCard  revenue by client next to what each client paid
// Loading: lib/financeSnapshot.ts and lib/cashFlow.ts. Math: lib/moneySummary.ts.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { promptDialog } from '../../../components/ConfirmDialog'
import { showToast } from '../../../components/Toast'
import { formatDate, formatMoney } from '../../../lib/format'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { toManilaDate } from '../../../lib/payslip'
import { loadCashFlow } from '../../../lib/cashFlow'
import {
  cashPosition,
  monthLabel,
  monthsBetween,
  pctChange,
  perTripNumbers,
  remittanceStatus,
  shiftMonth,
  type Agency,
  type MoneySummary,
} from '../../../lib/moneySummary'
import {
  loadCashCheck,
  loadRemittances,
  loadStanding,
  recordRemittance,
  saveCashCheck,
  voidRemittance,
  type Remittances,
  type Standing,
} from '../../../lib/financeSnapshot'

const CARD_TITLE = 'border-b border-slate-200 pb-2 text-sm font-semibold text-ink'
const shortMonth = (month: string) => monthLabel(month).split(' ')[0].slice(0, 3)

// ---------- Where we stand ----------

export function StandingStrip() {
  const [state, setState] = useState<{ data: Standing | null; error: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadStanding().then((result) => !cancelled && setState(result))
    return () => {
      cancelled = true
    }
  }, [])

  const tile = 'card flex min-w-0 flex-col px-5 py-3.5 hover:border-primary'
  const value = 'text-xl leading-7 font-bold tabular-nums text-ink'
  const sub = 'text-[13px] text-ink-muted'
  const s = state?.data

  return (
    <section aria-label="Where we stand today" className="mt-4">
      <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Where we stand today</h2>
      {state?.error ? (
        <p className="card px-5 py-3 text-sm text-red-700">{state.error}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link to="/dashboard/financial-records" className={tile}>
            <span className="text-sm font-medium text-ink-secondary">Clients owe us</span>
            <span className={value}>{s ? formatMoney(s.clientsOwe) : '…'}</span>
            <span className={s && s.clientsOverdue > 0 ? 'text-[13px] font-medium text-red-700' : sub}>
              {s ? (s.clientsOverdue > 0 ? `${formatMoney(s.clientsOverdue)} overdue` : 'Nothing overdue') : ' '}
            </span>
          </Link>
          <Link to="/dashboard/cash-advance-ledger" className={tile}>
            <span className="text-sm font-medium text-ink-secondary">Employees owe us</span>
            <span className={value}>{s ? formatMoney(s.employeesOwe) : '…'}</span>
            <span className={sub}>Cash advances not yet paid back</span>
          </Link>
          <Link to="/dashboard/payroll" className={tile}>
            <span className="text-sm font-medium text-ink-secondary">We owe employees</span>
            <span className={value}>{s ? formatMoney(s.weOweEmployees) : '…'}</span>
            <span className={sub}>
              {s ? `${s.unpaidPayslips} finalized payslip${s.unpaidPayslips === 1 ? '' : 's'} not paid yet` : ' '}
            </span>
          </Link>
          <Link to="/dashboard/inventory" className={tile}>
            <span className="text-sm font-medium text-ink-secondary">Stock on the shelf</span>
            <span className={value}>{s ? formatMoney(s.stockOnShelf) : '…'}</span>
            <span className={sub}>Parts bought, not used yet</span>
          </Link>
        </div>
      )}
    </section>
  )
}

// ---------- Compare to last month ----------

// `upIsGood` false for costs (expenses going up shows red).
export function ChangeNote({
  now,
  before,
  month,
  upIsGood = true,
}: {
  now: number
  before: number | null | undefined
  month: string
  upIsGood?: boolean
}) {
  if (before === null || before === undefined) return <p className="mt-1 text-[13px] text-ink-muted">&nbsp;</p>
  const change = pctChange(now, before)
  const prev = shortMonth(shiftMonth(month, -1))
  if (change === null) return <p className="mt-1 text-[13px] text-ink-muted">Nothing in {prev} to compare</p>
  const good = change === 0 ? null : change > 0 === upIsGood
  return (
    <p className={`mt-1 text-[13px] font-medium ${good === null ? 'text-ink-muted' : good ? 'text-green-800' : 'text-red-700'}`}>
      {change > 0 ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}% vs {prev}
    </p>
  )
}

// ---------- Cash on hand ----------

export function CashOnHandCard({ month }: { month: string }) {
  const { employeeId } = useAuth()
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{
    key: string
    position: ReturnType<typeof cashPosition>
    error: string | null
  } | null>(null)
  const key = `${month}|${reload}`

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { check, error } = await loadCashCheck(month)
      if (error || !check) {
        if (!cancelled) setResult({ key, position: null, error })
        return
      }
      // Every month from the count up to this one needs its net movement.
      const months = [...monthsBetween(check.month, month), month]
      const flows = await Promise.all(months.map((m) => loadCashFlow(m)))
      const failed = flows.find((f) => f.error)
      const nets = new Map(months.map((m, i) => [m, flows[i].data?.net ?? 0]))
      if (!cancelled) setResult({ key, position: failed ? null : cashPosition(check, nets, month), error: failed?.error ?? null })
    })()
    return () => {
      cancelled = true
    }
  }, [month, key])

  async function enterCount() {
    const text = await promptDialog({
      title: `Cash on hand at the start of ${monthLabel(month)}`,
      message: 'Cash in the safe plus every bank / GCash balance, counted on the 1st. Later months carry this forward.',
      confirmLabel: 'Save count',
      placeholder: '0.00',
    })
    if (text === null) return
    const cleaned = filterAmountInput(text)
    const amount = cleaned === '0' || cleaned === '0.00' ? 0 : parseAmount(cleaned).value
    if (amount === null) {
      showToast('Enter the amount counted, e.g. 250000.', 'error')
      return
    }
    const saveError = await saveCashCheck(month, amount, employeeId)
    if (saveError) {
      showToast(saveError, 'error')
      return
    }
    showToast('Cash count saved.')
    setReload((n) => n + 1)
  }

  const loading = result?.key !== key
  const p = result?.position
  return (
    <section className="card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <h3 className="text-sm font-semibold text-ink">Cash on hand</h3>
        <button type="button" onClick={() => void enterCount()} className="btn-secondary px-3 text-sm font-medium">
          {p?.countedMonth === month ? 'Change count' : 'Enter cash count'}
        </button>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : result?.error ? (
        <p className="mt-3 text-sm text-red-700">{result.error}</p>
      ) : !p ? (
        <p className="mt-3 text-sm text-ink-muted">
          No cash count yet. Count the cash and bank balances on the 1st of a month and enter it here — every month after that is
          worked out from Money in / Money out.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col text-sm">
          <li className="flex justify-between gap-3 border-b border-slate-200 py-2">
            <span className="text-ink-secondary">
              Start of {monthLabel(month)}
              <span className="text-ink-muted">
                {p.countedMonth === month ? ' · counted' : ` · counted ${monthLabel(p.countedMonth)}, carried forward`}
              </span>
            </span>
            <span className="font-medium tabular-nums">{formatMoney(p.opening)}</span>
          </li>
          <li className="flex justify-between gap-3 border-b border-slate-200 py-2">
            <span className="text-ink-secondary">Net money movement</span>
            <span className="font-medium tabular-nums">
              {p.closing - p.opening < 0 ? '− ' : '+ '}
              {formatMoney(Math.abs(p.closing - p.opening))}
            </span>
          </li>
          <li className="flex justify-between gap-3 py-2 font-semibold text-ink">
            <span>{month === toManilaDate(new Date()).slice(0, 7) ? 'Cash on hand now' : `End of ${monthLabel(month)}`}</span>
            <span className={`tabular-nums ${p.closing < 0 ? 'text-red-700' : ''}`}>{formatMoney(p.closing)}</span>
          </li>
        </ul>
      )}
    </section>
  )
}

// ---------- Government remittances ----------

const STATE_LABEL = { remitted: 'Remitted', partly: 'Partly remitted', 'not yet': 'Not remitted yet', none: 'Nothing due' } as const
const STATE_TONE = {
  remitted: 'text-green-800',
  partly: 'text-amber-700',
  'not yet': 'text-red-700',
  none: 'text-ink-muted',
} as const

export function RemittancesCard({ month }: { month: string }) {
  const { employeeId } = useAuth()
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{ key: string; data: Remittances | null; error: string | null } | null>(null)
  const [recording, setRecording] = useState<{ agency: Agency; left: number } | null>(null)
  const key = `${month}|${reload}`

  useEffect(() => {
    let cancelled = false
    void loadRemittances(month).then((r) => !cancelled && setResult({ key, ...r }))
    return () => {
      cancelled = true
    }
  }, [month, key])

  async function voidEntry(id: number, label: string) {
    const reason = await promptDialog({
      title: 'Void remittance',
      message: `${label}. It stays on record but stops counting. Why is it being voided?`,
      confirmLabel: 'Void remittance',
      danger: true,
    })
    if (reason === null) return
    if (!reason.trim()) {
      showToast('Enter a reason to void a remittance.', 'error')
      return
    }
    const voidError = await voidRemittance(id, reason.trim(), employeeId)
    if (voidError) {
      showToast(voidError, 'error')
      return
    }
    showToast('Remittance voided.')
    setReload((n) => n + 1)
  }

  const data = result?.key === key ? result.data : null
  const rows = data ? remittanceStatus(data.due, data.paid) : []
  return (
    <section className="card px-5 py-4">
      <h3 className={CARD_TITLE}>Government remittances for {monthLabel(month)}</h3>
      {result?.key !== key ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : result.error || !data ? (
        <p className="mt-3 text-sm text-red-700">{result.error}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[480px] text-left text-sm text-ink-metric">
              <thead>
                <tr>
                  <th className="py-2 pr-2">Agency</th>
                  <th className="py-2 pr-2 text-right">Due</th>
                  <th className="py-2 pr-2 text-right">Remitted</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.agency} className="border-b border-slate-200">
                    <td className="py-2 pr-2 font-medium text-ink">{r.agency === 'BIR' ? 'BIR (withholding tax)' : r.agency}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(r.due)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(r.paid)}</td>
                    <td className={`py-2 pr-2 font-medium ${STATE_TONE[r.state]}`}>{STATE_LABEL[r.state]}</td>
                    <td className="py-2 text-right">
                      {r.left > 0 && (
                        <button
                          type="button"
                          onClick={() => setRecording({ agency: r.agency, left: r.left })}
                          className="text-[13px] font-semibold text-primary underline"
                        >
                          Record payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.draftPayslips > 0 && (
            <p className="mt-2 text-[13px] text-amber-700">
              {data.draftPayslips} payslip{data.draftPayslips === 1 ? '' : 's'} of this month {data.draftPayslips === 1 ? 'is' : 'are'} still a draft and not
              counted in Due yet.
            </p>
          )}
          {data.entries.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-[13px]">
              {data.entries.map((e) => {
                const label = `${e.agency} ${formatMoney(e.amount)} paid ${formatDate(e.paid_on)}`
                return (
                  <li key={e.remittance_id} className={e.voided_at ? 'text-ink-muted line-through' : 'text-ink-secondary'}>
                    {label}
                    {e.reference_no && ` · Ref ${e.reference_no}`}
                    {!e.voided_at && (
                      <button
                        type="button"
                        onClick={() => void voidEntry(e.remittance_id, label)}
                        className="ml-2 font-medium text-red-700 underline"
                      >
                        Void
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
      {recording && (
        <RecordRemittanceModal
          month={month}
          agency={recording.agency}
          left={recording.left}
          employeeId={employeeId}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null)
            showToast('Remittance recorded.')
            setReload((n) => n + 1)
          }}
        />
      )}
    </section>
  )
}

function RecordRemittanceModal({
  month,
  agency,
  left,
  employeeId,
  onClose,
  onSaved,
}: {
  month: string
  agency: Agency
  left: number
  employeeId: number | null
  onClose: () => void
  onSaved: () => void
}) {
  const today = toManilaDate(new Date())
  const [amountText, setAmountText] = useState(String(left))
  const [paidOn, setPaidOn] = useState(today)
  const [referenceNo, setReferenceNo] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const parsed = parseAmount(amountText)
  const dateError = !paidOn ? 'Pick the date it was paid.' : paidOn > today ? "Date paid can't be in the future." : null
  const canSave = parsed.value !== null && !parsed.error && !dateError && !saving
  const input = 'mt-1 w-full border border-line-control bg-white px-3 py-2 text-sm text-slate-900 rounded-[2px] min-h-11 focus:border-primary'

  async function save() {
    if (!canSave || parsed.value === null) return
    setSaving(true)
    setSaveError(null)
    const err = await recordRemittance({ month, agency, amount: parsed.value, paidOn, referenceNo, employeeId })
    setSaving(false)
    if (err) setSaveError(err)
    else onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="remit-title" className="w-full max-w-md border-2 border-line-card bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Record remittance · {monthLabel(month)}</p>
            <h3 id="remit-title" className="text-lg font-bold text-slate-900">
              {agency === 'BIR' ? 'BIR (withholding tax)' : agency}
            </h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Still due: <span className="font-semibold text-slate-900">{formatMoney(left)}</span>
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="remit-amount">Amount paid (₱)</label>
            <input
              id="remit-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(e) => setAmountText(filterAmountInput(e.target.value))}
              className={input}
            />
            {parsed.error && <p className="mt-1 text-xs text-red-700">{parsed.error}</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600" htmlFor="remit-date">Date paid</label>
            <input id="remit-date" type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} className={input} />
            {dateError && <p className="mt-1 text-xs text-red-700">{dateError}</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600" htmlFor="remit-ref">Reference / PRN no. (optional)</label>
            <input id="remit-ref" type="text" maxLength={50} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={input} />
          </div>
        </div>
        {saveError && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary px-4 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={!canSave} className="btn-primary px-4 text-sm font-medium">
            {saving ? 'Saving…' : 'Record remittance'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Per trip ----------

export function PerTripCard({ summary }: { summary: MoneySummary }) {
  const n = perTripNumbers(summary)
  const line = (label: string, value: string) => (
    <li className="flex justify-between gap-3 border-b border-slate-200 py-2 last:border-b-0">
      <span className="text-ink-secondary">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </li>
  )
  const money = (v: number | null) => (v === null ? '—' : formatMoney(v))
  return (
    <section className="card px-5 py-4">
      <h3 className={CARD_TITLE}>
        Per trip <span className="font-normal text-ink-muted">· {summary.tripCount} delivered</span>
      </h3>
      <ul className="mt-2 flex flex-col text-sm">
        {line('Revenue per trip', money(n.revenue))}
        {line('Cost per trip', money(n.cost))}
        {line('Profit per trip', money(n.profit))}
        {line('Collection rate (collected ÷ revenue)', n.collectionRate === null ? '—' : `${n.collectionRate}%`)}
      </ul>
    </section>
  )
}

// ---------- Six-month trend ----------

export function TrendCard({ history }: { history: { month: string; summary: MoneySummary }[] | null }) {
  const biggest = history ? Math.max(...history.flatMap((h) => [h.summary.earned, h.summary.spent, Math.abs(h.summary.left)]), 0) : 0
  const bar = (n: number) => `${biggest > 0 ? (Math.abs(n) / biggest) * 100 : 0}%`
  return (
    <section className="card px-5 py-4">
      <h3 className={CARD_TITLE}>Last six months</h3>
      {!history ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-3 flex gap-4 text-[13px] text-ink-secondary">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" aria-hidden="true" />Revenue</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-ink-secondary" aria-hidden="true" />Expenses</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-green-700" aria-hidden="true" />Net profit</span>
          </div>
          <ul className="mt-2 flex flex-col">
            {history.map(({ month, summary }) => (
              <li key={month} className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,120px)] items-center gap-3 border-b border-slate-200 py-2 text-sm last:border-b-0">
                <span className="font-medium text-ink-secondary">{shortMonth(month)}</span>
                <div className="flex flex-col gap-0.5" aria-hidden="true">
                  <div className="h-2 bg-primary" style={{ width: bar(summary.earned) }} />
                  <div className="h-2 bg-ink-secondary" style={{ width: bar(summary.spent) }} />
                  <div className={`h-2 ${summary.left < 0 ? 'bg-red-700' : 'bg-green-700'}`} style={{ width: bar(summary.left) }} />
                </div>
                <span className={`text-right font-semibold tabular-nums ${summary.left < 0 ? 'text-red-700' : 'text-green-800'}`}>
                  {summary.left < 0 ? '− ' : ''}
                  {formatMoney(Math.abs(summary.left))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// ---------- Revenue by client: billed vs collected ----------

export function BilledVsCollectedCard({ rows, error }: { rows: { label: string; billed: number; collected: number }[] | null; error: string | null }) {
  const biggest = rows ? Math.max(...rows.flatMap((r) => [r.billed, r.collected]), 0) : 0
  const width = (n: number) => `${biggest > 0 ? (n / biggest) * 100 : 0}%`
  return (
    <section className="card px-5 py-4">
      <h3 className={CARD_TITLE}>Revenue by client</h3>
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : !rows ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No revenue or payments this month.</p>
      ) : (
        <>
          <div className="mt-3 flex gap-4 text-[13px] text-ink-secondary">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" aria-hidden="true" />Billed (trips delivered)</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-green-700" aria-hidden="true" />Collected</span>
          </div>
          <ul className="mt-3 flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.label} className="text-sm">
                <div className="flex flex-wrap justify-between gap-x-3">
                  <span className="truncate text-ink-secondary">{r.label}</span>
                  <span className="tabular-nums">
                    <span className="font-semibold text-ink">{formatMoney(r.billed)}</span>
                    <span className="text-ink-muted"> billed · </span>
                    <span className="font-semibold text-green-800">{formatMoney(r.collected)}</span>
                    <span className="text-ink-muted"> collected</span>
                  </span>
                </div>
                <div className="mt-1 flex flex-col gap-0.5" aria-hidden="true">
                  <div className="h-2 bg-slate-200"><div className="h-2 bg-primary" style={{ width: width(r.billed) }} /></div>
                  <div className="h-2 bg-slate-200"><div className="h-2 bg-green-700" style={{ width: width(r.collected) }} /></div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
