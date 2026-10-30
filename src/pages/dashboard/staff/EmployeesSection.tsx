// EmployeesSection: lists employees in a table, with an "Add Employee"
// button that opens a form. The list reads real data from `employees`;
// employment_status_id has no foreign key at the database level, so the
// status name is looked up separately and merged in here (same pattern
// as place-name lookups in DriverTasks.tsx / MyBookingsSection.tsx).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import AddEmployeeModal, { type EditableEmployee } from './AddEmployeeModal'
import { RATE_TYPES } from '../../../lib/employeeRateTypes'
import SetUpStaffAccountModal from './SetUpStaffAccountModal'
import EmployeeDetailModal from './EmployeeDetailModal'
import IssueCashAdvanceModal from './IssueCashAdvanceModal'
import { showToast } from '../../../components/Toast'
import { toManilaDate } from '../../../lib/payslip'
import { MEDICAL_EXAMS, NO_NEW_EXAM_VALUES, examValuesOf, isMissingExamColumns } from '../../../lib/medicalExams'
import { confirmDialog } from '../../../components/ConfirmDialog'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate, formatMoney, formatSlot } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

// Only these positions have trips/work orders to show a detail view
// for -- Admin/Dispatcher don't.
const DETAIL_VIEW_POSITIONS = new Set(['Driver', 'Mechanic', 'Helper'])

type Employee = {
  employee_id: number
  name: string
  position: string
  status: string
  hire_date: string
  editable: EditableEmployee
  licenseExpiryDate: string | null
  medicalExamExpiryDate: string | null
}

function extractRateAmount(row: Record<string, unknown>, rateType: string) {
  const rateInfo = RATE_TYPES.find((r) => r.value === rateType)
  if (!rateInfo?.column) return null
  const value = row[rateInfo.column]
  return typeof value === 'number' ? value : null
}

// Filter row: "Position [▾]  Status [▾]  Search [   ]" (redesign canvas).
const FILTER_LABEL = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
const FILTER_CONTROL =
  'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'

const TABS = ['Active', 'Deactivated'] as const
type Tab = (typeof TABS)[number]

function expiryLabel(date: string | null) {
  if (!date) return 'Not recorded'
  const days = Math.ceil(
    (new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86400000,
  )
  if (days < 0) return `Expired: ${formatDate(date)}`
  if (days <= 30) return `Due soon: ${formatDate(date)}`
  return formatDate(date)
}

function expiryClass(date: string | null) {
  if (!date) return 'text-ink-muted'
  const days = Math.ceil(
    (new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86400000,
  )
  return days < 0
    ? 'font-medium text-red-700'
    : days <= 30
      ? 'font-medium text-orange-700'
      : 'text-ink-metric'
}

// Table spacing from the canvas board: 20px at the edges, 16px between columns.
const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'm-0 text-[15px] leading-[22px] font-medium text-ink'
const GROUP = 'mb-2.5 flex justify-between gap-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink'

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-full' : ''}>
      <dt className={LABEL}>{label}</dt>
      <dd className={VALUE}>{children ?? '—'}</dd>
    </div>
  )
}

// "Age 34" from a YYYY-MM-DD birthday.
function age(dateOfBirth: string | null) {
  if (!dateOfBirth) return null
  const born = new Date(`${dateOfBirth}T00:00:00`)
  const now = new Date()
  let years = now.getFullYear() - born.getFullYear()
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) years--
  return years
}

// Today's trips of one driver / helper ("Trip #91 · 6 AM – 9 AM · MAD 1957").
function useTodaysTrips(employeeId: number, enabled: boolean) {
  const [trips, setTrips] = useState<{ itinerary_id: number; slot: string; plate: string | null }[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    async function load() {
      const today = toManilaDate(new Date())
      const { data: crew } = await supabase
        .from('itinerary_crews')
        .select('itinerary_id')
        .eq('employee_id', employeeId)
        .eq('is_active', true)
      const ids = (crew ?? []).map((c) => c.itinerary_id)
      if (ids.length === 0) {
        if (!cancelled) setTrips([])
        return
      }
      const { data: rows } = await supabase
        .from('itineraries')
        .select('itinerary_id, trip_start_at, trip_end_at, plate_number, itinerary_status')
        .in('itinerary_id', ids)
        .eq('trip_date_from', today)
        .neq('itinerary_status', 'Cancelled')
        .order('trip_start_at')
      if (cancelled) return
      setTrips(
        (rows ?? []).map((r) => ({
          itinerary_id: r.itinerary_id,
          slot: r.trip_start_at ? formatSlot(r.trip_start_at, r.trip_end_at).replace(/^[^,]+, \d{4}, /, '') : 'no time set',
          plate: r.plate_number,
        })),
      )
    }
    load()
    return () => {
      cancelled = true
    }
  }, [employeeId, enabled])
  return trips
}

