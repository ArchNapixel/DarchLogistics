// AddEmployeeModal: form for adding OR editing an employee in the real
// `employees` table. Pass an `employee` prop to edit that row (fields
// pre-filled, submit does an UPDATE); omit it to add a new one (submit
// does an INSERT). rate_type determines which single rate column
// actually gets filled in (daily_rate / weekly_salary /
// monthly_salary / hourly_rate) -- the others stay null, and all four
// stay null for Commission Per Trip (paid from Settings instead).
//
// Driver license fields are only shown (and only
// required) when editing an existing Driver, via the "Edit Information"
// button in EmployeesSection.tsx -- adding a new employee skips them
// entirely, so they're just null until someone fills them in later.
//
// Every Driver has an assigned truck (employees.assigned_plate_number,
// unique -- one driver per truck), required on add and edit. It may be in
// the shop; the Dispatch Board then uses a spare truck for him.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../context/AuthContext'
import { extractEdgeFunctionErrorMessage } from '../../../lib/edgeFunctionError'
import {
  MIN_BIRTH_DATE,
  PROFILE_MAX_LENGTH,
  cleanProfileForm,
  filterInput,
  filterPersonName,
  hasLetter,
  inputModeFor,
  validateProfileForm,
  type EditableKey,
} from '../../../lib/myProfile'
import { phoneInput } from '../../../lib/quoteRequest'
import { toManilaDate } from '../../../lib/payslip'
import { formatMoney } from '../../../lib/format'

// Hire date range, mirrored from the DB trigger employees_hire_date_range
// (1990-01-01 .. Manila today + 30 days) -- change both together.
const MIN_HIRE_DATE = '1990-01-01'
const maxHireDate = () => toManilaDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
import { RATE_TYPES } from '../../../lib/employeeRateTypes'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus:border-primary'
const readOnlyClasses =
  'flex min-h-11 items-center rounded-[2px] border border-line bg-slate-50 px-3 text-sm text-ink-secondary'

// One labelled box: "Label *" (required) or "Label (optional)", the input,
// then an optional hint line.
function Field({
  label,
  required,
  optional,
  hint,
  className = '',
  children,
}: {
  label: string
  required?: boolean
  optional?: boolean
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-red-600"> *</span>}
        {optional && <span className="font-normal text-ink-muted"> (optional)</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  )
}

// "① Personal information" style section heading.
function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <h4 className="flex items-center gap-2.5 text-base font-semibold text-ink">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
        {n}
      </span>
      {title}
    </h4>
  )
}

