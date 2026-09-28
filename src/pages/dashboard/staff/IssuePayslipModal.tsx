// IssuePayslipModal: admin picks an employee + pay period, previews
// the auto-calculated breakdown (trip-by-trip for a Driver, salary vs
// attendance for everyone else), can override any line's amount or add
// manual lines (bonus, correction...), decides how much (if any) of
// their outstanding cash advance to deduct this time, then issues the
// payslip -- created as Pending (see PayrollSection.tsx for the
// separate "Mark Paid" action). An overridden amount is saved with the
// auto value noted in its description, so the payslip record shows it
// was changed. See src/lib/payslip.ts for the pay rules themselves.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  loadPayrollSettings,
  getDefaultPayPeriod,
  buildEmployeePayLineItems,
  getOutstandingCashAdvance,
  issuePayslip,
  type PayrollSettings,
  type EmployeePayRate,
} from '../../../lib/payslip'

type EmployeeOption = EmployeePayRate & {
  full_name: string
}

// One row of the editable breakdown. autoAmount is what payslip.ts
// calculated (null for a line the admin added by hand); amount is the
// text in the input box, which starts as the auto value.
type EditableLine = {
  itinerary_id: number | null
  description: string
  autoAmount: number | null
  amount: string
}

const roundPeso = (value: number) => Math.round(value * 100) / 100
const formatPeso = (value: number) =>
  `₱${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

function IssuePayslipModal({
  onClose,
  onIssued,
}: {
  onClose: () => void
  onIssued: () => void
}) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [settings, setSettings] = useState<PayrollSettings | null>(null)
  const defaultPeriod = getDefaultPayPeriod()
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start)
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end)
  const [lineItems, setLineItems] = useState<EditableLine[]>([])
  const [outstandingAdvance, setOutstandingAdvance] = useState(0)
  const [deductAmount, setDeductAmount] = useState('0')
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadInitialData()
  }, [])

  async function loadInitialData() {
    setLoadingOptions(true)

    const [employeesResult, settingsResult] = await Promise.all([
      supabase
        .from('employees')
        .select(
          'employee_id, full_name, position, rate_type, daily_rate, weekly_salary, monthly_salary, hourly_rate',
        )
        .order('full_name', { ascending: true }),
      loadPayrollSettings(),
    ])

    if (employeesResult.error) {
      setError(employeesResult.error.message)
      setLoadingOptions(false)
      return
    }
    if (settingsResult.error) {
      setError(settingsResult.error)
      setLoadingOptions(false)
      return
    }

    setEmployees(employeesResult.data)
    setSettings(settingsResult.settings)
    if (employeesResult.data.length > 0) {
      setEmployeeId(String(employeesResult.data[0].employee_id))
    }
    setLoadingOptions(false)
  }

  useEffect(() => {
    if (employeeId && settings) {
      loadPreview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, periodStart, periodEnd, settings])

  async function loadPreview() {
    if (!settings) return

    const employee = employees.find((e) => String(e.employee_id) === employeeId)
    if (!employee) return

    setLoadingPreview(true)
    setError(null)

    const [advanceResult, payResult] = await Promise.all([
      getOutstandingCashAdvance(employee.employee_id),
      buildEmployeePayLineItems(employee, periodStart, periodEnd, settings),
    ])

    if (advanceResult.error) {
      setError(advanceResult.error)
      setLoadingPreview(false)
      return
    }
    if (payResult.error) {
      setError(payResult.error)
      setLineItems([])
      setLoadingPreview(false)
      return
    }

    setLineItems(
      payResult.lineItems.map((item) => ({
        itinerary_id: item.itinerary_id,
        description: item.description,
        autoAmount: roundPeso(item.amount),
        amount: String(roundPeso(item.amount)),
      })),
    )
    setOutstandingAdvance(advanceResult.outstanding)
    setDeductAmount('0')
    setLoadingPreview(false)
  }

  function updateLine(index: number, changes: Partial<EditableLine>) {
    setLineItems((lines) => lines.map((line, i) => (i === index ? { ...line, ...changes } : line)))
  }

  function addManualLine() {
    setLineItems((lines) => [...lines, { itinerary_id: null, description: '', autoAmount: null, amount: '' }])
  }

  function removeLine(index: number) {
    setLineItems((lines) => lines.filter((_, i) => i !== index))
  }

  const grossPay = lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const deductValue = Number(deductAmount) || 0
  const netPay = grossPay - deductValue

  async function handleSubmit() {
    if (!employeeId) {
      setError('Select an employee.')
      return
    }
    if (deductValue < 0 || deductValue > outstandingAdvance) {
      setError(
        `Cash advance deduction must be between 0 and the outstanding balance (₱${outstandingAdvance.toLocaleString()}).`,
      )
      return
    }
    if (lineItems.length === 0) {
      setError('Nothing to pay for this period.')
      return
    }
    for (const line of lineItems) {
      if (line.autoAmount === null && !line.description.trim()) {
        setError('Enter a description for every line you added.')
        return
      }
      if (line.amount.trim() === '' || !(Number(line.amount) >= 0)) {
        setError(`Enter an amount of 0 or more for "${line.description || 'the new line'}".`)
        return
      }
    }

    // Final line items as they'll be saved -- overridden amounts and
    // manual lines get tagged in the description so the payslip itself
    // shows what the admin changed.
    const finalLineItems = lineItems.map((line) => {
      const amount = Number(line.amount)
      let description = line.description.trim()
      if (line.autoAmount === null) {
        description += ' (added by admin)'
      } else if (roundPeso(amount) !== line.autoAmount) {
        description += ` (adjusted by admin, auto: ${formatPeso(line.autoAmount)})`
      }
      return { itinerary_id: line.itinerary_id, description, amount }
    })

    const employee = employees.find((e) => String(e.employee_id) === employeeId)
    if (!employee) {
      setError('Select an employee.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: issueError } = await issuePayslip({
      employeeId: Number(employeeId),
      rateType: employee.rate_type,
      periodStart,
      periodEnd,
      lineItems: finalLineItems,
      cashAdvanceDeducted: deductValue,
    })

    setSubmitting(false)

    if (issueError) {
      setError(issueError)
      return
    }

    onIssued()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Issue Payslip</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {loadingOptions ? (
          <p className="mt-4 text-slate-500">Loading...</p>
        ) : employees.length === 0 ? (
          <p className="mt-4 text-slate-500">No employees found.</p>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
                Employee
                <select
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
                >
                  {employees.map((employee) => (
                    <option key={employee.employee_id} value={employee.employee_id}>
                      {employee.full_name} ({employee.position})
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Period start
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Period end
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-6 border-t border-slate-200 pt-4">
              <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Breakdown
              </h4>

              {loadingPreview && (
                <p className="mt-3 text-sm text-slate-500">Calculating...</p>
              )}

              {!loadingPreview && lineItems.length === 0 && (
                <p className="mt-3 text-sm text-slate-500">
                  Nothing to pay for this period yet.
                </p>
              )}

              {!loadingPreview && (
                <div className="mt-3 flex flex-col gap-2 text-sm">
                  {lineItems.map((item, index) => {
                    const isAdjusted =
                      item.autoAmount !== null && roundPeso(Number(item.amount) || 0) !== item.autoAmount

                    return (
                      <div key={index} className="flex items-start justify-between gap-3">
                        {item.autoAmount === null ? (
                          <input
                            type="text"
                            placeholder="e.g. Bonus, correction"
                            aria-label="Line description"
                            value={item.description}
                            onChange={(e) => updateLine(index, { description: e.target.value })}
                            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-slate-900 focus:border-slate-500 focus:outline-none"
                          />
                        ) : (
                          <span className="flex-1 text-slate-600">
                            {item.description}
                            {isAdjusted && (
                              <span className="mt-0.5 block text-xs text-amber-700">
                                Adjusted — auto was {formatPeso(item.autoAmount!)}{' '}
                                <button
                                  type="button"
                                  onClick={() => updateLine(index, { amount: String(item.autoAmount) })}
                                  className="underline hover:text-amber-900"
                                >
                                  Reset
                                </button>
                              </span>
                            )}
                          </span>
                        )}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label="Amount"
                          value={item.amount}
                          onChange={(e) => updateLine(index, { amount: e.target.value })}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right font-medium text-slate-900 focus:border-slate-500 focus:outline-none"
                        />
                        {item.autoAmount === null && (
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            aria-label="Remove line"
                            className="py-1 text-slate-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )
                  })}
                  <button
                    type="button"
                    onClick={addManualLine}
                    className="self-start text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    + Add line
                  </button>
                  {lineItems.length > 0 && (
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
                      <span>Gross pay</span>
                      <span>{formatPeso(grossPay)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 rounded-lg bg-slate-50 p-4">
              <h4 className="font-medium text-slate-900">Cash advance</h4>
              <p className="mt-1 text-sm text-slate-500">
                Outstanding balance: ₱{outstandingAdvance.toLocaleString()}
              </p>
              <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
                Deduct this payslip (optional)
                <input
                  type="number"
                  min="0"
                  max={outstandingAdvance}
                  step="0.01"
                  value={deductAmount}
                  onChange={(e) => setDeductAmount(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <span className="font-medium text-slate-700">Net pay</span>
              <span className="text-lg font-bold text-slate-900">
                {formatPeso(netPay)}
              </span>
            </div>
          </>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || loadingOptions || loadingPreview || lineItems.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Issuing...' : 'Issue Payslip'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default IssuePayslipModal
