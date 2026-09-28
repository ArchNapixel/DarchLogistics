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
import { Fragment, useEffect, useState } from 'react'
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
  totalEmployeeDeductions,
  type PayslipLineItem,
} from '../../../lib/payslip'
import EditDraftPayslipModal, { type DraftToEdit } from './EditDraftPayslipModal'
import IssueCashAdvanceModal from './IssueCashAdvanceModal'
import CashAdvanceRequestsSection from './CashAdvanceRequestsSection'
import CashAdvanceLedgerSection from './CashAdvanceLedgerSection'
import AttendanceSection from './AttendanceSection'

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
  const [showIssueAdvance, setShowIssueAdvance] = useState(false)
  const [markingPaidId, setMarkingPaidId] = useState<number | null>(null)
  // payroll_id being finalized/discarded, or 'all' for Finalize All
  const [reviewingId, setReviewingId] = useState<number | 'all' | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [lineItemsByPayroll, setLineItemsByPayroll] = useState<
    Record<number, PayslipLineItem[]>
  >({})
  const [lineItemsLoading, setLineItemsLoading] = useState(false)
  const [showLedger, setShowLedger] = useState(false)
  const [showAttendance, setShowAttendance] = useState(false)

  useEffect(() => {
    generateThenLoad()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Create any missing drafts for last completed week, then show the list.
  // Last week (catches attendance recorded late) and the current week
  // (its drafts fill up as trips are delivered / attendance recorded).
  async function generateThenLoad() {
    setGenerating(true)
    const allWarnings: string[] = []
    for (const period of [getDefaultPayPeriod(), getCurrentPayPeriod()]) {
      const { warnings, error: generateError } = await generateDraftPayslips(period.start, period.end)
      allWarnings.push(...warnings)
      if (generateError) setActionError(`Couldn't update the draft payslips: ${generateError}`)
    }
    setGenerating(false)
    // Same employee can be flagged for both weeks -- show it once
    setGenerationWarnings([...new Set(allWarnings)])
    await loadPayroll()
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
    setError(null)
    setLoading(false)
  }

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
      !window.confirm(
        `Recalculate ${entry.employee_name}'s draft (${entry.period}) from the current trips and attendance? ` +
          `Any edits you made to it will be lost.`,
      )
    ) {
      return
    }

    setReviewingId(entry.payroll_id)
    setActionError(null)

    const { error: discardError } = await discardDraftPayslip(entry.payroll_id)
    if (discardError) {
      setReviewingId(null)
      setActionError(discardError)
      loadPayroll()
      return
    }

    const { createdIds, warnings, error: generateError } = await generateDraftPayslips(
      entry.period_start,
      entry.period_end,
      entry.employee_id,
    )
    const problem =
      generateError ??
      warnings[0] ??
      (createdIds.length === 0 ? `${entry.employee_name} has nothing to pay for ${entry.period} anymore, so no draft was created.` : null)

    if (entry.on_hold && createdIds.length > 0) {
      const { error: holdError } = await setPayslipHold(createdIds[0], true)
      if (holdError) setActionError(`Regenerated, but the hold couldn't be re-applied: ${holdError}`)
    }

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
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Payroll</h2>
        <div className="flex gap-3">
          <button
            onClick={() => setShowLedger((visible) => !visible)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {showLedger ? 'Hide Cash Advance Ledger' : 'View Cash Advance Ledger'}
          </button>
          <button
            onClick={() => setShowAttendance((visible) => !visible)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {showAttendance ? 'Hide Attendance' : 'Record Attendance'}
          </button>
          <button
            onClick={() => setShowIssueAdvance(true)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Issue Cash Advance
          </button>
        </div>
      </div>

      <div className="mt-6">
        <CashAdvanceRequestsSection />
      </div>

      {showLedger && (
        <section className="mt-6 border-t border-slate-200 pt-6">
          <h3 className="text-lg font-semibold text-slate-900">Cash Advance Ledger</h3>
          <div className="mt-4"><CashAdvanceLedgerSection /></div>
        </section>
      )}

      {showAttendance && (
        <section className="mt-6 border-t border-slate-200 pt-6">
          <h3 className="text-lg font-semibold text-slate-900">Employee Attendance</h3>
          <div className="mt-4"><AttendanceSection /></div>
        </section>
      )}

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
            Employees can&apos;t see drafts. Click a row to check it, then finalize to release it.
          </p>
          {draftIds.length > 0 && (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `Finalize and release ${draftIds.length} draft payslip${draftIds.length === 1 ? '' : 's'} to employees?` +
                      (heldCount + inProgressCount > 0
                        ? ' Drafts on hold or with the week still in progress are skipped.'
                        : ''),
                  )
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

      {!loading && !error && payroll.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Gross Pay</th>
                <th className="px-4 py-3 font-medium">Cash Advance</th>
                <th className="px-4 py-3 font-medium">Gov&apos;t + Tax</th>
                <th className="px-4 py-3 font-medium">Net Pay</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payroll.map((entry) => (
                <Fragment key={entry.payroll_id}>
                  <tr
                    onClick={() => toggleExpand(entry.payroll_id)}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-slate-900">
                      {entry.employee_name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{entry.period}</td>
                    <td className="px-4 py-3 text-slate-600">
                      ₱{entry.gross_pay.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      ₱{entry.cash_advance_deducted.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      ₱{entry.gov_deductions.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      ₱{entry.net_pay.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
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
                    </td>
                    <td className="px-4 py-3">
                      {entry.status === 'Draft' && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleFinalize([entry.payroll_id], entry.payroll_id)
                            }}
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
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingDraft({
                                payrollId: entry.payroll_id,
                                employeeId: entry.employee_id,
                                employeeName: entry.employee_name,
                                periodStart: entry.period_start,
                                periodEnd: entry.period_end,
                                periodLabel: entry.period,
                              })
                            }}
                            disabled={reviewingId !== null}
                            className="font-medium text-slate-700 hover:text-slate-900 disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRegenerate(entry)
                            }}
                            disabled={reviewingId !== null}
                            className="font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
                          >
                            Regenerate
                          </button>
                          {entry.position === 'Driver' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleToggleHold(entry)
                              }}
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
                          onClick={(e) => {
                            e.stopPropagation()
                            handleMarkPaid(entry.payroll_id)
                          }}
                          disabled={markingPaidId === entry.payroll_id}
                          className="font-medium text-slate-700 hover:text-slate-900 disabled:opacity-50"
                        >
                          {markingPaidId === entry.payroll_id
                            ? 'Saving...'
                            : 'Mark Paid'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedId === entry.payroll_id && (
                    <tr className="border-b border-slate-100 last:border-0">
                      <td colSpan={8} className="bg-slate-50 px-4 py-3">
                        {lineItemsLoading && !lineItemsByPayroll[entry.payroll_id] ? (
                          <p className="text-sm text-slate-500">Loading breakdown...</p>
                        ) : (
                          <div className="flex flex-col gap-1.5 text-sm">
                            {(lineItemsByPayroll[entry.payroll_id] ?? []).map(
                              (item, index) => (
                                <div key={index} className="flex items-center justify-between">
                                  <span className="text-slate-600">{item.description}</span>
                                  <span className="font-medium text-slate-900">
                                    ₱{item.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                  </span>
                                </div>
                              ),
                            )}
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
                            {entry.deductions_note && (
                              <p className="text-xs text-amber-700">{entry.deductions_note}</p>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
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

      {showIssueAdvance && (
        <IssueCashAdvanceModal
          onClose={() => setShowIssueAdvance(false)}
          onIssued={() => setShowIssueAdvance(false)}
        />
      )}
    </div>
  )
}

export default PayrollSection
