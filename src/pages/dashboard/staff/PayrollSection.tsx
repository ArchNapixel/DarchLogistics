// PayrollSection: table of payroll entries, read from the
// payroll_payslips table (joined with employees for the display name).
// Click a row to expand its full breakdown (src/lib/payslip.ts).
//
// There's no "Issue Payslip" button: opening this page automatically
// creates/tops up DRAFT payslips for last week and the current week (a
// current-week draft grows as trips/attendance come in and can only be
// finalized once the week is over), for every employee who earned something
// (generateDraftPayslips). Drafts are staff-only. Admin reviews each
// one -- Edit (adjust amounts, add lines, cash advance, deductions),
// Regenerate (recalculate from current trips/attendance), and for
// Drivers, Hold (blocks finalizing, even via "Finalize all", so it can't
// be released by accident) -- then Finalizes it, which releases it to
// the employee's own payslip page. "Mark Paid" (finalized only) is the
// separate step once money has actually changed hands.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  markPayslipPaid,
  finalizePayslips,
  discardDraftPayslip,
  generateDraftPayslips,
  getDefaultPayPeriod,
  getCurrentPayPeriod,
  isWeekInProgress,
  setPayslipHold,
  loadPayslipLineItems,
  getOutstandingCashAdvance,
  totalEmployeeDeductions,
  type PayslipLineItem,
} from '../../../lib/payslip'
import EditDraftPayslipModal, { type DraftToEdit } from './EditDraftPayslipModal'
import { confirmDialog } from '../../../components/ConfirmDialog'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import { fetchAll } from '../../../lib/dashboardExpenses'

// One row of the payslip query in loadPayroll().
type PayrollRow = {
  payroll_id: number
  payroll_period_start: string
  payroll_period_end: string
  gross_pay: number
  cash_advance_deducted: number
  sss_ee: number
  philhealth_ee: number
  pagibig_ee: number
  withholding_tax: number
  deductions_note: string | null
  net_pay: number
  payslip_status: string
  finalized_at: string | null
  on_hold: boolean
  employee_id: number
  employees: unknown
}

type PayrollEntry = {
  payroll_id: number
  employee_id: number
  employee_name: string
  position: string
  rate_type: string | null
  period_start: string
  period_end: string
  period: string
  on_hold: boolean
  gross_pay: number
  cash_advance_deducted: number
  sss_ee: number
  philhealth_ee: number
  pagibig_ee: number
  withholding_tax: number
  // Employee shares of SSS/PhilHealth/Pag-IBIG + withholding tax
  gov_deductions: number
  deductions_note: string | null
  net_pay: number
  // 'Draft' while finalized_at is null, else payslip_status (Pending/Paid)
  status: string
}

