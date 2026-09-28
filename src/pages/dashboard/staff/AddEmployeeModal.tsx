// AddEmployeeModal: form for adding OR editing an employee in the real
// `employees` table. Pass an `employee` prop to edit that row (fields
// pre-filled, submit does an UPDATE); omit it to add a new one (submit
// does an INSERT). rate_type determines which single rate column
// actually gets filled in (daily_rate / weekly_salary /
// monthly_salary / hourly_rate) -- the others stay null, and all four
// stay null for Commission Per Trip (paid from Settings instead).
//
// Driver license / medical exam fields are only shown (and only
// required) when editing an existing Driver, via the "Edit Information"
// button in EmployeesSection.tsx -- adding a new employee skips them
// entirely, so they're just null until someone fills them in later.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

// Commission Per Trip has no column of its own -- a Driver's per-trip
// pay comes entirely from the company-wide Settings (commission % +
// per-trip fee), so there's no per-employee amount to store.
export const RATE_TYPES = [
  { value: 'Daily Fixed', label: 'Daily rate', column: 'daily_rate' },
  { value: 'Weekly Salary', label: 'Weekly salary', column: 'weekly_salary' },
  { value: 'Commission Per Trip', label: 'Commission per trip', column: null },
  { value: 'Monthly Salary', label: 'Monthly salary', column: 'monthly_salary' },
  { value: 'Hourly', label: 'Hourly rate', column: 'hourly_rate' },
] as const

export type EditableEmployee = {
  employee_id: number
  first_name: string
  last_name: string
  position: string
  rate_type: (typeof RATE_TYPES)[number]['value']
  rate_amount: number | null
  hire_date: string
  driver_license_number: string | null
  driver_license_expiry_date: string | null
  medical_exam_date: string | null
  medical_exam_expiry_date: string | null
}

function AddEmployeeModal({
  employee,
  onClose,
  onSaved,
}: {
  employee?: EditableEmployee
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = !!employee

  const [firstName, setFirstName] = useState(employee?.first_name ?? '')
  const [lastName, setLastName] = useState(employee?.last_name ?? '')
  const [position, setPosition] = useState(employee?.position ?? 'Driver')
  const [rateType, setRateType] = useState<(typeof RATE_TYPES)[number]['value']>(
    employee?.rate_type ?? 'Daily Fixed',
  )
  const [rateAmount, setRateAmount] = useState(
    employee?.rate_amount != null ? String(employee.rate_amount) : '',
  )
  const [hireDate, setHireDate] = useState(employee?.hire_date ?? '')
  const [licenseNumber, setLicenseNumber] = useState(employee?.driver_license_number ?? '')
  const [licenseExpiryDate, setLicenseExpiryDate] = useState(employee?.driver_license_expiry_date ?? '')
  const [medicalExamDate, setMedicalExamDate] = useState(employee?.medical_exam_date ?? '')
  const [medicalExamExpiryDate, setMedicalExamExpiryDate] = useState(employee?.medical_exam_expiry_date ?? '')
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
    // License/medical exam fields aren't collected when first adding an
    // employee -- only required once editing an existing Driver, from
    // the "Edit Information" button.
    if (isEditing && position === 'Driver' && (!licenseNumber.trim() || !licenseExpiryDate)) {
      setError('Enter the driver license number and expiry date.')
      return
    }

    if (rateType === 'Commission Per Trip' && position !== 'Driver') {
      setError('Commission per trip is for Drivers only -- pick a salary rate type.')
      return
    }

    setSubmitting(true)
    setError(null)

    const values = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      full_name: `${firstName.trim()} ${lastName.trim()}`,
      position,
      rate_type: rateType,
      // Legacy columns from the old Flat Fee / Percentage choice --
      // always cleared now, payroll no longer reads them.
      commission_basis: null,
      commission_per_trip: null,
      hire_date: hireDate,
      daily_rate: null,
      weekly_salary: null,
      monthly_salary: null,
      hourly_rate: null,
      ...(selectedRateType.column
        ? { [selectedRateType.column]: rateAmount ? Number(rateAmount) : null }
        : {}),
      driver_license_number: position === 'Driver' ? licenseNumber.trim() || null : null,
      driver_license_expiry_date: position === 'Driver' ? licenseExpiryDate || null : null,
      medical_exam_date: position === 'Driver' ? medicalExamDate || null : null,
      medical_exam_expiry_date: position === 'Driver' ? medicalExamExpiryDate || null : null,
    }

    const { error: saveError } = isEditing
      ? await supabase
          .from('employees')
          .update(values)
          .eq('employee_id', employee.employee_id)
      : await supabase.from('employees').insert(values)

    setSubmitting(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            {isEditing ? 'Edit Employee' : 'Add Employee'}
          </h3>
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
              <option value="Helper">Helper</option>
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
              {RATE_TYPES.filter(
                (r) => r.value !== 'Commission Per Trip' || position === 'Driver',
              ).map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value}
                </option>
              ))}
            </select>
          </label>

          {rateType === 'Commission Per Trip' ? (
            <p className="flex flex-col justify-end text-sm text-slate-500">
              Uses the company-wide commission % and per-trip fee set on the
              Settings page -- no per-employee amount needed.
            </p>
          ) : (
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
          )}

          {isEditing && position === 'Driver' && (
            <>
              <label className={labelClasses}>
                Driver license number
                <input type="text" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Driver license expiry
                <input type="date" value={licenseExpiryDate} onChange={(e) => setLicenseExpiryDate(e.target.value)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Medical exam date (optional)
                <input type="date" value={medicalExamDate} onChange={(e) => setMedicalExamDate(e.target.value)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Medical exam expiry (optional)
                <input type="date" value={medicalExamExpiryDate} onChange={(e) => setMedicalExamExpiryDate(e.target.value)} className={fieldClasses} />
              </label>
            </>
          )}
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
            {submitting
              ? isEditing
                ? 'Saving...'
                : 'Adding...'
              : isEditing
                ? 'Save Changes'
                : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddEmployeeModal
