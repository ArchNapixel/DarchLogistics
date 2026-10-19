// MyPayslipSection: the logged-in employee's own payslip history --
// shown to Driver, Mechanic, Helper (via EmployeeDashboard.tsx) and
// Dispatcher (via their own dashboard route). Read-only; issuing and
// marking payslips Paid only happens from the admin side
// (PayrollSection.tsx). Click a payslip to expand its line-item
// breakdown -- for a Driver that's one row per trip delivered that
// period, for everyone else their salary vs attendance -- then the
// deductions (cash advance, SSS, PhilHealth, Pag-IBIG, withholding tax).
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPayslipsForEmployee,
  loadPayslipLineItems,
  type Payslip,
  type PayslipLineItem,
} from '../../../lib/payslip'
import ReportPayslipIssueModal from './ReportPayslipIssueModal'
import StatusBadge from '../../../components/StatusBadge'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

function formatPeriod(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`
}

function MyPayslipSection({
  onIssueReported,
}: {
  onIssueReported?: () => void
}) {
  const { employeeId } = useAuth()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [lineItemsByPayroll, setLineItemsByPayroll] = useState<
    Record<number, PayslipLineItem[]>
  >({})
  const [lineItemsLoading, setLineItemsLoading] = useState(false)
  const [lineItemsError, setLineItemsError] = useState<string | null>(null)
  const [reportingPayslip, setReportingPayslip] = useState<Payslip | null>(
    null,
  )

  useEffect(() => {
    if (employeeId) {
      load(employeeId)
    } else {
      setLoading(false)
    }
  }, [employeeId])

  async function load(id: number) {
    setLoading(true)

    const { payslips: loadedPayslips, error: loadError } =
      await loadPayslipsForEmployee(id)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setPayslips(loadedPayslips)
    setError(null)
    setLoading(false)
  }

  async function toggleExpand(payrollId: number) {
    if (expandedId === payrollId) {
      setExpandedId(null)
      return
    }

    setExpandedId(payrollId)

    if (!lineItemsByPayroll[payrollId]) {
      setLineItemsLoading(true)
      const { lineItems, error: itemsError } = await loadPayslipLineItems(payrollId)
      setLineItemsLoading(false)

      if (itemsError) {
        setLineItemsError(itemsError)
        return
      }

      setLineItemsByPayroll((prev) => ({ ...prev, [payrollId]: lineItems }))
    }
  }

  if (loading) {
    return <p className="text-slate-500">Loading your payslips...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (payslips.length === 0) {
    return <EmptyState message="No payslips issued yet." />
  }

  return (
    <div className="grid gap-3">
      {lineItemsError && <p className="text-sm text-red-700">{lineItemsError}</p>}

      {payslips.map((payslip) => {
        const isExpanded = expandedId === payslip.payroll_id
        return (
          <div
            key={payslip.payroll_id}
            className="border border-slate-200 p-4"
          >
            <button
              onClick={() => toggleExpand(payslip.payroll_id)}
              className="flex w-full items-center justify-between text-left"
            >
              <div>
                <p className="font-semibold text-slate-900">
                  {formatPeriod(payslip.payroll_period_start, payslip.payroll_period_end)}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Net pay: {formatMoney(payslip.net_pay)}
                </p>
              </div>
              <StatusBadge status={payslip.payslip_status} />
            </button>

            {isExpanded && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                {lineItemsLoading && !lineItemsByPayroll[payslip.payroll_id] ? (
                  <p className="text-sm text-slate-500">Loading breakdown...</p>
                ) : (
                  <div className="flex flex-col gap-1.5 text-sm">
                    {(lineItemsByPayroll[payslip.payroll_id] ?? []).map((item, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <span className="text-slate-600">{item.description}</span>
                        <span className="font-medium text-slate-900">
                          {formatMoney(item.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                      <span className="text-slate-600">Gross pay</span>
                      <span className="font-medium text-slate-900">
                        {formatMoney(payslip.gross_pay)}
                      </span>
                    </div>
                    {(
                      [
                        ['Cash advance deducted', payslip.cash_advance_deducted],
                        ['SSS', payslip.sss_ee],
                        ['PhilHealth', payslip.philhealth_ee],
                        ['Pag-IBIG', payslip.pagibig_ee],
                        ['Withholding tax', payslip.withholding_tax],
                      ] as const
                    )
                      .filter(([, amount]) => amount !== 0)
                      .map(([label, amount]) => (
                        <div key={label} className="flex items-center justify-between">
                          <span className="text-slate-600">{label}</span>
                          <span className="font-medium text-red-600">
                            {/* negative = refund of an earlier over-deduction this month */}
                            {amount > 0 ? '-' : '+'}{formatMoney(Math.abs(amount))}
                          </span>
                        </div>
                      ))}
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
                      <span>Net pay</span>
                      <span>{formatMoney(payslip.net_pay)}</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setReportingPayslip(payslip)}
                  className="mt-3 text-sm font-medium text-slate-600 underline hover:text-slate-900"
                >
                  Report an Issue
                </button>
              </div>
            )}
          </div>
        )
      })}

      {reportingPayslip && employeeId && (
        <ReportPayslipIssueModal
          employeeId={employeeId}
          payrollId={reportingPayslip.payroll_id}
          period={formatPeriod(
            reportingPayslip.payroll_period_start,
            reportingPayslip.payroll_period_end,
          )}
          onClose={() => setReportingPayslip(null)}
          onReported={() => {
            setReportingPayslip(null)
            onIssueReported?.()
          }}
        />
      )}
    </div>
  )
}

export default MyPayslipSection
