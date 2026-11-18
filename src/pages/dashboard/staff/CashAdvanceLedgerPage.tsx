// CashAdvanceLedgerPage (Admin, Finance -> Cash Advance Ledger): one row per
// employee with their cash advance balance, and the selected employee's full
// log -- advances issued, payslip deductions (finalized payslips, dated by
// pay week), and money paid back outside payroll -- with a running balance.
// "Record repayment" saves cash / GCash / bank paybacks; a wrong one is
// voided (reason required), it stays in the log struck through.
// Loading / saving: lib/cashAdvanceLedger.ts. Math: lib/cashAdvanceLedgerTotals.ts.
// HR -> Cash Advances (issue, requests, per-advance table) is separate.
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import PageHeader from '../../../components/PageHeader'
import EmptyState from '../../../components/EmptyState'
import NoMatchRow from '../../../components/NoMatchRow'
import { noMatchText, textMatches } from '../../../lib/search'
import StatusBadge from '../../../components/StatusBadge'
import Pager from '../../../components/Pager'
import { promptDialog } from '../../../components/ConfirmDialog'
import { previewCsv } from '../../../components/CsvPreview'
import { showToast } from '../../../components/Toast'
import { usePaged } from '../../../lib/usePaged'
import { formatDate, formatMoney } from '../../../lib/format'
import { cents, filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { toManilaDate } from '../../../lib/payslip'
import { maxRepayment, type LedgerLine } from '../../../lib/cashAdvanceLedgerTotals'
import {
  REPAYMENT_METHODS,
  buildLedgerCsv,
  loadCashAdvanceLedger,
  recordCashAdvanceRepayment,
  repaymentNeedsReference,
  voidCashAdvanceRepayment,
  type EmployeeCashAdvance,
  type RepaymentMethod,
} from '../../../lib/cashAdvanceLedger'
import WordCount from '../../../components/WordCount'
import { limitWords } from '../../../lib/wordLimit'

const TABS = ['Owing', 'Settled', 'All'] as const
type Tab = (typeof TABS)[number]
const tabOf = (e: EmployeeCashAdvance): Exclude<Tab, 'All'> => (e.outstanding > 0 ? 'Owing' : 'Settled')

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const INPUT = 'mt-1 w-full border border-line-control bg-white px-3 py-2 text-sm text-slate-900 rounded-[2px] min-h-11 focus:border-primary'
const LABEL = 'block text-xs font-medium text-slate-600'

function CashAdvanceLedgerPage() {
  const [employees, setEmployees] = useState<EmployeeCashAdvance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('Owing')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [repaying, setRepaying] = useState(false)

  async function load() {
    const result = await loadCashAdvanceLedger()
    setEmployees(result.employees)
    setError(result.error)
    setLoading(false)
  }

  const loadNow = useEffectEvent(() => {
    void load()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [])

  const visible = useMemo(() => {
    return employees.filter((e) => (tab === 'All' || tabOf(e) === tab) && textMatches(search, e.name))
  }, [employees, tab, search])
  const paged = usePaged(visible, `${tab}|${search}`)
  // The panel shows the picked employee, else the first one in the list.
  const selected = employees.find((e) => e.employee_id === selectedId) ?? visible[0] ?? null

  // Tiles: this month = Manila calendar month, by each line's date.
  const month = toManilaDate(new Date()).slice(0, 7)
  const totals = useMemo(() => {
    let issued = 0
    let paidBack = 0
    for (const e of employees) {
      for (const l of e.lines) {
        if (l.voided || !l.date.startsWith(month)) continue
        if (l.kind === 'issued') issued += l.amount
        else paidBack += l.amount
      }
    }
    return {
      outstanding: cents(employees.reduce((sum, e) => sum + Math.max(e.outstanding, 0), 0)),
      // Same balance payroll and the advance limit use: deductions already on
      // draft payslips count as taken (maxRepayment).
      afterDrafts: cents(employees.reduce((sum, e) => sum + maxRepayment(e.outstanding, e.draftDeducted), 0)),
      owing: employees.filter((e) => e.outstanding > 0).length,
      issued: cents(issued),
      paidBack: cents(paidBack),
    }
  }, [employees, month])

  async function voidLine(line: LedgerLine) {
    if (!selected) return
    const reason = await promptDialog({
      title: 'Void repayment',
      message: `${formatMoney(line.amount)} paid back by ${selected.name} on ${formatDate(line.date)}. It stays in the log but stops counting, so their balance goes back up. Why is it being voided?`,
      confirmLabel: 'Void repayment',
      danger: true,
    })
    if (reason === null) return
    if (!reason.trim()) {
      showToast('Enter a reason to void a repayment.', 'error')
      return
    }
    const voidError = await voidCashAdvanceRepayment(line.id, reason.trim())
    if (voidError) {
      showToast(voidError, 'error')
      return
    }
    showToast('Repayment voided.')
    void load()
  }

  const tile = 'card min-w-0 flex-1 px-[18px] py-3.5'
  const tileLabel = 'text-sm font-medium text-ink-secondary'
  const tileValue = 'text-[28px] leading-9 font-bold tracking-[-0.01em] text-ink tabular-nums'

  return (
    <div>
      <PageHeader
        title="Cash Advance Ledger"
        subtitle="Each employee's cash advances, what payroll took back, and what they paid back themselves."
        actions={
          <button type="button" onClick={() => void load()} className="btn-secondary px-4 text-sm font-medium">
            Refresh
          </button>
        }
      />

      <section aria-label="Totals" className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className={tile}>
          <p className={tileLabel}>Total still owed</p>
          <p className={`${tileValue} text-primary`}>{formatMoney(totals.outstanding)}</p>
          {totals.afterDrafts !== totals.outstanding && (
            <p className="text-[13px] text-ink-muted">{formatMoney(totals.afterDrafts)} after draft payslips</p>
          )}
        </div>
        <div className={tile}>
          <p className={tileLabel}>Employees owing</p>
          <p className={tileValue}>{totals.owing}</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>Issued this month</p>
          <p className={tileValue}>{formatMoney(totals.issued)}</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>Paid back this month</p>
          <p className={tileValue}>{formatMoney(totals.paidBack)}</p>
          <p className="mt-1 text-[13px] text-ink-muted">Payslip deductions + repayments</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-[2px] border px-4 text-sm font-medium ${
              tab === t ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
            }`}
          >
            {t}
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] px-1.5 text-xs font-bold ${
                tab === t ? 'bg-white text-primary' : 'bg-primary text-white'
              }`}
            >
              {t === 'All' ? employees.length : employees.filter((e) => tabOf(e) === t).length}
            </span>
          </button>
        ))}
        <label className="ml-auto flex w-full items-center gap-3 text-sm font-medium text-ink-secondary sm:w-auto">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Employee name"
            className="min-h-11 min-w-0 flex-1 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-normal text-ink-metric focus:border-primary sm:w-72 sm:flex-none"
          />
        </label>
      </div>

      {loading ? (
        <p className="mt-4 text-ink-muted">Loading cash advance ledger...</p>
      ) : error ? (
        <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : employees.length === 0 ? (
        <EmptyState message="No cash advances yet." hint="Advances are issued on Human Resource → Cash Advances." className="mt-4" />
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_640px] xl:items-start">
          <section aria-label="Employees" className="card flex flex-col">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm text-ink-metric">
                <thead>
                  <tr>
                    <th className={TH}>Employee</th>
                    <th className={`${TH} text-right`}>Issued</th>
                    <th className={`${TH} text-right`}>Paid back</th>
                    <th className={`${TH} text-right`}>Still owed</th>
                    <th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.length === 0 && (
                    <NoMatchRow
                      colSpan={5}
                      message={search.trim() ? noMatchText('employee', search) : `No ${tab.toLowerCase()} employees.`}
                      onClear={search.trim() ? () => setSearch('') : undefined}
                    />
                  )}
                  {paged.rows.map((e) => {
                    const active = selected?.employee_id === e.employee_id
                    return (
                      <tr
                        key={e.employee_id}
                        onClick={() => setSelectedId(e.employee_id)}
                        onKeyDown={(ev) => ev.key === 'Enter' && setSelectedId(e.employee_id)}
                        tabIndex={0}
                        aria-current={active || undefined}
                        className={`h-[60px] cursor-pointer border-b border-slate-200 ${
                          active ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className={TD}>
                          <p className="font-semibold text-ink">{e.name}</p>
                          <p className="text-[13px] text-ink-muted">
                            {e.position || '—'}
                            {e.lastDate && ` · last ${formatDate(e.lastDate)}`}
                          </p>
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{formatMoney(e.issued)}</td>
                        <td className={`${TD} text-right tabular-nums`}>{formatMoney(cents(e.deducted + e.repaid))}</td>
                        <td className={`${TD} text-right font-semibold tabular-nums`}>{formatMoney(Math.max(e.outstanding, 0))}</td>
                        <td className={TD}>
                          {tabOf(e) === 'Owing' ? (
                            <StatusBadge status="In Progress" label="Paying" icon />
                          ) : (
                            <StatusBadge status="Paid" label="Settled" icon />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager {...paged.pager} className="mx-5 mb-3" />
          </section>

          {selected && (
            <EmployeePanel
              employee={selected}
              onRepay={() => setRepaying(true)}
              onVoid={(line) => void voidLine(line)}
            />
          )}
        </div>
      )}

      {repaying && selected && (
        <RecordRepaymentModal
          employee={selected}
          onClose={() => setRepaying(false)}
          onSaved={() => {
            setRepaying(false)
            showToast('Repayment recorded.')
            void load()
          }}
        />
      )}
    </div>
  )
}

function EmployeePanel({
  employee,
  onRepay,
  onVoid,
}: {
  employee: EmployeeCashAdvance
  onRepay: () => void
  onVoid: (line: LedgerLine) => void
}) {
  const canRepay = maxRepayment(employee.outstanding, employee.draftDeducted) > 0
  // Newest first on screen; the balance column is still the running one.
  const lines = [...employee.lines].reverse()
  const linesPaged = usePaged(lines, String(employee.employee_id))

  return (
    <section aria-label={`${employee.name} ledger`} className="card flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{employee.name}</h2>
          <p className="text-sm text-ink-muted">{employee.position || 'Employee'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => previewCsv(buildLedgerCsv(employee), `cash_advance_ledger_${employee.name.replace(/\s+/g, '_')}.csv`)}
            className="btn-secondary px-4 text-sm font-medium"
          >
            Export CSV
          </button>
          <button type="button" onClick={onRepay} disabled={!canRepay} className="btn-primary px-4 text-sm font-medium">
            Record repayment
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-line px-5 py-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-[13px] text-ink-muted">Issued</p>
          <p className="font-semibold text-ink tabular-nums">{formatMoney(employee.issued)}</p>
        </div>
        <div>
          <p className="text-[13px] text-ink-muted">Payslip deductions</p>
          <p className="font-semibold text-ink tabular-nums">{formatMoney(employee.deducted)}</p>
        </div>
        <div>
          <p className="text-[13px] text-ink-muted">Paid back</p>
          <p className="font-semibold text-ink tabular-nums">{formatMoney(employee.repaid)}</p>
        </div>
        <div>
          <p className="text-[13px] text-ink-muted">Still owed</p>
          <p className="font-bold text-primary tabular-nums">{formatMoney(Math.max(employee.outstanding, 0))}</p>
        </div>
      </div>
      {employee.draftDeducted > 0 && (
        <p className="border-b border-line bg-slate-50 px-5 py-2.5 text-[13px] text-ink-secondary">
          {formatMoney(employee.draftDeducted)} more is on a draft payslip, so payroll and the advance limit count{' '}
          {formatMoney(maxRepayment(employee.outstanding, employee.draftDeducted))} as still owed. It shows in the log once
          that payslip is finalized.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm text-ink-metric">
          <thead>
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Entry</th>
              <th className={`${TH} text-right`}>Added</th>
              <th className={`${TH} text-right`}>Taken off</th>
              <th className={`${TH} text-right`}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {linesPaged.rows.map((l) => (
              <tr key={`${l.kind}-${l.id}`} className={`border-b border-slate-200 ${l.voided ? 'text-ink-muted' : ''}`}>
                <td className={`${TD} whitespace-nowrap`}>{formatDate(l.date)}</td>
                <td className={`${TD} ${l.voided ? 'line-through' : ''}`}>
                  {l.label}
                  {l.kind === 'deducted' && <span className="text-ink-muted"> · payslip #{l.id}</span>}
                  {l.kind === 'repaid' && !l.voided && (
                    <button
                      type="button"
                      onClick={() => onVoid(l)}
                      className="ml-2 text-[13px] font-medium text-red-700 underline hover:text-red-900"
                    >
                      Void
                    </button>
                  )}
                </td>
                <td className={`${TD} text-right tabular-nums`}>{l.kind === 'issued' ? formatMoney(l.amount) : ''}</td>
                <td className={`${TD} text-right tabular-nums ${l.voided ? 'line-through' : ''}`}>
                  {l.kind === 'issued' ? '' : `− ${formatMoney(l.amount)}`}
                </td>
                <td className={`${TD} text-right font-semibold tabular-nums`}>{formatMoney(l.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager {...linesPaged.pager} className="mx-5 mb-3" />
    </section>
  )
}

function RecordRepaymentModal({
  employee,
  onClose,
  onSaved,
}: {
  employee: EmployeeCashAdvance
  onClose: () => void
  onSaved: () => void
}) {
  const today = toManilaDate(new Date())
  const most = maxRepayment(employee.outstanding, employee.draftDeducted)
  const [amountText, setAmountText] = useState('')
  const [paidOn, setPaidOn] = useState(today)
  const [method, setMethod] = useState<RepaymentMethod>('Cash')
  const [referenceNo, setReferenceNo] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const parsed = parseAmount(amountText)
  const amountError =
    parsed.error ?? (parsed.value !== null && parsed.value > most ? `Can't be more than what's still owed (${formatMoney(most)}).` : null)
  const dateError = !paidOn ? 'Pick the date it was paid.' : paidOn > today ? "Date paid can't be in the future." : null
  const referenceError = repaymentNeedsReference(method) && !referenceNo.trim() ? `Enter the reference no. for this ${method} payment.` : null
  const canSave = parsed.value !== null && !amountError && !dateError && !referenceError && !saving

  async function save() {
    if (!canSave || parsed.value === null) return
    setSaving(true)
    setSaveError(null)
    const recordError = await recordCashAdvanceRepayment({
      employeeId: employee.employee_id,
      amount: parsed.value,
      paidOn,
      method,
      referenceNo,
      note,
    })
    setSaving(false)
    if (recordError) {
      setSaveError(recordError)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="repay-title" className="w-full max-w-md border-2 border-line-card bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Record repayment</p>
            <h3 id="repay-title" className="text-lg font-bold text-slate-900">{employee.name}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Most you can record: <span className="font-semibold text-slate-900">{formatMoney(most)}</span>
          {employee.draftDeducted > 0 && ` (${formatMoney(employee.draftDeducted)} is on a draft payslip)`}
        </p>

        <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="repay-amount">
          Amount paid back (₱)
        </label>
        <input
          id="repay-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={amountText}
          onChange={(e) => setAmountText(filterAmountInput(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          className={INPUT}
        />
        {amountError && <p className="mt-1 text-xs text-red-700">{amountError}</p>}
        <button
          type="button"
          onClick={() => setAmountText(String(most))}
          className="mt-2 rounded-[2px] border border-line-control px-3 py-1 text-xs font-medium text-ink-metric hover:bg-slate-50"
        >
          Full balance
        </button>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="repay-method">Payment method</label>
            <select id="repay-method" value={method} onChange={(e) => setMethod(e.target.value as RepaymentMethod)} className={INPUT}>
              {REPAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL} htmlFor="repay-date">Date paid</label>
            <input id="repay-date" type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} className={INPUT} />
            {dateError && <p className="mt-1 text-xs text-red-700">{dateError}</p>}
          </div>
          <div>
            <label className={LABEL} htmlFor="repay-ref">
              {method === 'Check' ? 'Check no.' : 'Reference no.'}{' '}
              {repaymentNeedsReference(method) ? <span className="text-red-700">(required)</span> : '(optional)'}
            </label>
            <input
              id="repay-ref"
              type="text"
              maxLength={50}
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              aria-invalid={referenceError ? true : undefined}
              className={`${INPUT} ${referenceError ? 'border-red-400' : ''}`}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="repay-note">Note (optional)</label>
            <input id="repay-note" type="text" value={note} onChange={(e) => setNote(limitWords(e.target.value))} className={INPUT} />
            <WordCount text={note} />
          </div>
        </div>

        {parsed.value !== null && !amountError && (
          <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Still owed after this:{' '}
            <span className="font-semibold text-slate-900">{formatMoney(cents(Math.max(employee.outstanding, 0) - parsed.value))}</span>
          </p>
        )}
        {saveError && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary px-4 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={!canSave} className="btn-primary px-4 text-sm font-medium">
            {saving ? 'Saving…' : 'Record repayment'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CashAdvanceLedgerPage
