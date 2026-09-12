// IssueCashAdvanceModal: records a cash advance given to an employee.
// This never auto-deducts anything -- it's just the log of what was
// issued. Deducting it happens later, optionally and by however much
// admin chooses, when issuing that employee's payslip (see
// IssuePayslipModal.tsx / src/lib/payslip.ts).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

type EmployeeOption = {
  employee_id: number
  full_name: string
}

function IssueCashAdvanceModal({
  onClose,
  onIssued,
}: {
  onClose: () => void
  onIssued: () => void
}) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [employeeId, setEmployeeId] = useState('')
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
    if (data.length > 0) {
      setEmployeeId(String(data[0].employee_id))
    }
    setLoadingOptions(false)
  }

  async function handleSubmit() {
    const amountValue = Number(amount)

    if (!employeeId) {
      setError('Select an employee.')
      return
    }
    if (!amount || Number.isNaN(amountValue) || amountValue <= 0) {
      setError('Enter a valid amount.')
      return
    }

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

    onIssued()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Issue Cash Advance</h3>
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
        ) : (
          <div className="mt-4 grid gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Employee
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
              >
                {employees.map((employee) => (
                  <option key={employee.employee_id} value={employee.employee_id}>
                    {employee.full_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Note (optional)
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
              />
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || loadingOptions || employees.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Issue Advance'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default IssueCashAdvanceModal