function formatPeriod(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`
}

function PayrollSection() {
  const [payroll, setPayroll] = useState<PayrollEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<DraftToEdit | null>(null)
  const [generating, setGenerating] = useState(false)
  // Employees the auto-generator couldn't make a draft for (e.g. no rate set)
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([])
  const [markingPaidId, setMarkingPaidId] = useState<number | null>(null)
  // payroll_id being finalized/discarded, or 'all' for Finalize All
  const [reviewingId, setReviewingId] = useState<number | 'all' | null>(null)
  const [lineItemsByPayroll, setLineItemsByPayroll] = useState<
    Record<number, PayslipLineItem[]>
  >({})

  // What each employee still owes (cash advances), by employee id
  const [owedByEmployee, setOwedByEmployee] = useState<Record<number, number>>({})
  // The pay period shown ('start|end'; '' = the latest one) and whose payslip is open.
  const [periodKey, setPeriodKey] = useState('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)


  useEffect(() => {
    generateThenLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Create any missing drafts and TOP UP existing ones, for last week
  // (catches attendance recorded late) and the current week (its drafts
  // fill up as trips are delivered / attendance recorded). Top-up only
  // adds what's new, so admin edits on a draft survive. Something REMOVED
  // since (an un-delivered trip, a day changed to Absent) needs the
  // payslip's own Regenerate button. (This used to rebuild every draft
  // from scratch on each page open, silently wiping admin edits.)
  async function generateThenLoad() {
    setGenerating(true)
    const allWarnings: string[] = []
    const periods = [getDefaultPayPeriod(), getCurrentPayPeriod()]
    for (const period of periods) {
      const { warnings, error: generateError } = await generateDraftPayslips(period.start, period.end)
      allWarnings.push(...warnings)
      if (generateError) setActionError(`Couldn't update the draft payslips: ${generateError}`)
    }
    setGenerating(false)
    // Same employee can be flagged for both weeks -- show it once
    setGenerationWarnings([...new Set(allWarnings)])
    await loadPayroll()
  }

  // Throw away one draft and rebuild it from the current trips / attendance,
  // keeping its hold. Returns a problem message, or null if it went fine.
  async function regenerateDraft(draft: {
    payroll_id: number
    employee_id: number
    employee_name: string
    period: string
    period_start: string
    period_end: string
    on_hold: boolean
  }): Promise<string | null> {
    const { error: discardError } = await discardDraftPayslip(draft.payroll_id)
    if (discardError) return discardError

    const { createdIds, warnings, error: generateError } = await generateDraftPayslips(
      draft.period_start,
      draft.period_end,
      draft.employee_id,
    )
    if (draft.on_hold && createdIds.length > 0) {
      const { error: holdError } = await setPayslipHold(createdIds[0], true)
      if (holdError) return `Regenerated, but the hold couldn't be re-applied: ${holdError}`
    }
  return (
      generateError ??
      warnings[0] ??
      (createdIds.length === 0 ? `${draft.employee_name} has nothing to pay for ${draft.period} anymore, so no draft was created.` : null)
    )
  }

  async function loadPayroll() {
    setLoading(true)

    // Every page -- Supabase stops at 1000 rows, which would silently drop
    // the oldest payslips (about a year in with ~20 staff).
    const { rows: data, error } = await fetchAll<PayrollRow>((from, to) =>
      supabase
        .from('payroll_payslips')
        .select(
          'payroll_id, payroll_period_start, payroll_period_end, gross_pay, cash_advance_deducted, sss_ee, philhealth_ee, pagibig_ee, withholding_tax, deductions_note, net_pay, payslip_status, finalized_at, on_hold, employee_id, employees(full_name, position, rate_type)',
        )
        .order('payroll_period_start', { ascending: false })
        .order('payroll_id', { ascending: false })
        .range(from, to),
    )

    if (error) {
      setError(error)
      setLoading(false)
      return
    }

    setPayroll(
      data.map((entry) => {
        // payroll_payslips.employee_id is a many-to-one FK (many
        // payslips, one employee), so PostgREST actually returns
        // `employees` as a single object at runtime -- but the
        // untyped Supabase client (no generated DB types in this
        // project) infers every embedded relation as an array
        // regardless of real cardinality. Trust the runtime shape,
        // not the type: indexing with [0] here always returned
        // undefined, which is why every row showed a blank employee
        // name.
        const employee = entry.employees as unknown as { full_name: string; position: string; rate_type: string | null } | null

        return {
          payroll_id: entry.payroll_id,
          employee_id: entry.employee_id,
          employee_name: employee?.full_name ?? '—',
          position: employee?.position ?? '',
          rate_type: employee?.rate_type ?? null,
          period_start: entry.payroll_period_start,
          period_end: entry.payroll_period_end,
          period: formatPeriod(entry.payroll_period_start, entry.payroll_period_end),
          on_hold: entry.on_hold,
          gross_pay: entry.gross_pay,
          cash_advance_deducted: entry.cash_advance_deducted,
          sss_ee: entry.sss_ee,
          philhealth_ee: entry.philhealth_ee,
          pagibig_ee: entry.pagibig_ee,
          withholding_tax: entry.withholding_tax,
          gov_deductions: totalEmployeeDeductions(entry),
          deductions_note: entry.deductions_note,
          net_pay: entry.net_pay,
          status: entry.finalized_at ? entry.payslip_status : 'Draft',
        }
      }),
    )
    const employeeIds = [...new Set(data.map((entry) => entry.employee_id))]
    const owed = await Promise.all(
      employeeIds.map(async (id) => [id, (await getOutstandingCashAdvance(id)).outstanding] as const),
    )
    setOwedByEmployee(Object.fromEntries(owed))
    setError(null)
    setLoading(false)
  }

  // Group payslips per employee (payroll is already newest-first, so each
  // group's entries are too). Employees with drafts to review come first.
  const employeeGroups = Object.values(
    payroll.reduce<
      Record<number, { employee_id: number; employee_name: string; position: string; entries: PayrollEntry[] }>
    >((groups, entry) => {
      groups[entry.employee_id] ??= {
        employee_id: entry.employee_id,
        employee_name: entry.employee_name,
        position: entry.position,
        entries: [],
      }
      groups[entry.employee_id].entries.push(entry)
      return groups
    }, {}),
  ).sort((a, b) => {
    const aDraft = a.entries.some((e) => e.status === 'Draft') ? 0 : 1
    const bDraft = b.entries.some((e) => e.status === 'Draft') ? 0 : 1
    return aDraft - bDraft || a.employee_name.localeCompare(b.employee_name)
  })

  const drafts = payroll.filter((entry) => entry.status === 'Draft')
  // "Finalize all" skips held drafts and weeks still in progress
  const draftIds = drafts
    .filter((entry) => !entry.on_hold && !isWeekInProgress(entry.period_end))
    .map((entry) => entry.payroll_id)
  const heldCount = drafts.filter((entry) => entry.on_hold).length
  const inProgressCount = drafts.filter((entry) => isWeekInProgress(entry.period_end)).length

  async function handleFinalize(payrollIds: number[], busyKey: number | 'all') {
    setReviewingId(busyKey)
    setActionError(null)

    const { finalizedIds, error: finalizeError } = await finalizePayslips(payrollIds)

    setReviewingId(null)
    setPayroll((prev) =>
      prev.map((entry) =>
        finalizedIds.includes(entry.payroll_id) ? { ...entry, status: 'Pending' } : entry,
      ),
    )
    if (finalizeError) {
      setActionError(finalizeError)
    }
  }

  // Throw the draft away and recalculate it from the current trips /
  // attendance (e.g. after fixing a missed attendance day). Admin edits
  // on it are lost; a hold is kept.
  async function handleRegenerate(entry: PayrollEntry) {
    if (
      !(await confirmDialog({
        message:
          `Recalculate ${entry.employee_name}'s draft (${entry.period}) from the current trips and attendance? ` +
          `Any edits you made to it will be lost.`,
        confirmLabel: 'Regenerate',
        danger: true,
      }))
    ) {
      return
    }

    setReviewingId(entry.payroll_id)
    setActionError(null)

    const problem = await regenerateDraft(entry)

    setReviewingId(null)
    if (problem) setActionError(problem)
    loadPayroll()
  }

  async function handleToggleHold(entry: PayrollEntry) {
    setReviewingId(entry.payroll_id)
    setActionError(null)

    const { error: holdError } = await setPayslipHold(entry.payroll_id, !entry.on_hold)

    setReviewingId(null)
    if (holdError) {
      setActionError(holdError)
      return
    }
    setPayroll((prev) =>
      prev.map((row) => (row.payroll_id === entry.payroll_id ? { ...row, on_hold: !entry.on_hold } : row)),
    )
  }

  async function handleMarkPaid(payrollId: number) {
    setMarkingPaidId(payrollId)
    setActionError(null)

    const { error: payError } = await markPayslipPaid(payrollId)

    setMarkingPaidId(null)

    if (payError) {
      setActionError(payError)
      return
    }

    setPayroll((prev) =>
      prev.map((entry) =>
        entry.payroll_id === payrollId ? { ...entry, status: 'Paid' } : entry,
      ),
    )
  }

  // Pay periods, newest first; the list shows one period at a time.
  const periods = [...new Map(payroll.map((e) => [`${e.period_start}|${e.period_end}`, e])).values()].map((e) => ({
    key: `${e.period_start}|${e.period_end}`,
    label: e.period,
    end: e.period_end,
  }))
  const lastWeek = getDefaultPayPeriod()
  const shownPeriodKey =
    periodKey || periods.find((p) => p.key === `${lastWeek.start}|${lastWeek.end}`)?.key || periods[0]?.key || ''
  const shownPeriod = periods.find((p) => p.key === shownPeriodKey)
  const periodEntries = employeeGroups
    .map((g) => g.entries.find((e) => `${e.period_start}|${e.period_end}` === shownPeriodKey))
    .filter((e): e is PayrollEntry => e !== undefined)
  const selected = periodEntries.find((e) => e.employee_id === selectedEmployeeId) ?? periodEntries[0] ?? null
  const periodGross = periodEntries.reduce((sum, e) => sum + e.gross_pay, 0)
  const periodFinalized = periodEntries.filter((e) => e.status !== 'Draft').length

  // Load the open payslip's lines (trips / days) when it changes.
  useEffect(() => {
    const id = selected?.payroll_id
    if (id === undefined || lineItemsByPayroll[id]) return
    let cancelled = false
    loadPayslipLineItems(id).then(({ lineItems, error: lineItemsError }) => {
      if (cancelled) return
      if (lineItemsError) setActionError(lineItemsError)
      else setLineItemsByPayroll((prev) => ({ ...prev, [id]: lineItems }))
    })
    return () => {
      cancelled = true
    }
  }, [selected?.payroll_id, lineItemsByPayroll])

  const rateLabel = (rateType: string | null) =>
    rateType === 'Commission Per Trip' ? 'Commission per trip' : rateType ? rateType.replace('Fixed', 'rate').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : '—'
  const STATUS_LABEL: Record<string, string> = { Pending: 'Finalized' }
  const deductionRows = selected
    ? ([
        ['SSS', selected.sss_ee],
        ['PhilHealth', selected.philhealth_ee],
        ['Pag-IBIG', selected.pagibig_ee],
        ['Withholding tax', selected.withholding_tax],
        ['Cash advance', selected.cash_advance_deducted],
      ] as const)
    : []
  const lines = selected ? lineItemsByPayroll[selected.payroll_id] : undefined
  const selectedDraft = selected?.status === 'Draft'
  const kv = 'flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm'

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={
          shownPeriod ? (
            <>
              Gross pay for {shownPeriod.label}:{' '}
              <strong className="text-ink tabular-nums">{formatMoney(periodGross)}</strong>
            </>
          ) : (
            'Weekly payslip drafts: review, finalize, then mark paid.'
          )
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {periods.length > 0 && (
              <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary">
                Pay period
                <select
                  value={shownPeriodKey}
                  onChange={(e) => {
                    setPeriodKey(e.target.value)
                    setSelectedEmployeeId(null)
                  }}
                  className="min-h-11 w-64 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary"
                >
                  {periods.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                      {isWeekInProgress(p.end) ? ' (in progress)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draftIds.length > 0 && (
              <button
                onClick={async () => {
                  if (
                    await confirmDialog({
                      message:
                        `Finalize and release ${draftIds.length} draft payslip${draftIds.length === 1 ? '' : 's'} to employees?` +
                        (heldCount + inProgressCount > 0 ? ' Drafts on hold or with the week still in progress are skipped.' : ''),
                      confirmLabel: 'Finalize',
                    })
                  ) {
                    handleFinalize(draftIds, 'all')
                  }
                }}
                disabled={reviewingId !== null}
                className="btn-secondary px-4 text-sm font-medium"
              >
                {reviewingId === 'all' ? 'Finalizing...' : `Finalize All ${draftIds.length} Drafts`}
              </button>
            )}
          </div>
        }
      />

      {actionError && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}

      {generationWarnings.length > 0 && (
        <div className="mb-4 border border-amber-600 bg-amber-100 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Couldn&apos;t create a draft for:</p>
          <ul className="mt-1 list-disc pl-5">
            {generationWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && drafts.length > 0 && (
        <p className="mb-4 border border-line bg-primary-soft px-4 py-3 text-sm text-ink-secondary">
          <strong className="text-ink">
            {drafts.length} draft payslip{drafts.length === 1 ? '' : 's'} awaiting review
            {heldCount > 0 && ` (${heldCount} on hold)`}
            {inProgressCount > 0 && ` (${inProgressCount} still in progress)`}.
          </strong>{' '}
          Employees can&apos;t see drafts until they are finalized.
        </p>
      )}

      {generating && <p className="text-ink-muted">Preparing this week&apos;s draft payslips...</p>}
      {!generating && loading && <p className="text-ink-muted">Loading payroll...</p>}
      {error && <p className="text-red-700">{error}</p>}
      {!loading && !error && payroll.length === 0 && (
        <EmptyState message="No payroll entries yet." hint="Draft payslips appear here automatically once employees have trips or attendance in a completed week." />
      )}

      {!loading && !error && payroll.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[520px_minmax(0,1fr)] xl:items-start">
          <section aria-label="Employees this period" className="card flex flex-col">
            <table className="w-full table-fixed text-left text-sm text-ink-metric">
              <colgroup>
                <col />
                <col style={{ width: '150px' }} />
                <col style={{ width: '130px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="px-2 py-2.5 first:pl-5">Employee</th>
                  <th className="px-2 py-2.5">Rate Type</th>
                  <th className="px-2 py-2.5 last:pr-5">Payslip</th>
                </tr>
              </thead>
              <tbody>
                {periodEntries.map((entry) => {
                  const active = selected?.payroll_id === entry.payroll_id
                  return (
                    <tr
                      key={entry.payroll_id}
                      onClick={() => setSelectedEmployeeId(entry.employee_id)}
                      aria-current={active || undefined}
                      className={`h-16 cursor-pointer border-b border-slate-200 ${
                        active ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-2 py-2 first:pl-5">
                        <span className="block truncate font-semibold text-primary">{entry.employee_name}</span>
                        <span className="block text-[13px] leading-[18px] text-ink-muted">{entry.position || '—'}</span>
                      </td>
                      <td className="px-2 py-2">{rateLabel(entry.rate_type)}</td>
                      <td className="px-2 py-2 last:pr-5">
                        <span className="flex flex-col items-start gap-1">
                          <StatusBadge status={entry.status} label={STATUS_LABEL[entry.status]} icon />
                          {entry.status === 'Draft' && entry.on_hold && <StatusBadge status="On Hold" />}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="flex min-h-[60px] items-center border-t border-line px-5 py-2 text-sm text-ink-secondary">
              {periodEntries.length} {periodEntries.length === 1 ? 'employee' : 'employees'} · {periodFinalized} of {periodEntries.length} finalized
            </div>
          </section>

          {selected && (
            <section aria-labelledby="ps-title" className="card flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 id="ps-title" className="text-lg leading-[26px] font-bold text-ink">
                    Payslip · {selected.employee_name}
                  </h2>
                  <span className="rounded-[2px] bg-slate-200 px-2 py-0.5 text-xs font-semibold text-ink-secondary">
                    {selected.position || '—'} · {rateLabel(selected.rate_type)}
                  </span>
                  {selectedDraft && isWeekInProgress(selected.period_end) && (
                    <span className="rounded-[2px] bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Week in progress</span>
                  )}
                </div>
                {selectedDraft && selected.position === 'Driver' && (
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink-secondary">
                    <input
                      type="checkbox"
                      checked={selected.on_hold}
                      disabled={reviewingId !== null}
                      onChange={() => handleToggleHold(selected)}
                      className="h-5 w-5 accent-primary"
                    />
                    Hold this payslip
                  </label>
                )}
              </div>

              <div className="px-5 pt-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-ink">What this payslip pays for</h3>
                  <span className="text-[13px] text-ink-muted">{selected.period}</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full text-left text-sm text-ink-metric">
                  <thead>
                    <tr>
                      <th className="px-5 py-2.5">Line</th>
                      <th className="px-5 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!lines ? (
                      <tr>
                        <td colSpan={2} className="px-5 py-4 text-ink-muted">
                          Loading breakdown...
                        </td>
                      </tr>
                    ) : lines.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-5 py-4 text-ink-muted">
                          No lines on this payslip.
                        </td>
                      </tr>
                    ) : (
                      lines.map((item, index) => (
                        <tr key={index} className="h-12 border-b border-slate-200">
                          <td className="px-5 py-2">{item.description}</td>
                          <td className="px-5 py-2 text-right font-semibold tabular-nums">{formatMoney(item.amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-6 px-5 py-4 md:grid-cols-2">
                <section aria-labelledby="ps-earn">
                  <h3 id="ps-earn" className="mb-1 border-b border-line pb-2 text-sm font-semibold text-ink">
                    Earnings
                  </h3>
                  <div className={kv}>
                    <span className="text-ink-secondary">
                      {lines ? `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}` : 'Lines'}
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(selected.gross_pay)}</span>
                  </div>
                  <div className={`${kv} border-b-0`}>
                    <span className="font-semibold text-ink">Gross pay</span>
                    <span className="text-base font-semibold tabular-nums">{formatMoney(selected.gross_pay)}</span>
                  </div>
                </section>
                <section aria-labelledby="ps-ded">
                  <h3 id="ps-ded" className="mb-1 flex items-center justify-between gap-3 border-b border-line pb-2 text-sm font-semibold text-ink">
                    <span>Deductions</span>
                    {selectedDraft && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingDraft({
                            payrollId: selected.payroll_id,
                            employeeId: selected.employee_id,
                            employeeName: selected.employee_name,
                            periodStart: selected.period_start,
                            periodEnd: selected.period_end,
                            periodLabel: selected.period,
                          })
                        }
                        disabled={reviewingId !== null}
                        className="font-semibold text-primary hover:underline disabled:opacity-50"
                      >
                        Edit deductions
                      </button>
                    )}
                  </h3>
                  {deductionRows.map(([label, amount]) => (
                    <div key={label} className={kv}>
                      <span className="text-ink-secondary">{label}</span>
                      <span className={`font-semibold tabular-nums ${amount === 0 ? 'text-ink-muted' : ''}`}>
                        {amount < 0 ? '+' : ''}
                        {formatMoney(Math.abs(amount))}
                      </span>
                    </div>
                  ))}
                  {selected.status !== 'Paid' && (owedByEmployee[selected.employee_id] ?? 0) + selected.cash_advance_deducted > 0 && (
                    <p className="mt-2 text-[13px] text-ink-muted">
                      Cash advance owed before this payslip:{' '}
                      {formatMoney((owedByEmployee[selected.employee_id] ?? 0) + selected.cash_advance_deducted)}
                    </p>
                  )}
                  {selected.deductions_note && <p className="mt-2 text-[13px] text-amber-800">{selected.deductions_note}</p>}
                </section>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line bg-slate-50 px-5 py-3.5">
                <div>
                  <div className="text-sm font-semibold text-ink">
                    Net pay <span className="text-[13px] font-normal text-ink-muted">gross pay − deductions</span>
                  </div>
                  <div className="text-2xl leading-8 font-bold text-ink tabular-nums">{formatMoney(selected.net_pay)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {selectedDraft && (
                    <>
                      <button
                        onClick={() => handleRegenerate(selected)}
                        disabled={reviewingId !== null}
                        className="btn-secondary px-4 text-sm font-medium"
                      >
                        Regenerate
                      </button>
                      <button
                        onClick={() =>
                          setEditingDraft({
                            payrollId: selected.payroll_id,
                            employeeId: selected.employee_id,
                            employeeName: selected.employee_name,
                            periodStart: selected.period_start,
                            periodEnd: selected.period_end,
                            periodLabel: selected.period,
                          })
                        }
                        disabled={reviewingId !== null}
                        className="btn-secondary px-4 text-sm font-medium"
                      >
                        Edit Payslip
                      </button>
                      <button
                        onClick={() => handleFinalize([selected.payroll_id], selected.payroll_id)}
                        disabled={reviewingId !== null || selected.on_hold || isWeekInProgress(selected.period_end)}
                        title={
                          selected.on_hold
                            ? 'Remove the hold first'
                            : isWeekInProgress(selected.period_end)
                              ? 'Can be finalized once the week is over'
                              : undefined
                        }
                        className="btn-primary flex items-center gap-2 px-5 text-sm"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                        {reviewingId === selected.payroll_id ? 'Saving...' : 'Finalize Payslip'}
                      </button>
                    </>
                  )}
                  {selected.status === 'Pending' && (
                    <button
                      onClick={() => handleMarkPaid(selected.payroll_id)}
                      disabled={markingPaidId === selected.payroll_id}
                      className="btn-primary px-5 text-sm"
                    >
                      {markingPaidId === selected.payroll_id ? 'Saving...' : 'Mark Paid'}
                    </button>
                  )}
                  {selected.status === 'Paid' && <StatusBadge status="Paid" icon />}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {editingDraft && (
        <EditDraftPayslipModal
          draft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSaved={() => {
            // Cached breakdown is stale after an edit
            setLineItemsByPayroll((prev) => {
              const next = { ...prev }
              delete next[editingDraft.payrollId]
              return next
            })
            setEditingDraft(null)
            loadPayroll()
          }}
        />
      )}
    </div>
  )
}

export default PayrollSection