// Small caps heading inside "More details".
function SubHead({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase sm:col-span-full">{children}</p>
}

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
  // Drivers: his own truck (truck_profiles.plate_number).
  assigned_plate_number: string | null
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
  const [truckPlate, setTruckPlate] = useState(employee?.assigned_plate_number ?? '')
  // Trucks a driver can be given: the ones no other driver has (plus his own).
  const [truckOptions, setTruckOptions] = useState<{ plate_number: string; current_status: string | null }[]>([])
  const [licenseNumber, setLicenseNumber] = useState(employee?.driver_license_number ?? '')
  const [licenseExpiryDate, setLicenseExpiryDate] = useState(employee?.driver_license_expiry_date ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "More details" starts closed when adding; when editing it starts open if
  // anything in it is already filled in.
  const [showMore, setShowMore] = useState(
    !!employee &&
      [
        employee.date_of_birth, employee.email, employee.address, employee.city, employee.province,
        employee.zip_code, employee.emergency_contact_name, employee.emergency_contact_number,
        employee.tin_number, employee.sss_number, employee.philhealth_number, employee.pagibig_number,
      ].some(Boolean),
  )

  // Esc = Cancel (the footer says so).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Props for one of the personal-info boxes: its length cap, and typed or
  // pasted characters it can't hold are dropped (same rules as My Profile,
  // see lib/myProfile.ts).
  const bind = (key: EditableKey, value: string, set: (v: string) => void) => ({
    value,
    maxLength: PROFILE_MAX_LENGTH[key],
    inputMode: inputModeFor(key),
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
    let cancelled = false
    Promise.all([
      supabase.from('truck_profiles').select('plate_number, current_status').eq('is_active', true).order('plate_number'),
      supabase.from('employees').select('employee_id, assigned_plate_number').not('assigned_plate_number', 'is', null),
    ]).then(([trucksResult, takenResult]) => {
      if (cancelled) return
      const taken = new Set(
        (takenResult.data ?? []).filter((e) => e.employee_id !== employee?.employee_id).map((e) => e.assigned_plate_number as string),
      )
      setTruckOptions((trucksResult.data ?? []).filter((t) => !taken.has(t.plate_number)))
    })
    return () => {
      cancelled = true
    }
  }, [employee])

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
    // The boxes already drop digits and symbols as you type; this catches a
    // name made only of marks (". -") or an old record saved before the filter.
    const nameParts = [firstName, middleName, lastName].map((n) => n.trim()).filter(Boolean)
    if (nameParts.some((n) => !hasLetter(n) || n !== filterPersonName(n))) {
      setError("Names can only have letters, spaces and . ' - (no numbers or other symbols).")
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
      // Most of these boxes live in "More details" -- open it so the bad one shows.
      setShowMore(true)
      return
    }
    if (!hireDate) {
      setError('Enter a hire date.')
      return
    }
    // Same range as the database trigger employees_hire_date_range (the
    // picker's min/max don't stop a typed date -- the form is noValidate so
    // our own messages show instead of the browser's).
    if (hireDate < MIN_HIRE_DATE || hireDate > maxHireDate()) {
      setError('Hire date must be between 1990 and 30 days from today.')
      return
    }
    if (position === 'Driver' && !truckPlate) {
      setError("Pick the driver's assigned truck.")
      return
    }
    // License fields aren't collected when first adding an
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
      assigned_plate_number: position === 'Driver' ? truckPlate : null,
      driver_license_number: position === 'Driver' ? licenseNumber.trim() || null : null,
      driver_license_expiry_date: position === 'Driver' ? licenseExpiryDate || null : null,
    }

    const { error: saveError } = isEditing
      ? await supabase
          .from('employees')
          .update(values)
          .eq('employee_id', employee.employee_id)
      : await supabase.from('employees').insert(values)

    if (saveError) {
      setSubmitting(false)
      // employees_assigned_plate_number_key: someone else took that truck meanwhile.
      setError(saveError.message.includes('assigned_plate_number') ? 'That truck already has a driver. Pick another one.' : saveError.message)
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-form-title"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
        className="flex max-h-[94vh] w-full max-w-3xl flex-col border-2 border-line-card bg-white"
      >
        {/* Header (stays put while the body scrolls) */}
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h3 id="employee-form-title" className="text-xl font-bold text-ink">
              {isEditing ? 'Edit employee' : 'Add employee'}
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              Fields marked <span className="text-red-600">*</span> are required. Everything else can be added later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center text-ink-muted hover:bg-slate-100 hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* 1. Personal information */}
          <section>
            <SectionTitle n={1} title="Personal information" />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="First name" required>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(filterPersonName(e.target.value))}
                  maxLength={50}
                  autoComplete="off"
                  placeholder="Juan"
                  className={fieldClasses}
                />
              </Field>
              <Field label="Middle name" optional>
                <input
                  type="text"
                  value={middleName}
                  onChange={(e) => setMiddleName(filterPersonName(e.target.value))}
                  maxLength={50}
                  autoComplete="off"
                  className={fieldClasses}
                />
              </Field>
              <Field label="Last name" required>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(filterPersonName(e.target.value))}
                  maxLength={50}
                  autoComplete="off"
                  placeholder="Dela Cruz"
                  className={fieldClasses}
                />
              </Field>
              <Field label="Mobile number" required>
                <input
                  type="tel"
                  {...bind('phone_number', phoneNumber, setPhoneNumber)}
                  placeholder="0917 123 4567"
                  className={`${fieldClasses} tabular-nums`}
                />
              </Field>
            </div>
          </section>

          {/* 2. Employment */}
          <section className="mt-6 border-t border-line pt-6">
            <SectionTitle n={2} title="Employment" />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {/* Position is picked once, when adding -- it can't be switched
                  afterwards (it also decides how they're paid). */}
              <Field
                label="Position"
                required={!isEditing}
                hint={
                  <>
                    Pay:{' '}
                    <strong className="font-semibold text-ink-secondary">
                      {rateType === 'Commission Per Trip' ? 'Commission per trip' : 'Weekly salary'}
                    </strong>{' '}
                    · set by position
                  </>
                }
              >
                {isEditing ? (
                  <span className={readOnlyClasses}>{position}</span>
                ) : (
                  <select value={position} onChange={(e) => setPosition(e.target.value)} className={fieldClasses}>
                    <option value="Driver">Driver</option>
                    <option value="Mechanic">Mechanic</option>
                    <option value="Helper">Helper</option>
                    <option value="Dispatcher">Dispatcher</option>
                    <option value="Admin">Admin</option>
                  </select>
                )}
              </Field>

              <Field label="Hire date" required>
                <input
                  type="date"
                  value={hireDate}
                  min={MIN_HIRE_DATE}
                  max={maxHireDate()}
                  onChange={(e) => setHireDate(e.target.value)}
                  className={fieldClasses}
                />
              </Field>

              {/* Every Driver needs his own truck (see the top of this file). */}
              {position === 'Driver' && (
                <Field label="Assigned truck" required>
                  <select value={truckPlate} onChange={(e) => setTruckPlate(e.target.value)} className={fieldClasses}>
                    <option value="">Pick a truck</option>
                    {truckOptions.map((t) => (
                      <option key={t.plate_number} value={t.plate_number}>
                        {t.plate_number}
                        {t.current_status === 'Under Maintenance' || t.current_status === 'Out of Service' ? ` (${t.current_status})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Commission Per Trip (Drivers) has no amount to enter -- pay comes from Settings. */}
              {rateType !== 'Commission Per Trip' && (
                <Field
                  label={selectedRateType.label}
                  required
                  hint={legacyRate && <span className="text-amber-700">Was {legacyRate} -- enter the weekly amount.</span>}
                >
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rateAmount}
                    onChange={(e) => setRateAmount(e.target.value)}
                    placeholder="0.00"
                    className={`${fieldClasses} tabular-nums`}
                  />
                </Field>
              )}
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[2px] border border-line bg-slate-50 px-4 py-3.5">
              <input
                type="checkbox"
                checked={isMinimumWageEarner}
                onChange={(e) => setIsMinimumWageEarner(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">Minimum wage earner</span>
                <span className="block text-xs text-ink-muted">Exempts this employee from withholding tax on payroll.</span>
              </span>
            </label>
          </section>

          {/* Driver license -- only asked once the driver exists (Edit). */}
          {isEditing && position === 'Driver' && (
            <section className="mt-6 border-t border-line pt-6">
              <SectionTitle n={3} title="Driver license" />
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="License number" required>
                  <input type="text" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} className={fieldClasses} />
                </Field>
                <Field label="Expiry date" required>
                  <input type="date" value={licenseExpiryDate} onChange={(e) => setLicenseExpiryDate(e.target.value)} className={fieldClasses} />
                </Field>
              </div>
            </section>
          )}

          {/* More details: everything optional, folded away. Government IDs
              are safe to show here: only Admin can reach the Employees page. */}
          <div className="mt-6 rounded-[2px] border border-line">
            <button
              type="button"
              onClick={() => setShowMore(!showMore)}
              aria-expanded={showMore}
              aria-controls="employee-more-details"
              className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-slate-50"
            >
              <span>
                <span className="flex items-center gap-2 text-base font-semibold text-ink">
                  More details
                  <span className="rounded-[2px] bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                    Optional
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">Birthday, address, emergency contact, government IDs</span>
              </span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`shrink-0 text-ink-muted transition-transform ${showMore ? 'rotate-180' : ''}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {showMore && (
              <div id="employee-more-details" className="grid gap-4 border-t border-line bg-slate-50/60 px-4 pt-4 pb-5 sm:grid-cols-6">
                <SubHead>Personal</SubHead>
                <Field label="Date of birth" className="sm:col-span-3">
                  <input
                    type="date"
                    min={MIN_BIRTH_DATE}
                    max={toManilaDate(new Date())}
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className={fieldClasses}
                  />
                </Field>
                <Field label="Personal email" className="sm:col-span-3">
                  <input type="email" {...bind('email', personalEmail, setPersonalEmail)} placeholder="name@email.com" className={fieldClasses} />
                </Field>

                <SubHead>Address</SubHead>
                <Field label="Street address" className="sm:col-span-2">
                  <input type="text" {...bind('address', address, setAddress)} placeholder="House no., street, barangay" className={fieldClasses} />
                </Field>
                <Field label="City / Municipality" className="sm:col-span-2">
                  <input type="text" {...bind('city', city, setCity)} className={fieldClasses} />
                </Field>
                <Field label="Province" className="sm:col-span-2">
                  <input type="text" {...bind('province', province, setProvince)} className={fieldClasses} />
                </Field>
                <Field label="ZIP code" className="sm:col-span-2">
                  <input type="text" {...bind('zip_code', zipCode, setZipCode)} placeholder="0000" className={`${fieldClasses} tabular-nums`} />
                </Field>

                <SubHead>Emergency contact</SubHead>
                <Field label="Contact name" className="sm:col-span-3">
                  <input type="text" {...bind('emergency_contact_name', emergencyName, setEmergencyName)} placeholder="Full name" className={fieldClasses} />
                </Field>
                <Field label="Contact number" className="sm:col-span-3">
                  <input
                    type="tel"
                    {...bind('emergency_contact_number', emergencyNumber, setEmergencyNumber)}
                    placeholder="0917 123 4567"
                    className={`${fieldClasses} tabular-nums`}
                  />
                </Field>

                <SubHead>Government IDs</SubHead>
                <Field label="TIN" className="sm:col-span-2">
                  <input type="text" {...bind('tin_number', tinNumber, setTinNumber)} placeholder="000-000-000-000" className={`${fieldClasses} tabular-nums`} />
                </Field>
                <Field label="SSS number" className="sm:col-span-2">
                  <input type="text" {...bind('sss_number', sssNumber, setSssNumber)} placeholder="00-0000000-0" className={`${fieldClasses} tabular-nums`} />
                </Field>
                <Field label="PhilHealth number" className="sm:col-span-2">
                  <input
                    type="text"
                    {...bind('philhealth_number', philhealthNumber, setPhilhealthNumber)}
                    placeholder="00-000000000-0"
                    className={`${fieldClasses} tabular-nums`}
                  />
                </Field>
                <Field label="Pag-IBIG number" className="sm:col-span-2">
                  <input type="text" {...bind('pagibig_number', pagibigNumber, setPagibigNumber)} placeholder="0000-0000-0000" className={`${fieldClasses} tabular-nums`} />
                </Field>
              </div>
            )}
          </div>

          {/* Login account (Edit only). */}
          {isEditing && accountLoaded && (
            <section className="mt-6 border-t border-line pt-6">
              <h4 className="text-base font-semibold text-ink">Login account</h4>
              <p className="mt-0.5 text-xs text-ink-muted">
                {account ? 'Leave the password blank to keep the current one.' : 'None yet -- fill in all three to create one.'}
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <Field label="Email">
                  <input type="email" value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} autoComplete="off" className={fieldClasses} />
                </Field>
                <Field label="Username">
                  <input type="text" value={accountUsername} onChange={(e) => setAccountUsername(e.target.value)} autoComplete="off" className={fieldClasses} />
                </Field>
                <Field label={account ? 'New password' : 'Password'}>
                  <input
                    type="text"
                    value={accountPassword}
                    onChange={(e) => setAccountPassword(e.target.value)}
                    autoComplete="off"
                    placeholder="At least 6 characters"
                    className={fieldClasses}
                  />
                </Field>
              </div>
            </section>
          )}
        </div>

        {/* Footer (stays put). The error sits here so it's always in view. */}
        <footer className="shrink-0 border-t border-line bg-slate-50 px-6 py-4">
          {error && (
            <p role="alert" className="mb-3 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="hidden text-xs text-ink-muted sm:block">
              Press{' '}
              <kbd className="rounded-[2px] border border-line bg-white px-1.5 py-0.5 font-sans text-[11px] text-ink-secondary">Esc</kbd>{' '}
              to cancel
            </p>
            <div className="ml-auto flex gap-3">
              <button type="button" onClick={onClose} className="btn-secondary px-5 text-sm font-semibold">
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary px-5 text-sm font-semibold">
                {submitting ? (isEditing ? 'Saving...' : 'Adding...') : isEditing ? 'Save changes' : 'Add employee'}
              </button>
            </div>
          </div>
        </footer>
      </form>
    </div>
  )
}

export default AddEmployeeModal
