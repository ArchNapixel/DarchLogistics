// IssueCashAdvanceModal: records a cash advance given to an employee --
// just the log of what was issued. Paying it back happens on their
// payslips: each draft automatically deducts cash_advance_deduction_rate %
// of gross pay (capped at what's still owed), and the admin can change
// that amount in EditDraftPayslipModal (see src/lib/payslip.ts).
// With `inline` it is the Cash Advances page's side panel (the canvas's
// "Issue Cash Advance" card) instead of a pop-up: no close button, and the
// form clears itself after each advance.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'

type EmployeeOption = {
  employee_id: number
  full_name: string
}

function IssueCashAdvanceModal({
  employeeId: presetEmployeeId,
  inline = false,
  onClose,
  onIssued,
}: {
  // Opened from an employee (Employees page): start with them picked.
  employeeId?: number
  inline?: boolean
  onClose?: () => void
  onIssued: () => void
}) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [employeeId, setEmployeeId] = useState(presetEmployeeId ? String(presetEmployeeId) : '')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadEmployees()
  }, [])

  async function loadEmployees() {
    setLoadingOptions(true)

    const { data, error: loadError } = await supabase
      .from('employees')
      .select('employee_id, full_name')
      .order('full_name', { ascending: true })

    if (loadError) {
      setError(loadError.message)
      setLoadingOptions(false)
      return
    }

    setEmployees(data)
    // Keep an employee picked in advance; otherwise start on the first one.
    if (data.length > 0) {
      setEmployeeId((current) => current || String(data[0].employee_id))
    }
    setLoadingOptions(false)
  }

  async function handleSubmit() {
    // Same amount rules as the payment forms (lib/amountInput.ts):
    // digits + 2 decimals, greater than zero.
    const parsed = parseAmount(amount)

    if (!employeeId) {
      setError('Select an employee.')
      return
    }
    if (parsed.value === null) {
      setError(parsed.error ?? 'Enter a valid amount.')
      return
    }
    const amountValue = parsed.value

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('cash_advances').insert({
      employee_id: Number(employeeId),
      amount: amountValue,
      note: note.trim() || null,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    if (inline) {
      setAmount('')
      setNote('')
    }
    onIssued()
  }

  const field = 'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 py-2 text-[15px] font-medium text-ink-metric focus:border-primary'
  const label = 'flex flex-col gap-1.5 text-sm font-medium text-ink-secondary'
  const form = (
    <>
      {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {loadingOptions ? (
        <p className="text-ink-muted">Loading...</p>
      ) : (
        <div className="grid gap-4">
          <label className={label}>
            Employee
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={field}>
              {employees.map((employee) => (
                <option key={employee.employee_id} value={employee.employee_id}>
                  {employee.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Amount (₱)
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(filterAmountInput(e.target.value))}
              placeholder="0.00"
              className={`${field} tabular-nums placeholder:font-normal placeholder:text-ink-muted`}
            />
          </label>
          <label className={label}>
            Reason / note (optional)
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={field} />
          </label>
          <p className="text-[13px] leading-[18px] text-ink-muted">
            Paid back automatically: each payslip deducts a share of gross pay until the advance is settled.
          </p>
        </div>
      )}
    </>
  )

  if (inline) {
    return (
      <aside aria-labelledby="issue-title" className="card flex flex-col">
        <div className="border-b border-line px-5 py-4">
          <h2 id="issue-title" className="text-lg leading-[26px] font-bold text-ink">
            Issue Cash Advance
          </h2>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">{form}</div>
        <div className="flex justify-end border-t border-line px-5 py-4">
          <button
            onClick={handleSubmit}
            disabled={submitting || loadingOptions || employees.length === 0}
            className="btn-primary w-full px-5 text-sm"
          >
            {submitting ? 'Saving...' : 'Issue Advance'}
          </button>
        </div>
      </aside>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="card flex w-full max-w-md flex-col">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h3 className="text-lg font-bold text-ink">Issue Cash Advance</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">{form}</div>
        <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button onClick={onClose} disabled={submitting} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || loadingOptions || employees.length === 0}
            className="btn-primary px-5 text-sm"
          >
            {submitting ? 'Saving...' : 'Issue Advance'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default IssueCashAdvanceModal
