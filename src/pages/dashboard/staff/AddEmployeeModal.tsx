// AddEmployeeModal: form for adding an employee, inserting into the
// real `employees` table. rate_type determines which single rate
// column actually gets filled in (daily_rate / commission_per_trip /
// monthly_salary / hourly_rate) -- the other three stay null.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

const RATE_TYPES = [
  { value: 'Daily Fixed', label: 'Daily rate', column: 'daily_rate' },
  { value: 'Commission Per Trip', label: 'Commission per trip', column: 'commission_per_trip' },
  { value: 'Monthly Salary', label: 'Monthly salary', column: 'monthly_salary' },
  { value: 'Hourly', label: 'Hourly rate', column: 'hourly_rate' },
] as const

function AddEmployeeModal({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [position, setPosition] = useState('Driver')
  const [rateType, setRateType] = useState<(typeof RATE_TYPES)[number]['value']>(
    'Daily Fixed',
  )
  const [rateAmount, setRateAmount] = useState('')
  const [hireDate, setHireDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedRateType = RATE_TYPES.find((r) => r.value === rateType)!

  async function handleSubmit() {
    if (!firstName.trim() || !lastName.trim()) {
      setError('Enter both a first and last name.')
      return
    }
    if (!hireDate) {
      setError('Enter a hire date.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('employees').insert({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      full_name: `${firstName.trim()} ${lastName.trim()}`,
      position,
      rate_type: rateType,
      hire_date: hireDate,
      [selectedRateType.column]: rateAmount ? Number(rateAmount) : null,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onAdded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Add Employee</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClasses}>
            First name
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Last name
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Position
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className={fieldClasses}
            >
              <option value="Driver">Driver</option>
              <option value="Mechanic">Mechanic</option>
              <option value="Dispatcher">Dispatcher</option>
              <option value="Admin">Admin</option>
            </select>
          </label>

          <label className={labelClasses}>
            Hire date
            <input
              type="date"
              value={hireDate}
              onChange={(e) => setHireDate(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Rate type
            <select
              value={rateType}
              onChange={(e) =>
                setRateType(e.target.value as (typeof RATE_TYPES)[number]['value'])
              }
              className={fieldClasses}
            >
              {RATE_TYPES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClasses}>
            {selectedRateType.label}
            <input
              type="number"
              min="0"
              step="0.01"
              value={rateAmount}
              onChange={(e) => setRateAmount(e.target.value)}
              className={fieldClasses}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Adding...' : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddEmployeeModal
