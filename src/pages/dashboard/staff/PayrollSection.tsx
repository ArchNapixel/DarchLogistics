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
import { useEffect, useRef, useState } from 'react'
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

type PayrollEntry = {
  payroll_id: number
  employee_id: number
  employee_name: string
  position: string
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

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-blue-100 text-blue-700',
  Paid: 'bg-green-100 text-green-700',
  Pending: 'bg-orange-100 text-orange-700',
}

const formatPeso = (value: number) =>
  `₱${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

function PayrollStatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

function formatPeriod(start: string, end: string) {
  const format = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${format(start)} – ${format(end)}`
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
  const [expandedId, setExpandedId] = useState<number | null>(null)
  // Which employee's card is open (one at a time)
  const [openEmployeeId, setOpenEmployeeId] = useState<number | null>(null)
  const [lineItemsByPayroll, setLineItemsByPayroll] = useState<
    Record<number, PayslipLineItem[]>
  >({})
  const [lineItemsLoading, setLineItemsLoading] = useState(false)

  // What each employee still owes (cash advances), by employee id
  const [owedByEmployee, setOwedByEmployee] = useState<Record<number, number>>({})

  // React StrictMode runs the open-effect twice in dev -- only regenerate
  // all drafts once per page open.
  const askedRegenerateAll = useRef(false)

  useEffect(() => {
    generateThenLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Create any missing drafts for last completed week, then show the list.
  // Last week (catches attendance recorded late) and the current week
  // (its drafts fill up as trips are delivered / attendance recorded).
  // Then regenerates every unfinalized draft from scratch.
  async function generateThenLoad() {
    setGenerating(true)
    const allWarnings: string[] = []
    const periods = [getDefaultPayPeriod(), getCurrentPayPeriod()]
    for (const period of periods) {
      const { warnings, error: generateError } = await generateDraftPayslips(period.start, period.end)
      allWarnings.push(...warnings)
      if (generateError) setActionError(`Couldn't update the draft payslips: ${generateError}`)
    }
    if (!askedRegenerateAll.current) {
      askedRegenerateAll.current = true
      allWarnings.push(...(await regenerateAllDrafts(periods.map((p) => p.start))))
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

  // On page open: rebuild every unfinalized draft of last week and this
  // week from scratch, no confirmation. Admin edits on them are lost.
  // Returns warnings to show on the page.
  async function regenerateAllDrafts(periodStarts: string[]): Promise<string[]> {
    const { data, error: draftsError } = await supabase
      .from('payroll_payslips')
      .select('payroll_id, employee_id, payroll_period_start, payroll_period_end, on_hold, employees(full_name)')
      .is('finalized_at', null)
      .in('payroll_period_start', periodStarts)
    if (draftsError) return [`Couldn't check drafts to regenerate: ${draftsError.message}`]

    const drafts = data.map((d) => ({
      payroll_id: d.payroll_id,
      employee_id: d.employee_id,
      employee_name: (d.employees as unknown as { full_name: string } | null)?.full_name ?? '—',
      period: formatPeriod(d.payroll_period_start, d.payroll_period_end),
      period_start: d.payroll_period_start,
      period_end: d.payroll_period_end,
      on_hold: d.on_hold,
    }))

    const problems: string[] = []
    for (const draft of drafts) {
      const problem = await regenerateDraft(draft)
      if (problem) problems.push(`${draft.employee_name}: ${problem}`)
    }
    return problems
  }

  async function loadPayroll() {
    setLoading(true)

    const { data, error } = await supabase
      .from('payroll_payslips')
      .select(
        'payroll_id, payroll_period_start, payroll_period_end, gross_pay, cash_advance_deducted, sss_ee, philhealth_ee, pagibig_ee, withholding_tax, deductions_note, net_pay, payslip_status, finalized_at, on_hold, employee_id, employees(full_name, position)',
      )
      .order('payroll_period_start', { ascending: false })

    if (error) {
      setError(error.message)
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
        const employee = entry.employees as unknown as { full_name: string; position: string } | null

        return {
          payroll_id: entry.payroll_id,
          employee_id: entry.employee_id,
          employee_name: employee?.full_name ?? '—',
          position: employee?.position ?? '',
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

  async function toggleExpand(payrollId: number) {
    if (expandedId === payrollId) {
      setExpandedId(null)
      return
    }

    setExpandedId(payrollId)

    if (!lineItemsByPayroll[payrollId]) {
      setLineItemsLoading(true)
      const { lineItems, error: lineItemsError } = await loadPayslipLineItems(payrollId)
      setLineItemsLoading(false)

      if (lineItemsError) {
        setActionError(lineItemsError)
        return
      }

      setLineItemsByPayroll((prev) => ({ ...prev, [payrollId]: lineItems }))
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Payroll Master</h2>

      {actionError && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {generationWarnings.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Couldn&apos;t create a draft for:</p>
          <ul className="mt-1 list-disc pl-5">
            {generationWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {generating && <p className="mt-4 text-slate-500">Preparing this week&apos;s draft payslips...</p>}
      {!generating && loading && <p className="mt-4 text-slate-500">Loading payroll...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && payroll.length === 0 && (
        <p className="mt-4 text-slate-500">
          No payroll entries yet. Draft payslips appear here automatically once employees have trips
          or attendance in a completed week.
        </p>
      )}

      {!loading && !error && drafts.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
          <p className="text-blue-900">
            <span className="font-semibold">
              {drafts.length} draft payslip{drafts.length === 1 ? '' : 's'} awaiting review
              {heldCount > 0 && ` (${heldCount} on hold)`}
              {inProgressCount > 0 && ` (${inProgressCount} still in progress)`}.
            </span>{' '}
            Employees can&apos;t see drafts. Open an employee's card to check their draft, then finalize to release it.
          </p>
          {draftIds.length > 0 && (
            <button
              onClick={async () => {
                if (
                  await confirmDialog({
                    message:
                      `Finalize and release ${draftIds.length} draft payslip${draftIds.length === 1 ? '' : 's'} to employees?` +
                      (heldCount + inProgressCount > 0
                        ? ' Drafts on hold or with the week still in progress are skipped.'
                        : ''),
                    confirmLabel: 'Finalize',
                  })
                ) {
                  handleFinalize(draftIds, 'all')
                }
              }}
              disabled={reviewingId !== null}
              className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {reviewingId === 'all' ? 'Finalizing...' : `Finalize all ${draftIds.length}`}
            </button>
          )}
        </div>
      )}

      {/* One card per employee: click it to list all their payslips, click a payslip for its breakdown */}
      {!loading && !error && payroll.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {employeeGroups.map((group) => {
            const isOpen = openEmployeeId === group.employee_id
            const draftCount = group.entries.filter((e) => e.status === 'Draft').length
            const pendingCount = group.entries.filter((e) => e.status === 'Pending').length
            const latest = group.entries[0]
            return (
              <div key={group.employee_id} className="overflow-hidden rounded-2xl border-2 border-slate-400 bg-white">
                <button
                  onClick={() => {
                    setOpenEmployeeId(isOpen ? null : group.employee_id)
                    setExpandedId(null)
                  }}
                  className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{group.employee_name}</p>
                    <p className="text-xs text-slate-500">
                      {group.position || '—'} · {group.entries.length} payslip{group.entries.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {/* Chevron in the middle: points down when closed, flips up when open */}
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
                    {draftCount > 0 && (
                      <span className="bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                        {draftCount} draft{draftCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {pendingCount > 0 && (
                      <span className="bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                        {pendingCount} to pay
                      </span>
                    )}
                    <span className="text-slate-500">Latest net:</span>
                    <span className="font-medium text-slate-900">{formatPeso(latest.net_pay)}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t-2 border-slate-400">
                    {group.entries.map((entry) => (
                      <div key={entry.payroll_id} className="border-b border-slate-300 last:border-0">
                        <div
                          onClick={() => toggleExpand(entry.payroll_id)}
                          className="grid cursor-pointer grid-cols-2 items-center gap-x-6 gap-y-2 px-4 py-3 text-sm hover:bg-slate-50 md:grid-cols-[minmax(12rem,1.2fr)_1fr_1fr_minmax(16rem,1.5fr)]"
                        >
                          <div>
                            <p className="text-slate-900">{entry.period}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <PayrollStatusBadge status={entry.status} />
                              {entry.status === 'Draft' && entry.on_hold && (
                                <span className="bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">On Hold</span>
                              )}
                              {entry.status === 'Draft' && isWeekInProgress(entry.period_end) && (
                                <span className="bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                  Week in progress
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-slate-600">Gross {formatPeso(entry.gross_pay)}</div>
                          <div className="font-medium text-slate-900">Net {formatPeso(entry.net_pay)}</div>
                          <div className="col-span-2 md:col-span-1 md:justify-self-end" onClick={(e) => e.stopPropagation()}>
                            {entry.status === 'Draft' && (
                              <div className="flex flex-wrap gap-x-3 gap-y-1">
                                <button
                                  onClick={() => handleFinalize([entry.payroll_id], entry.payroll_id)}
                                  disabled={reviewingId !== null || entry.on_hold || isWeekInProgress(entry.period_end)}
                                  title={
                                    entry.on_hold
                                      ? 'Remove the hold first'
                                      : isWeekInProgress(entry.period_end)
                                        ? 'Can be finalized once the week is over'
                                        : undefined
                                  }
                                  className="font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
                                >
                                  {reviewingId === entry.payroll_id ? 'Saving...' : 'Finalize'}
                                </button>
                                <button
                                  onClick={() =>
                                    setEditingDraft({
                                      payrollId: entry.payroll_id,
                                      employeeId: entry.employee_id,
                                      employeeName: entry.employee_name,
                                      periodStart: entry.period_start,
                                      periodEnd: entry.period_end,
                                      periodLabel: entry.period,
                                    })
                                  }
                                  disabled={reviewingId !== null}
                                  className="font-medium text-slate-700 hover:text-slate-900 disabled:opacity-50"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleRegenerate(entry)}
                                  disabled={reviewingId !== null}
                                  className="font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
                                >
                                  Regenerate
                                </button>
                                {entry.position === 'Driver' && (
                                  <button
                                    onClick={() => handleToggleHold(entry)}
                                    disabled={reviewingId !== null}
                                    className="font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                                  >
                                    {entry.on_hold ? 'Remove Hold' : 'Hold Payslip'}
                                  </button>
                                )}
                              </div>
                            )}
                            {entry.status === 'Pending' && (
                              <button
                                onClick={() => handleMarkPaid(entry.payroll_id)}
                                disabled={markingPaidId === entry.payroll_id}
                                className="font-medium text-slate-700 hover:text-slate-900 disabled:opacity-50"
                              >
                                {markingPaidId === entry.payroll_id ? 'Saving...' : 'Mark Paid'}
                              </button>
                            )}
                          </div>
                        </div>

                        {expandedId === entry.payroll_id && (
                          <div className="bg-slate-50 px-4 py-3">
                            {lineItemsLoading && !lineItemsByPayroll[entry.payroll_id] ? (
                              <p className="text-sm text-slate-500">Loading breakdown...</p>
                            ) : (
                              <div className="flex flex-col gap-1.5 text-sm">
                                {(lineItemsByPayroll[entry.payroll_id] ?? []).map((item, index) => (
                                  <div key={index} className="flex items-center justify-between">
                                    <span className="text-slate-600">{item.description}</span>
                                    <span className="font-medium text-slate-900">
                                      ₱{item.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                    </span>
                                  </div>
                                ))}
                                <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
                                  <span className="text-slate-600">Gross pay</span>
                                  <span className="font-medium text-slate-900">{formatPeso(entry.gross_pay)}</span>
                                </div>
                                {(
                                  [
                                    ['Cash advance', entry.cash_advance_deducted],
                                    ['SSS', entry.sss_ee],
                                    ['PhilHealth', entry.philhealth_ee],
                                    ['Pag-IBIG', entry.pagibig_ee],
                                    ['Withholding tax', entry.withholding_tax],
                                  ] as const
                                )
                                  .filter(([, amount]) => amount !== 0)
                                  .map(([label, amount]) => (
                                    <div key={label} className="flex items-center justify-between">
                                      <span className="text-slate-600">{label}</span>
                                      <span className="font-medium text-red-600">
                                        {amount > 0 ? '-' : '+'}
                                        {formatPeso(Math.abs(amount))}
                                      </span>
                                    </div>
                                  ))}
                                <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-900">
                                  <span>Net pay</span>
                                  <span>{formatPeso(entry.net_pay)}</span>
                                </div>
                                {entry.status !== 'Paid' && (owedByEmployee[entry.employee_id] ?? 0) + entry.cash_advance_deducted > 0 && (
                                  <p className="text-xs text-slate-500">
                                    Cash advance owed before this payslip:{' '}
                                    {formatPeso((owedByEmployee[entry.employee_id] ?? 0) + entry.cash_advance_deducted)}
                                  </p>
                                )}
                                {entry.deductions_note && (
                                  <p className="text-xs text-amber-700">{entry.deductions_note}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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
            setExpandedId(null)
            setEditingDraft(null)
            loadPayroll()
          }}
        />
      )}
    </div>
  )
}

export default PayrollSection
