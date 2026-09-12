// MyPayslipSection: the logged-in employee's own payslip history --
// shown to Driver, Mechanic, Helper (via EmployeeDashboard.tsx) and
// Dispatcher (via their own dashboard route). Read-only; issuing and
// marking payslips Paid only happens from the admin side
// (PayrollSection.tsx). Click a payslip to expand its line-item
// breakdown -- for a Driver that's one row per trip delivered that
// period, for everyone else it's their salary + daily allowance.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPayslipsForEmployee,
  loadPayslipLineItems,
  type Payslip,
  type PayslipLineItem,
} from '../../../lib/payslip'

const STATUS_STYLES: Record<string, string> = {
  Paid: 'bg-green-100 text-green-700',
  Pending: 'bg-orange-100 text-orange-700',
}

function StatusBadge({ status }: { status: string }) {
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

function MyPayslipSection() {
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
    return <p className="text-slate-500">No payslips issued yet.</p>
  }

  return (
    <div className="grid gap-3">
      {lineItemsError && <p className="text-sm text-red-700">{lineItemsError}</p>}

      {payslips.map((payslip) => {
        const isExpanded = expandedId === payslip.payroll_id
        return (
          <div
            key={payslip.payroll_id}
            className="rounded-xl border border-slate-200 p-4"
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
                  Net pay: ₱{payslip.net_pay.toLocaleString()}
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
                          ₱{item.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                      <span className="text-slate-600">Gross pay</span>
                      <span className="font-medium text-slate-900">
                        ₱{payslip.gross_pay.toLocaleString()}
                      </span>
                    </div>
                    {payslip.cash_advance_deducted > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Cash advance deducted</span>
                        <span className="font-medium text-red-600">
                          -₱{payslip.cash_advance_deducted.toLocaleString()}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
                      <span>Net pay</span>
                      <span>₱{payslip.net_pay.toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default MyPayslipSection