// The right-hand panel (the canvas's employee card): employment, contact,
// licence and medical exam, today's trips, and the actions.
function EmployeePanel({
  employee,
  hasLogin,
  onEdit,
  onSetStatus,
  onSetUpAccount,
  onCashAdvance,
  onHistory,
}: {
  employee: Employee
  hasLogin: boolean
  onEdit: () => void
  onSetStatus: (status: 'Deactivated' | 'Active') => void
  onSetUpAccount: () => void
  onCashAdvance: () => void
  onHistory: (() => void) | null
}) {
  const info = employee.editable
  const onTrips = employee.position === 'Driver' || employee.position === 'Helper'
  const trips = useTodaysTrips(employee.employee_id, onTrips)
  const rate = RATE_TYPES.find((r) => r.value === info.rate_type)
  const inactive = employee.status === 'Deactivated' || employee.status === 'Terminated'
  const years = age(info.date_of_birth)
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })

  return (
    <aside aria-labelledby="em-title" className="card flex flex-col xl:sticky xl:top-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
        <h2 id="em-title" className="text-lg leading-[26px] font-bold text-ink">
          {employee.name}
        </h2>
        <span className="rounded-[2px] bg-slate-200 px-2 py-0.5 text-xs font-semibold text-ink-secondary">{employee.position}</span>
        <StatusBadge status={employee.status} icon />
      </div>

      <div className="flex flex-col gap-[18px] px-5 py-4">
        <section>
          <h3 className={GROUP}>Employment</h3>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
            <Field label="Employee ID">#{employee.employee_id}</Field>
            <Field label="Date Hired">{employee.hire_date ? formatDate(employee.hire_date) : null}</Field>
            <Field label="Rate Type">{rate?.label ?? info.rate_type}</Field>
            <Field label={rate?.column ? (rate.label.charAt(0).toUpperCase() + rate.label.slice(1)) : 'Pay'}>
              {rate?.column ? (info.rate_amount !== null ? formatMoney(info.rate_amount) : null) : 'Commission % of trip rate'}
            </Field>
            <Field label="Portal Login">{hasLogin ? 'Has login' : 'No login yet'}</Field>
          </dl>
        </section>

        <section>
          <h3 className={GROUP}>Contact</h3>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
            <Field label="Contact No.">{info.phone_number}</Field>
            <Field label="Birthdate · Age">
              {info.date_of_birth ? `${formatDate(info.date_of_birth)}${years !== null ? ` · ${years}` : ''}` : null}
            </Field>
            <Field label="Address" wide>
              {[info.address, info.city, info.province].filter(Boolean).join(', ') || null}
            </Field>
            <Field label="Emergency Contact" wide>
              {[info.emergency_contact_name, info.emergency_contact_number].filter(Boolean).join(' · ') || null}
            </Field>
          </dl>
        </section>

        {employee.position === 'Driver' && (
          <section>
            <h3 className={GROUP}>
              <span>Driver License</span>
              <button type="button" onClick={onEdit} className="font-semibold text-primary hover:underline">
                Update
              </button>
            </h3>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
              <Field label="Truck">{info.assigned_plate_number ?? <span className="text-amber-700">None assigned</span>}</Field>
              <Field label="License No.">{info.driver_license_number}</Field>
              <Field label="Expires">
                <span className={expiryClass(info.driver_license_expiry_date)}>{expiryLabel(info.driver_license_expiry_date)}</span>
              </Field>
            </dl>
          </section>
        )}

        {employee.position === 'Driver' && (
          <section>
            <h3 className={GROUP}>
              <span>Medical Exams</span>
              <button type="button" onClick={onEdit} className="font-semibold text-primary hover:underline">
                Update
              </button>
            </h3>
            <dl className="grid grid-cols-3 gap-x-5 gap-y-3">
              {MEDICAL_EXAMS.map((exam) => {
                const result = info[exam.result]
                const expiry = info[exam.expiry] ?? null
                return (
                  <Field key={exam.key} label={exam.label}>
                    {result || expiry ? (
                      <span className="flex flex-col">
                        <span className={result === 'Failed' ? 'font-semibold text-red-700' : result === 'Passed' ? 'text-green-800' : 'text-ink-muted'}>
                          {result ?? 'No result'}
                        </span>
                        <span className={`text-[13px] ${expiryClass(expiry)}`}>{expiryLabel(expiry)}</span>
                      </span>
                    ) : (
                      <span className="text-ink-muted">Not recorded</span>
                    )}
                  </Field>
                )
              })}
            </dl>
          </section>
        )}

        {onTrips && (
          <section className="border border-line bg-slate-50 px-3.5 py-3">
            <h3 className="mb-1 text-sm font-semibold text-ink">Today, {today}</h3>
            <div className="text-sm text-ink-secondary">
              {trips === null
                ? 'Loading…'
                : trips.length === 0
                  ? 'No trips today.'
                  : trips.map((t) => (
                      <div key={t.itinerary_id}>
                        Trip #{t.itinerary_id} · {t.slot}
                        {t.plate ? ` · ${t.plate}` : ''}
                      </div>
                    ))}
            </div>
          </section>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
        {inactive ? (
          <button type="button" onClick={() => onSetStatus('Active')} className="btn-secondary px-4 text-sm font-medium">
            Reactivate
          </button>
        ) : (
          <button type="button" onClick={() => onSetStatus('Deactivated')} className="btn-danger px-4 text-sm">
            Deactivate…
          </button>
        )}
        <span className="flex-1" />
        {onHistory && (
          <button type="button" onClick={onHistory} className="btn-secondary px-4 text-sm font-medium">
            {employee.position === 'Mechanic' ? 'Work History' : 'Trip History'}
          </button>
        )}
        {!hasLogin && !inactive && (
          <button type="button" onClick={onSetUpAccount} className="btn-secondary px-4 text-sm font-medium">
            Set Up Account
          </button>
        )}
        {!inactive && (
          <button type="button" onClick={onCashAdvance} className="btn-secondary px-4 text-sm font-medium">
            Add Cash Advance
          </button>
        )}
        <button type="button" onClick={onEdit} className="btn-primary flex items-center gap-2 px-5 text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" />
          </svg>
          Edit
        </button>
      </div>
    </aside>
  )
}

function EmployeesSection() {
  const [activeTab, setActiveTab] = useState<Tab>('Active')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [linkedEmployeeIds, setLinkedEmployeeIds] = useState<Set<number>>(
    new Set(),
  )
  const [statusIdByName, setStatusIdByName] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [accountEmployee, setAccountEmployee] = useState<Employee | null>(
    null,
  )
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null)
  // The employee shown in the right panel (null = first on the page), and
  // the one a cash advance is being issued to.
  const [paneId, setPaneId] = useState<number | null>(null)
  const [cashAdvanceFor, setCashAdvanceFor] = useState<Employee | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    loadEmployees()
  }, [])

  // /dashboard/employees?employee=12 (the header bell's expiry notices) opens
  // that employee's edit form once the list has loaded, then clears the link.
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedEmployeeId = Number(searchParams.get('employee')) || null
  // Opened while rendering (React's "adjust state when a prop changes"
  // pattern) -- once per link; the effect below only clears the URL.
  const [openedLink, setOpenedLink] = useState<number | null>(null)
  if (linkedEmployeeId && linkedEmployeeId !== openedLink && employees.length > 0) {
    setOpenedLink(linkedEmployeeId)
    const match = employees.find((e) => e.employee_id === linkedEmployeeId)
    if (match) setEditingEmployee(match)
  }
  useEffect(() => {
    if (linkedEmployeeId && employees.length > 0) setSearchParams({}, { replace: true })
  }, [linkedEmployeeId, employees, setSearchParams])

  async function handleSetStatus(employee: Employee, statusName: 'Deactivated' | 'Active') {
    const statusId = statusIdByName.get(statusName)
    if (!statusId) {
      setActionError(
        `Could not find the "${statusName}" status -- make sure it's been added to employment_status.`,
      )
      return
    }

    // Deactivating someone still crewed on unfinished trips leaves those
    // trips with an inactive driver/helper -- list them so they get
    // reassigned on the Dispatch Board.
    let tripWarning = ''
    if (statusName === 'Deactivated' && DETAIL_VIEW_POSITIONS.has(employee.position)) {
      const { data: crewRows } = await supabase
        .from('itinerary_crews')
        .select('itinerary_id')
        .eq('employee_id', employee.employee_id)
        .eq('is_active', true)
      const tripIds = (crewRows ?? []).map((c) => c.itinerary_id)
      if (tripIds.length > 0) {
        const { data: openTrips } = await supabase
          .from('itineraries')
          .select('itinerary_id')
          .in('itinerary_id', tripIds)
          .not('itinerary_status', 'in', '(Delivered,Cancelled)')
        if (openTrips && openTrips.length > 0) {
          tripWarning =
            ` They are still assigned to trip ${openTrips.map((t) => `#${t.itinerary_id}`).join(', ')} -- ` +
            'reassign those on the Dispatch Board.'
        }
      }
    }

    const confirmMessage =
      statusName === 'Deactivated'
        ? `Deactivate ${employee.name}? They'll be removed from the active roster and, if they have a login, signed out and blocked from logging back in. Their records (payslips, history, etc.) stay fully intact.${tripWarning}`
        : `Reactivate ${employee.name}? They'll return to the active roster and be able to log in again.`

    if (
      !(await confirmDialog({
        message: confirmMessage,
        title: statusName === 'Deactivated' ? `Deactivate ${employee.name}?` : `Reactivate ${employee.name}?`,
        confirmLabel: statusName,
      }))
    )
      return

    setActionError(null)

    // .select() so a blocked update (RLS) shows as an error, not success.
    const { data: updated, error: updateError } = await supabase
      .from('employees')
      .update({ employment_status_id: statusId })
      .eq('employee_id', employee.employee_id)
      .select('employee_id')
      .maybeSingle()

    if (updateError || !updated) {
      setActionError(updateError?.message ?? `${employee.name} was not updated (no permission, or the record is gone).`)
      return
    }

    loadEmployees()
  }

  async function handleDelete(employee: Employee) {
    // Someone with a login can't be deleted: their users row (the login)
    // would be left pointing at a missing employee, and their trips would
    // lose their name. Deactivate keeps everything and blocks the login.
    if (linkedEmployeeIds.has(employee.employee_id)) {
      setActionError(
        `${employee.name} has a login account, so they can't be deleted. Use Deactivate instead -- it blocks the login and keeps their records.`,
      )
      return
    }

    if (
      !(await confirmDialog({
        title: `Delete ${employee.name}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return
    }

    setActionError(null)

    const { data: deleted, error: deleteError } = await supabase
      .from('employees')
      .delete()
      .eq('employee_id', employee.employee_id)
      .select('employee_id')


    if (deleteError) {
      // '23503' is Postgres's error code for a foreign key violation --
      // e.g. this employee is still assigned to a work order. Uses a
      // separate actionError state (not the page-load `error`) so a
      // failed delete shows a banner without hiding the whole list.
      if (deleteError.code === '23503') {
        setActionError(
          `Can't delete ${employee.name} -- they're still referenced ` +
            `elsewhere (e.g. an assigned work order). Reassign or remove ` +
            `those first, then try again.`,
        )
      } else {
        setActionError(deleteError.message)
      }
      return
    }
    if (!deleted || deleted.length === 0) {
      setActionError(`${employee.name} was not deleted (no permission, or already gone).`)
      return
    }

    loadEmployees()
  }

  async function loadEmployees() {
    setLoading(true)

    const first = await supabase
      .from('employees')
      .select(
        'employee_id, first_name, last_name, full_name, position, rate_type, hire_date, is_minimum_wage_earner, employment_status_id, daily_rate, weekly_salary, monthly_salary, hourly_rate, driver_license_number, driver_license_expiry_date, middle_name, phone_number, date_of_birth, email, address, city, province, zip_code, emergency_contact_name, emergency_contact_number, tin_number, sss_number, philhealth_number, pagibig_number, medical_exam_date, medical_exam_expiry_date, physical_exam_result, drug_test_date, drug_test_expiry_date, drug_test_result, psych_exam_date, psych_exam_expiry_date, psych_exam_result, assigned_plate_number',
      )
      .order('full_name', { ascending: true })
    let employeeRows = first.data
    let employeeError = first.error
    if (employeeError && isMissingExamColumns(employeeError.message)) {
      // Exam SQL not run yet: load without the new exam columns.
      const second = await supabase
        .from('employees')
        .select(
          'employee_id, first_name, last_name, full_name, position, rate_type, hire_date, is_minimum_wage_earner, employment_status_id, daily_rate, weekly_salary, monthly_salary, hourly_rate, driver_license_number, driver_license_expiry_date, middle_name, phone_number, date_of_birth, email, address, city, province, zip_code, emergency_contact_name, emergency_contact_number, tin_number, sss_number, philhealth_number, pagibig_number, medical_exam_date, medical_exam_expiry_date, assigned_plate_number',
        )
        .order('full_name', { ascending: true })
      employeeRows = second.data ? second.data.map((row) => ({ ...row, ...NO_NEW_EXAM_VALUES })) : null
      employeeError = second.error
    }

    if (employeeError) {
      setError(employeeError.message)
      setLoading(false)
      return
    }

    const { data: statuses, error: statusError } = await supabase
      .from('employment_status')
      .select('status_id, status_name')

    if (statusError) {
      setError(statusError.message)
      setLoading(false)
      return
    }

    const statusNameById = new Map(
      statuses.map((s) => [s.status_id, s.status_name]),
    )
    setStatusIdByName(new Map(statuses.map((s) => [s.status_name, s.status_id])))

    const { data: linkedRows, error: linkedError } = await supabase
      .from('users')
      .select('employee_id')
      .not('employee_id', 'is', null)

    if (linkedError) {
      setError(linkedError.message)
      setLoading(false)
      return
    }

    setLinkedEmployeeIds(
      new Set(linkedRows.map((row) => row.employee_id as number)),
    )

    setEmployees(
      (employeeRows ?? []).map((row) => ({
        employee_id: row.employee_id,
        name: row.full_name,
        position: row.position,
        status: statusNameById.get(row.employment_status_id) ?? '—',
        hire_date: row.hire_date,
        editable: {
          employee_id: row.employee_id,
          first_name: row.first_name,
          last_name: row.last_name,
          position: row.position,
          rate_type: row.rate_type,
          rate_amount: extractRateAmount(row, row.rate_type),
          hire_date: row.hire_date,
          is_minimum_wage_earner: row.is_minimum_wage_earner,
          driver_license_number: row.driver_license_number,
          driver_license_expiry_date: row.driver_license_expiry_date,
          // Physical / Drug Test / Psychological (lib/medicalExams.ts) --
          // includes medical_exam_date / medical_exam_expiry_date.
          ...examValuesOf(row),
          middle_name: row.middle_name,
          phone_number: row.phone_number,
          date_of_birth: row.date_of_birth,
          email: row.email,
          address: row.address,
          city: row.city,
          province: row.province,
          zip_code: row.zip_code,
          emergency_contact_name: row.emergency_contact_name,
          emergency_contact_number: row.emergency_contact_number,
          tin_number: row.tin_number,
          sss_number: row.sss_number,
          philhealth_number: row.philhealth_number,
          pagibig_number: row.pagibig_number,
          assigned_plate_number: row.assigned_plate_number,
        },
        licenseExpiryDate: row.driver_license_expiry_date,
        medicalExamExpiryDate: row.medical_exam_expiry_date,
      })),
    )
    setError(null)
    setLoading(false)
  }

  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const tabEmployees = employees.filter((employee) =>
    // Terminated people belong with the Deactivated ones, not the roster.
    activeTab === 'Deactivated'
      ? employee.status === 'Deactivated' || employee.status === 'Terminated'
      : employee.status !== 'Deactivated' && employee.status !== 'Terminated',
  )
  const positions = Array.from(
    new Set(['Dispatcher', ...tabEmployees.map((employee) => employee.position)]),
  ).sort()
  const statuses = Array.from(
    new Set(tabEmployees.map((employee) => employee.status)),
  ).sort()
  const filteredEmployees = tabEmployees.filter(
    (employee) =>
      employee.name.toLowerCase().includes(normalizedSearchTerm) &&
      (!positionFilter || employee.position === positionFilter) &&
      (!statusFilter || employee.status === statusFilter),
  )

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(filteredEmployees, `${activeTab}|${searchTerm}|${positionFilter}|${statusFilter}`)
  const paneEmployee = paged.rows.find((e) => e.employee_id === paneId) ?? paged.rows[0] ?? null
  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Staff records, logins and employment status."
        actions={
          <button
            onClick={() => setShowAddEmployee(true)}
            className="btn-primary flex items-center gap-2 px-5 text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14 M5 12h14" />
            </svg>
            Add Employee
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab)
              setStatusFilter('')
            }}
            className={`h-11 rounded-[2px] border px-5 text-sm font-semibold ${
              activeTab === tab
                ? 'border-primary bg-primary text-white'
                : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {actionError && (
        <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {!loading && !error && employees.length > 0 && (
        // Filters: Position, Status, Search -- each with a visible label.
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className={FILTER_LABEL}>
            Position
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              className={`${FILTER_CONTROL} w-44`}
            >
              <option value="">All positions</option>
              {positions.map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
            </select>
          </label>
          <label className={FILTER_LABEL}>
            Status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`${FILTER_CONTROL} w-40`}
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className={FILTER_LABEL}>
            Search
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Employee name"
              className={`${FILTER_CONTROL} w-60 font-normal placeholder:text-ink-muted`}
            />
          </label>
        </div>
      )}

      {(() => {
        // Every driver needs his own truck (the Dispatch Board and Capacity Check use it).
        const noTruck = employees.filter(
          (e) => e.position === 'Driver' && e.status !== 'Deactivated' && e.status !== 'Terminated' && !e.editable.assigned_plate_number,
        )
        return noTruck.length > 0 ? (
          <p className="mt-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {noTruck.length} {noTruck.length === 1 ? 'driver has' : 'drivers have'} no truck assigned: {noTruck.map((e) => e.name).join(', ')}. Edit
            each one and pick a truck.
          </p>
        ) : null
      })()}
      {loading && <p className="mt-4 text-slate-500">Loading employees...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && employees.length === 0 && (
        <EmptyState message="No employees yet." className="mt-4" />
      )}

      {!loading && !error && employees.length > 0 && filteredEmployees.length === 0 && (
        <EmptyState message="No employees match the current search and filters." className="mt-4" />
      )}

      {!loading && !error && filteredEmployees.length > 0 && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px] xl:items-start">
          <section aria-label="Employee masterlist" className="card flex min-h-[calc(100dvh-19rem)] flex-col">
            <div className="flex-1 overflow-x-auto">
              {/* Header row style comes from index.css (thead th). */}
              <table className="w-full min-w-[860px] table-fixed text-left text-sm text-ink-metric">
                <colgroup>
                  {['120px', '', '130px', '120px', '160px', '150px', '52px'].map((width, i) => (
                    <col key={i} style={width ? { width } : undefined} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className={TH}>Employee ID</th>
                    <th className={TH}>Full Name</th>
                    <th className={TH}>Position</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Contact</th>
                    <th className={TH}>License Expiry</th>
                    <th className={TH}>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((employee) => {
                    const active = paneEmployee?.employee_id === employee.employee_id
                    return (
                      <tr
                        key={employee.employee_id}
                        onClick={() => setPaneId(employee.employee_id)}
                        aria-current={active || undefined}
                        className={`h-[60px] cursor-pointer border-b border-slate-200 ${
                          active ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className={`${TD} text-ink-muted tabular-nums`}>#{employee.employee_id}</td>
                        <td className={`${TD} truncate font-semibold text-ink`} title={employee.name}>
                          {employee.name}
                        </td>
                        <td className={TD}>{employee.position}</td>
                        <td className={TD}>
                          <StatusBadge status={employee.status} icon />
                        </td>
                        <td className={`${TD} tabular-nums ${employee.editable.phone_number ? '' : 'text-ink-muted'}`}>
                          {employee.editable.phone_number ?? '—'}
                        </td>
                        <td className={`${TD} ${employee.position === 'Driver' ? expiryClass(employee.licenseExpiryDate) : 'text-ink-muted'}`}>
                          {employee.position === 'Driver' ? expiryLabel(employee.licenseExpiryDate) : 'Not a driver'}
                        </td>
                        <td className={TD}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPaneId(employee.employee_id)
                            }}
                            aria-label={`Open ${employee.name}`}
                            className="flex h-11 w-11 items-center justify-center text-primary"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
              <span>
                {filteredEmployees.length} {filteredEmployees.length === 1 ? 'employee' : 'employees'} ·{' '}
                {filteredEmployees.filter((e) => e.position === 'Driver').length} drivers
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                  disabled={paged.pager.page === 0}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                  disabled={paged.pager.page >= paged.pager.pageCount - 1}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  Next ›
                </button>
              </span>
            </div>
          </section>

          {paneEmployee && (
            <EmployeePanel
              // key = fresh "today's trips" per employee
              key={paneEmployee.employee_id}
              employee={paneEmployee}
              hasLogin={linkedEmployeeIds.has(paneEmployee.employee_id)}
              onEdit={() => setEditingEmployee(paneEmployee)}
              onSetStatus={(status) => handleSetStatus(paneEmployee, status)}
              onSetUpAccount={() => setAccountEmployee(paneEmployee)}
              onCashAdvance={() => setCashAdvanceFor(paneEmployee)}
              onHistory={DETAIL_VIEW_POSITIONS.has(paneEmployee.position) ? () => setDetailEmployee(paneEmployee) : null}
            />
          )}
        </div>
      )}

      {cashAdvanceFor && (
        <IssueCashAdvanceModal
          employeeId={cashAdvanceFor.employee_id}
          onClose={() => setCashAdvanceFor(null)}
          onIssued={() => {
            showToast(`Cash advance issued to ${cashAdvanceFor.name}.`)
            setCashAdvanceFor(null)
          }}
        />
      )}

      {showAddEmployee && (
        <AddEmployeeModal
          onClose={() => setShowAddEmployee(false)}
          onSaved={() => {
            setShowAddEmployee(false)
            loadEmployees()
          }}
        />
      )}

      {editingEmployee && (
        <AddEmployeeModal
          employee={editingEmployee.editable}
          isDeactivated={editingEmployee.status === 'Deactivated'}
          onClose={() => setEditingEmployee(null)}
          onSaved={() => {
            setEditingEmployee(null)
            loadEmployees()
          }}
          // Close the edit modal first so the confirm dialog isn't hidden behind it.
          onToggleStatus={() => {
            const emp = editingEmployee
            setEditingEmployee(null)
            handleSetStatus(emp, emp.status === 'Deactivated' ? 'Active' : 'Deactivated')
          }}
          onDelete={() => {
            const emp = editingEmployee
            setEditingEmployee(null)
            handleDelete(emp)
          }}
        />
      )}

      {accountEmployee && (
        <SetUpStaffAccountModal
          employee={accountEmployee}
          onClose={() => setAccountEmployee(null)}
          onCreated={(employeeId) => {
            setLinkedEmployeeIds((prev) => new Set(prev).add(employeeId))
            setAccountEmployee(null)
          }}
        />
      )}

      {detailEmployee && (
        <EmployeeDetailModal
          employee={{
            employee_id: detailEmployee.employee_id,
            name: detailEmployee.name,
            position: detailEmployee.position,
            info: detailEmployee.editable,
          }}
          onClose={() => setDetailEmployee(null)}
        />
      )}
    </div>
  )
}

export default EmployeesSection
