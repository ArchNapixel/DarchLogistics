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
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../context/AuthContext'
import { extractEdgeFunctionErrorMessage } from '../../../lib/edgeFunctionError'
import {
  MIN_BIRTH_DATE,
  PROFILE_MAX_LENGTH,
  cleanProfileForm,
  filterInput,
  validateProfileForm,
  type EditableKey,
} from '../../../lib/myProfile'
import { phoneInput } from '../../../lib/quoteRequest'
import { toManilaDate } from '../../../lib/payslip'
import { formatMoney } from '../../../lib/format'

const fieldClasses =
  'border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
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
  is_minimum_wage_earner: boolean
  driver_license_number: string | null
  driver_license_expiry_date: string | null
  medical_exam_date: string | null
  medical_exam_expiry_date: string | null
  // Personal / contact / government info (all optional except phone_number)
  middle_name: string | null
  phone_number: string | null
  date_of_birth: string | null
  email: string | null
  address: string | null
  city: string | null
  province: string | null
  zip_code: string | null
  emergency_contact_name: string | null
  emergency_contact_number: string | null
  tin_number: string | null
  sss_number: string | null
  philhealth_number: string | null
  pagibig_number: string | null
}

function AddEmployeeModal({
  employee,
  isDeactivated,
  onClose,
  onSaved,
  onToggleStatus,
  onDelete,
}: {
  employee?: EditableEmployee
  // Only used when editing: show Deactivate/Reactivate and Delete buttons.
  isDeactivated?: boolean
  onClose: () => void
  onSaved: () => void
  onToggleStatus?: () => void
  onDelete?: () => void
}) {
  const isEditing = !!employee

  const [firstName, setFirstName] = useState(employee?.first_name ?? '')
  const [lastName, setLastName] = useState(employee?.last_name ?? '')
  const [middleName, setMiddleName] = useState(employee?.middle_name ?? '')
  const [phoneNumber, setPhoneNumber] = useState(phoneInput(employee?.phone_number ?? ''))
  const [dateOfBirth, setDateOfBirth] = useState(employee?.date_of_birth ?? '')
  const [personalEmail, setPersonalEmail] = useState(employee?.email ?? '')
  const [address, setAddress] = useState(employee?.address ?? '')
  const [city, setCity] = useState(employee?.city ?? '')
  const [province, setProvince] = useState(employee?.province ?? '')
  const [zipCode, setZipCode] = useState(employee?.zip_code ?? '')
  const [emergencyName, setEmergencyName] = useState(employee?.emergency_contact_name ?? '')
  const [emergencyNumber, setEmergencyNumber] = useState(phoneInput(employee?.emergency_contact_number ?? ''))
  const [tinNumber, setTinNumber] = useState(employee?.tin_number ?? '')
  const [sssNumber, setSssNumber] = useState(employee?.sss_number ?? '')
  const [philhealthNumber, setPhilhealthNumber] = useState(employee?.philhealth_number ?? '')
  const [pagibigNumber, setPagibigNumber] = useState(employee?.pagibig_number ?? '')
  const [position, setPosition] = useState(employee?.position ?? 'Driver')
  // Rate type isn't a choice: Drivers are Commission Per Trip (paid from
  // the Settings commission % + per-trip fee), everyone else is Weekly
  // Salary. Older employees on Daily/Monthly/Hourly get switched to
  // Weekly Salary the next time they're saved here.
  const rateType = position === 'Driver' ? 'Commission Per Trip' : 'Weekly Salary'
  // Only carry over an amount that's already a weekly salary -- a
  // monthly/daily figure pre-filled as "weekly" would be badly wrong.
  const [rateAmount, setRateAmount] = useState(
    employee?.rate_type === 'Weekly Salary' && employee.rate_amount != null
      ? String(employee.rate_amount)
      : '',
  )
  const legacyRate =
    employee &&
    employee.rate_type !== 'Weekly Salary' &&
    employee.rate_type !== 'Commission Per Trip' &&
    employee.rate_amount != null
      ? `${employee.rate_type} ${formatMoney(employee.rate_amount)}`
      : null
  const [hireDate, setHireDate] = useState(employee?.hire_date ?? '')
  const [isMinimumWageEarner, setIsMinimumWageEarner] = useState(employee?.is_minimum_wage_earner ?? false)
  const [licenseNumber, setLicenseNumber] = useState(employee?.driver_license_number ?? '')
  const [licenseExpiryDate, setLicenseExpiryDate] = useState(employee?.driver_license_expiry_date ?? '')
  const [medicalExamDate, setMedicalExamDate] = useState(employee?.medical_exam_date ?? '')
  const [medicalExamExpiryDate, setMedicalExamExpiryDate] = useState(employee?.medical_exam_expiry_date ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Props for one of the personal-info boxes: its length cap, and typed or
  // pasted characters it can't hold are dropped (same rules as My Profile,
  // see lib/myProfile.ts).
  const bind = (key: EditableKey, value: string, set: (v: string) => void) => ({
    value,
    maxLength: PROFILE_MAX_LENGTH[key],
    inputMode: key === 'phone_number' || key === 'emergency_contact_number' ? ('tel' as const) : undefined,
    onChange: (e: { target: { value: string } }) => set(filterInput(key, e.target.value)),
  })

  // Login account (editing only). `account` is the existing users row, if
  // any; blank password on an existing account means "keep the old one".
  const { session } = useAuth()
  const [account, setAccount] = useState<{ email: string; username: string } | null>(null)
  const [accountLoaded, setAccountLoaded] = useState(!employee)
  const [accountEmail, setAccountEmail] = useState('')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')

  useEffect(() => {
    if (!employee) return
    supabase
      .from('users')
      .select('email, username')
      .eq('employee_id', employee.employee_id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setAccount({ email: data.email, username: data.username })
          setAccountEmail(data.email)
          setAccountUsername(data.username)
        }
        setAccountLoaded(true)
      })
  }, [employee])

  const selectedRateType = RATE_TYPES.find((r) => r.value === rateType)!

  async function handleSubmit() {
    if (!firstName.trim() || !lastName.trim()) {
      setError('Enter both a first and last name.')
      return
    }
    // Phone required + format/length of every personal-info box (same
    // checks as My Profile); the cleaned values are what gets saved.
    const personal = cleanProfileForm({
      phone_number: phoneNumber,
      date_of_birth: dateOfBirth,
      email: personalEmail,
      address,
      city,
      province,
      zip_code: zipCode,
      emergency_contact_name: emergencyName,
      emergency_contact_number: emergencyNumber,
      tin_number: tinNumber,
      sss_number: sssNumber,
      philhealth_number: philhealthNumber,
      pagibig_number: pagibigNumber,
    })
    const personalProblem = validateProfileForm(personal, toManilaDate(new Date()))
    if (personalProblem) {
      setError(personalProblem)
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

    if (rateType === 'Weekly Salary' && !(Number(rateAmount) > 0)) {
      setError('Enter the weekly salary.')
      return
    }

    // Work out the account change before touching anything, so a bad
    // account field doesn't leave the employee half-saved.
    let accountCall: { fn: string; body: Record<string, unknown> } | null = null
    if (isEditing && accountLoaded) {
      const email = accountEmail.trim()
      const username = accountUsername.trim()
      if (!account) {
        if (email || username || accountPassword) {
          if (!email || !username || accountPassword.length < 6) {
            setError('To create an account, enter an email, username and a password of at least 6 characters.')
            return
          }
          accountCall = {
            fn: 'create-user-account',
            body: { email, username, password: accountPassword, user_role: position, employee_id: employee.employee_id },
          }
        }
      } else {
        if (!email || !username) {
          setError("Email and username can't be empty.")
          return
        }
        if (accountPassword && accountPassword.length < 6) {
          setError('Password must be at least 6 characters.')
          return
        }
        const body: Record<string, unknown> = { employee_id: employee.employee_id }
        if (email !== account.email) body.email = email
        if (username !== account.username) body.username = username
        if (accountPassword) body.password = accountPassword
        if (Object.keys(body).length > 1) accountCall = { fn: 'update-user-account', body }
      }
    }

    setSubmitting(true)
    setError(null)

    const values = {
      first_name: firstName.trim(),
      middle_name: middleName.trim() || null,
      last_name: lastName.trim(),
      // "First Middle Last" -- the middle name is left out when blank.
      full_name: [firstName, middleName, lastName].map((n) => n.trim()).filter(Boolean).join(' '),
      phone_number: personal.phone_number,
      date_of_birth: personal.date_of_birth || null,
      email: personal.email || null,
      address: personal.address || null,
      city: personal.city || null,
      province: personal.province || null,
      zip_code: personal.zip_code || null,
      emergency_contact_name: personal.emergency_contact_name || null,
      emergency_contact_number: personal.emergency_contact_number || null,
      tin_number: personal.tin_number || null,
      sss_number: personal.sss_number || null,
      philhealth_number: personal.philhealth_number || null,
      pagibig_number: personal.pagibig_number || null,
      position,
      rate_type: rateType,
      // Legacy columns from the old Flat Fee / Percentage choice --
      // always cleared now, payroll no longer reads them.
      commission_basis: null,
      commission_per_trip: null,
      hire_date: hireDate,
      is_minimum_wage_earner: isMinimumWageEarner,
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

    if (saveError) {
      setSubmitting(false)
      setError(saveError.message)
      return
    }

    if (accountCall) {
      const { data, error: invokeError } = await supabase.functions.invoke(accountCall.fn, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: accountCall.body,
      })
      if (invokeError || data?.error) {
        setSubmitting(false)
        setError(
          `Employee saved, but the account change failed: ` +
            (data?.error ?? (await extractEdgeFunctionErrorMessage(invokeError, 'Could not update account.'))),
        )
        return
      }
    }

    setSubmitting(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-xl bg-white p-6 shadow-lg">
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
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* First, middle (optional), last -- full_name is built from these. */}
          <div className="grid items-end gap-4 sm:col-span-2 sm:grid-cols-3">
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
              Middle name (optional)
              <input
                type="text"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
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
          </div>

          <label className={labelClasses}>
            Phone number
            <input
              type="tel"
              {...bind('phone_number', phoneNumber, setPhoneNumber)}
              className={fieldClasses}
            />
          </label>

          {/* Position is picked once, when adding -- it can't be switched
              afterwards (it also decides the rate type). */}
          {isEditing ? (
            <div className={labelClasses}>
              Position
              <p className="border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
                {position}
              </p>
            </div>
          ) : (
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
          )}

          <label className={labelClasses}>
            Hire date
            <input
              type="date"
              value={hireDate}
              onChange={(e) => setHireDate(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <div className={labelClasses}>
            Rate type
            <p className="border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
              {rateType}
            </p>
          </div>

          {/* Commission Per Trip (Drivers) has no amount to enter -- pay comes from Settings. */}
          {rateType !== 'Commission Per Trip' && (
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
              {legacyRate && (
                <span className="text-xs font-normal text-amber-700">
                  Was {legacyRate} -- enter the weekly amount.
                </span>
              )}
            </label>
          )}

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={isMinimumWageEarner}
              onChange={(e) => setIsMinimumWageEarner(e.target.checked)}
              className="h-4 w-4 border-slate-300"
            />
            Minimum wage earner (exempt from withholding tax)
          </label>

          {/* Everything below is optional. Government IDs are safe to show
              here: only Admin can reach the Employees page. */}
          <details className="border border-slate-200 p-3 sm:col-span-2" open={isEditing}>
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">
              More details (optional)
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className={labelClasses}>
                Date of birth
                <input type="date" min={MIN_BIRTH_DATE} max={toManilaDate(new Date())} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Personal email
                <input type="email" {...bind('email', personalEmail, setPersonalEmail)} className={fieldClasses} />
              </label>
              <label className={`${labelClasses} sm:col-span-2`}>
                Address
                <input type="text" {...bind('address', address, setAddress)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                City
                <input type="text" {...bind('city', city, setCity)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Province
                <input type="text" {...bind('province', province, setProvince)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Zip code
                <input type="text" {...bind('zip_code', zipCode, setZipCode)} className={fieldClasses} />
              </label>
              <span className="hidden sm:block" />
              <label className={labelClasses}>
                Emergency contact name
                <input type="text" {...bind('emergency_contact_name', emergencyName, setEmergencyName)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Emergency contact number
                <input type="tel" {...bind('emergency_contact_number', emergencyNumber, setEmergencyNumber)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                TIN
                <input type="text" {...bind('tin_number', tinNumber, setTinNumber)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                SSS number
                <input type="text" {...bind('sss_number', sssNumber, setSssNumber)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                PhilHealth number
                <input type="text" {...bind('philhealth_number', philhealthNumber, setPhilhealthNumber)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Pag-IBIG number
                <input type="text" {...bind('pagibig_number', pagibigNumber, setPagibigNumber)} className={fieldClasses} />
              </label>
            </div>
          </details>

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

          {isEditing && accountLoaded && (
            <div className="grid gap-4 border-t border-slate-200 pt-4 sm:col-span-2">
              <p className="text-sm font-semibold text-slate-900">
                {account ? 'Login account' : 'Login account (none yet -- fill in to create one)'}
              </p>
              <label className={labelClasses}>
                Email
                <input type="email" value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                Username
                <input type="text" value={accountUsername} onChange={(e) => setAccountUsername(e.target.value)} className={fieldClasses} />
              </label>
              <label className={labelClasses}>
                {account ? 'New password' : 'Password'}
                <input
                  type="text"
                  value={accountPassword}
                  onChange={(e) => setAccountPassword(e.target.value)}
                  placeholder={account ? 'Leave blank to keep the current one' : 'At least 6 characters'}
                  className={fieldClasses}
                />
              </label>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-4">
          {isEditing && onToggleStatus && onDelete && (
            <div className="mr-auto flex gap-3">
              <button
                onClick={onToggleStatus}
                className={`text-sm font-medium ${
                  isDeactivated
                    ? 'text-green-600 hover:text-green-800'
                    : 'text-orange-600 hover:text-orange-800'
                }`}
              >
                {isDeactivated ? 'Reactivate' : 'Deactivate'}
              </button>
              <button
                onClick={onDelete}
                className="text-sm font-medium text-red-600 hover:text-red-800"
              >
                Delete
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary px-4 py-2 text-sm font-medium"
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
