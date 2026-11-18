// FinanceSummaryPanels: the Financial Summary panels below the tiles.
//   ChangeNote             "▲ 12% vs Oct" (only when last month had data)
//   RemittanceAlert        red banner when an agency still has money due
//   RemittancesTable       due vs remitted per agency, Record payment / Void
//   StandingStrip          "Where we stand today" (always today)
//   TrendCard              six-month revenue / expenses / net profit columns
//   BilledVsCollectedCard  revenue by client: billed vs collected
// Loading: lib/financeSnapshot.ts and lib/cashFlow.ts. Math: lib/moneySummary.ts.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { promptDialog } from '../../../components/ConfirmDialog'
import { showToast } from '../../../components/Toast'
import { formatDate, formatMoney } from '../../../lib/format'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { toManilaDate } from '../../../lib/payslip'
import {
  monthLabel,
  pctChange,
  remittanceStatus,
  shiftMonth,
  type Agency,
  type MoneySummary,
} from '../../../lib/moneySummary'
import {
  loadStanding,
  recordRemittance,
  voidRemittance,
  type Remittances,
  type Standing,
} from '../../../lib/financeSnapshot'

const CARD_TITLE = 'text-base font-semibold text-ink'
const shortMonth = (month: string) => monthLabel(month).split(' ')[0].slice(0, 3)
const agencyName = (a: Agency) => (a === 'BIR' ? 'BIR (withholding tax)' : a)

// ---------- Compare to last month ----------

// `upIsGood` false for costs (expenses going up shows red). Renders nothing
// when there's no last month to compare with.
export function ChangeNote({
  now,
  before,
  month,
  upIsGood = true,
  className = '',
}: {
  now: number
  before: number | null
  month: string
  upIsGood?: boolean
  className?: string
}) {
  if (before === null) return null
  const change = pctChange(now, before)
  if (change === null) return null
  const good = change === 0 ? null : change > 0 === upIsGood
  return (
    <span className={`font-medium ${good === null ? 'text-ink-muted' : good ? 'text-green-700' : 'text-red-700'} ${className}`}>
      {change > 0 ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}% vs {shortMonth(shiftMonth(month, -1))}
    </span>
  )
}

// ---------- Remittance alert ----------

export function RemittanceAlert({ data, month }: { data: Remittances | null; month: string }) {
  if (!data) return null
  const owing = remittanceStatus(data.due, data.paid).filter((r) => r.left > 0)
  if (owing.length === 0) return null
  const total = owing.reduce((s, r) => s + r.left, 0)
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-red-200 bg-red-50 px-5 py-3 text-sm">
      <span className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
        <span>
          <span className="font-semibold text-red-800">
            {owing.length} government remittance{owing.length === 1 ? '' : 's'} not yet paid
          </span>
          <span className="text-ink-secondary">
            {' '}
            · {formatMoney(total)} due for {monthLabel(month).split(' ')[0]}
          </span>
        </span>
      </span>
      <a href="#remittances" className="font-semibold text-red-700 hover:underline">
        Review ↓
      </a>
    </div>
  )
}

// ---------- Government remittances ----------

const STATE_LABEL = { remitted: 'Remitted', partly: 'Partly remitted', 'not yet': 'Not remitted yet', none: 'Nothing due' } as const
const STATE_PILL = {
  remitted: 'bg-green-50 text-green-800',
  partly: 'bg-amber-50 text-amber-800',
  'not yet': 'bg-red-50 text-red-700',
  none: 'bg-slate-100 text-ink-secondary',
} as const

export function RemittancesTable({
  month,
  data,
  error,
  onChanged,
}: {
  month: string
  data: Remittances | null
  error: string | null
  onChanged: () => void
}) {
  const { employeeId } = useAuth()
  const [recording, setRecording] = useState<{ agency: Agency; left: number } | null>(null)

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
    onChanged()
  }

  const rows = data ? remittanceStatus(data.due, data.paid) : []
  const TH = 'px-6 py-3 text-xs font-semibold tracking-wide uppercase'
  return (
    <section className="card overflow-hidden">
      {error ? (
        <p className="px-6 py-4 text-sm text-red-700">{error}</p>
      ) : !data ? (
        <p className="px-6 py-4 text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm text-ink-metric">
              <thead>
                <tr>
                  <th className={TH}>Agency</th>
                  <th className={`${TH} text-right`}>Due</th>
                  <th className={`${TH} text-right`}>Remitted</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.agency} className="border-b border-slate-200 last:border-b-0">
                    <td className="px-6 py-3 font-semibold text-ink">{agencyName(r.agency)}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{formatMoney(r.due)}</td>
                    <td className="px-6 py-3 text-right text-ink-secondary tabular-nums">{formatMoney(r.paid)}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-block rounded-[2px] px-2 py-0.5 text-xs font-semibold ${STATE_PILL[r.state]}`}>
                        {STATE_LABEL[r.state]}
                      </span>
                    </td>
                    <td className="px-6 py-2 text-right">
                      {r.left > 0 && (
                        <button
                          type="button"
                          onClick={() => setRecording({ agency: r.agency, left: r.left })}
                          className="btn-secondary px-4 text-sm font-semibold"
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
          {data.entries.length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-slate-200 px-6 py-3 text-[13px]">
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
          {data.draftPayslips > 0 && (
            <p className="border-t border-amber-200 bg-amber-50 px-6 py-3 text-[13px] text-amber-800">
              {data.draftPayslips} payslip{data.draftPayslips === 1 ? '' : 's'} of this month {data.draftPayslips === 1 ? 'is' : 'are'} still
              a draft and not counted in Due yet.{' '}
              <Link to="/dashboard/payroll" className="font-semibold underline">
                Open payroll
              </Link>
            </p>
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
            onChanged()
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
              {agencyName(agency)}
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
            <label className="block text-xs font-medium text-slate-600" htmlFor="remit-amount">
              Amount paid (₱)
            </label>
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
            <label className="block text-xs font-medium text-slate-600" htmlFor="remit-date">
              Date paid
            </label>
            <input id="remit-date" type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} className={input} />
            {dateError && <p className="mt-1 text-xs text-red-700">{dateError}</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600" htmlFor="remit-ref">
              Reference / PRN no. (optional)
            </label>
            <input
              id="remit-ref"
              type="text"
              maxLength={50}
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              className={input}
            />
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

// ---------- Where we stand today ----------

export function StandingStrip() {
  const [state, setState] = useState<{ data: Standing | null; error: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadStanding().then((result) => !cancelled && setState(result))
    return () => {
      cancelled = true
    }
  }, [])

  if (state?.error) return <p className="card px-6 py-4 text-sm text-red-700">{state.error}</p>
  const s = state?.data
  const tiles = [
    {
      tag: 'Owed to us',
      tagTone: 'text-primary',
      label: 'Clients owe us',
      to: '/dashboard/financial-records',
      value: s?.clientsOwe,
      sub: s ? (s.clientsOverdue > 0 ? `${formatMoney(s.clientsOverdue)} overdue` : 'Nothing overdue') : '',
      subTone: s && s.clientsOverdue > 0 ? 'font-medium text-red-700' : 'text-ink-muted',
    },
    {
      tag: 'Owed to us',
      tagTone: 'text-primary',
      label: 'Employees owe us',
      to: '/dashboard/cash-advance-ledger',
      value: s?.employeesOwe,
      sub: 'Cash advances not yet paid back',
      subTone: 'text-ink-muted',
    },
    {
      tag: 'We owe',
      tagTone: 'text-amber-700',
      label: 'We owe employees',
      to: '/dashboard/payroll',
      value: s?.weOweEmployees,
      sub: s ? `${s.unpaidPayslips} finalized payslip${s.unpaidPayslips === 1 ? '' : 's'} not paid yet` : '',
      subTone: 'text-ink-muted',
    },
    {
      tag: 'Inventory',
      tagTone: 'text-ink-muted',
      label: 'Stock on the shelf',
      to: '/dashboard/inventory',
      value: s?.stockOnShelf,
      sub: 'Parts bought, not used yet',
      subTone: 'text-ink-muted',
    },
  ]
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <Link key={t.label} to={t.to} className="card flex min-w-0 flex-col px-6 py-5 hover:border-primary">
          <span className={`text-xs font-semibold tracking-wide uppercase ${t.tagTone}`}>{t.tag}</span>
          <span className="mt-1 text-sm font-semibold text-ink-secondary">{t.label}</span>
          <span className="mt-2 text-[26px] leading-8 font-bold tabular-nums text-ink">{t.value === undefined ? '…' : formatMoney(t.value)}</span>
          <span className={`mt-1 text-sm ${t.subTone}`}>{t.sub}</span>
        </Link>
      ))}
    </div>
  )
}

// ---------- Six-month trend ----------

const LEGEND = (
  <span className="flex flex-wrap gap-4 text-[13px] text-ink-secondary">
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 bg-primary" aria-hidden="true" />
      Revenue
    </span>
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 bg-slate-400" aria-hidden="true" />
      Expenses
    </span>
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 bg-green-700" aria-hidden="true" />
      Net profit
    </span>
  </span>
)

export function TrendCard({ history }: { history: { month: string; summary: MoneySummary | null }[] | null }) {
  const values = (history ?? []).flatMap((h) => (h.summary ? [h.summary.earned, h.summary.spent, Math.abs(h.summary.left)] : []))
  const biggest = Math.max(...values, 0)
  const height = (n: number) => `${biggest > 0 ? (Math.abs(n) / biggest) * 100 : 0}%`
  return (
    <section className="card px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={CARD_TITLE}>Last six months</h3>
        {LEGEND}
      </div>
      {!history ? (
        <p className="mt-4 text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="mt-4 grid grid-cols-6 gap-2">
          {history.map(({ month, summary }) => {
            const empty = !summary || (summary.earned === 0 && summary.spent === 0)
            return (
              <div key={month} className="flex min-w-0 flex-col">
                <div className="flex h-52 items-end justify-center gap-1 border-b border-line">
                  {empty || !summary ? (
                    <span className="pb-2 text-xs text-ink-muted">No data</span>
                  ) : (
                    <>
                      <div className="w-1/4 bg-primary" style={{ height: height(summary.earned) }} title={`Revenue ${formatMoney(summary.earned)}`} />
                      <div className="w-1/4 bg-slate-400" style={{ height: height(summary.spent) }} title={`Expenses ${formatMoney(summary.spent)}`} />
                      <div
                        className={`w-1/4 ${summary.left < 0 ? 'bg-red-700' : 'bg-green-700'}`}
                        style={{ height: height(summary.left) }}
                        title={`${summary.left < 0 ? 'Net loss' : 'Net profit'} ${formatMoney(summary.left)}`}
                      />
                    </>
                  )}
                </div>
                <span className="mt-2 text-center text-sm font-semibold text-ink">{shortMonth(month)}</span>
                <span
                  className={`text-center text-xs tabular-nums ${
                    empty || !summary ? 'text-ink-muted' : summary.left < 0 ? 'text-red-700' : 'text-green-700'
                  }`}
                >
                  {empty || !summary ? '—' : `${summary.left < 0 ? '−' : ''}${formatMoney(Math.abs(summary.left))}`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ---------- Revenue by client: billed vs collected ----------

export function BilledVsCollectedCard({
  rows,
  totalRevenue,
  error,
}: {
  rows: { label: string; billed: number; collected: number }[] | null
  totalRevenue: number
  error: string | null
}) {
  const biggest = rows ? Math.max(...rows.flatMap((r) => [r.billed, r.collected]), 0) : 0
  const width = (n: number) => `${biggest > 0 ? (n / biggest) * 100 : 0}%`
  const bar = (label: string, value: number, fill: string, tone: string) => (
    <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,120px)] items-center gap-3 text-sm">
      <span className="text-ink-secondary">{label}</span>
      <div className="h-2.5 bg-slate-100" aria-hidden="true">
        <div className={`h-2.5 ${fill}`} style={{ width: width(value) }} />
      </div>
      <span className={`text-right font-semibold tabular-nums ${tone}`}>{formatMoney(value)}</span>
    </div>
  )
  return (
    <section className="card px-6 py-5">
      <h3 className={CARD_TITLE}>Revenue by client</h3>
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : !rows ? (
        <p className="mt-3 text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No revenue or payments this month.</p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-5">
            {rows.map((r) => (
              <li key={r.label} className="flex flex-col gap-2">
                <div className="flex justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-ink">{r.label}</span>
                  <span className="text-xs text-ink-muted">
                    {totalRevenue > 0 ? `${Math.round((r.billed / totalRevenue) * 1000) / 10}% of revenue` : ''}
                  </span>
                </div>
                {bar('Billed', r.billed, 'bg-primary', 'text-ink')}
                {bar('Collected', r.collected, 'bg-green-700', 'text-green-700')}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-muted">Billed = trips delivered</p>
        </>
      )}
    </section>
  )
}
