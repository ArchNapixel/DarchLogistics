// PayrollSection: table of payroll entries, read from the
// payroll_payslips table (joined with employees for the display name).
// "Issue Payslip" and "Issue Cash Advance" open the two modals that
// actually create records; "Mark Paid" is the separate action that
// flips a Pending payslip to Paid once money has actually changed
// hands (issuing does NOT mark it paid automatically). Click a row to
// expand its line-item breakdown (src/lib/payslip.ts).
import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  markPayslipPaid,
  loadPayslipLineItems,
  type PayslipLineItem,
} from '../../../lib/payslip'
import IssuePayslipModal from './IssuePayslipModal'
import IssueCashAdvanceModal from './IssueCashAdvanceModal'

type PayrollEntry = {
  payroll_id: number
  employee_name: string
  period: string
  gross_pay: number
  cash_advance_deducted: number
  net_pay: number
  status: string
}

const STATUS_STYLES: Record<string, string> = {
  Paid: 'bg-green-100 text-green-700',
  Pending: 'bg-orange-100 text-orange-700',
}

function PayrollStatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
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
  const [showIssuePayslip, setShowIssuePayslip] = useState(false)
  const [showIssueAdvance, setShowIssueAdvance] = useState(false)
  const [markingPaidId, setMarkingPaidId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [lineItemsByPayroll, setLineItemsByPayroll] = useState<
    Record<number, PayslipLineItem[]>
  >({})
  const [lineItemsLoading, setLineItemsLoading] = useState(false)

  useEffect(() => {
    loadPayroll()
  }, [])

  async function loadPayroll() {
    setLoading(true)

    const { data, error } = await supabase
      .from('payroll_payslips')
      .select(
        'payroll_id, payroll_period_start, payroll_period_end, gross_pay, cash_advance_deducted, net_pay, payslip_status, employees(full_name)',
      )
      .order('payroll_period_start', { ascending: false })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setPayroll(
      data.map((entry) => ({
        payroll_id: entry.payroll_id,
        employee_name: entry.employees?.[0]?.full_name ?? '—',
        period: formatPeriod(entry.payroll_period_start, entry.payroll_period_end),
        gross_pay: entry.gross_pay,
        cash_advance_deducted: entry.cash_advance_deducted,
        net_pay: entry.net_pay,
        status: entry.payslip_status,
      })),
    )
    setError(null)
    setLoading(false)
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
            onClick={() => setShowIssueAdvance(true)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Issue Cash Advance
          </button>
          <button
            onClick={() => setShowIssuePayslip(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Issue Payslip
          </button>
        </div>
      </div>

      {actionError && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {loading && <p className="mt-4 text-slate-500">Loading payroll...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && payroll.length === 0 && (
        <p className="mt-4 text-slate-500">No payroll entries yet.</p>
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
                    <td className="px-4 py-3 font-medium text-slate-900">
                      ₱{entry.net_pay.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <PayrollStatusBadge status={entry.status} />
                    </td>
                    <td className="px-4 py-3">
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
                      <td colSpan={7} className="bg-slate-50 px-4 py-3">
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

      {showIssuePayslip && (
        <IssuePayslipModal
          onClose={() => setShowIssuePayslip(false)}
          onIssued={() => {
            setShowIssuePayslip(false)
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
