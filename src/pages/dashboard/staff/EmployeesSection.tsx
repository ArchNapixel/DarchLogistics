// EmployeesSection: lists employees in a table, with an "Add Employee"
// button that opens a form. The list reads real data from `employees`;
// employment_status_id has no foreign key at the database level, so the
// status name is looked up separately and merged in here (same pattern
// as place-name lookups in DriverTasks.tsx / MyBookingsSection.tsx).
import { useEffect, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import AddEmployeeModal, { RATE_TYPES, type EditableEmployee } from './AddEmployeeModal'
import SetUpStaffAccountModal from './SetUpStaffAccountModal'
import EmployeeDetailModal from './EmployeeDetailModal'
import { confirmDialog } from '../../../components/ConfirmDialog'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate } from '../../../lib/format'
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
  if (!date) return 'text-slate-400'
  const days = Math.ceil(
    (new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86400000,
  )
  return days < 0
    ? 'font-medium text-red-700'
    : days <= 30
      ? 'font-medium text-orange-700'
      : 'text-slate-600'
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    loadEmployees()
  }, [])

  async function handleSetStatus(employee: Employee, statusName: 'Deactivated' | 'Active') {
    const statusId = statusIdByName.get(statusName)
    if (!statusId) {
      setActionError(
        `Could not find the "${statusName}" status -- make sure it's been added to employment_status.`,
      )
      return
    }

    const confirmMessage =
      statusName === 'Deactivated'
        ? `Deactivate ${employee.name}? They'll be removed from the active roster and, if they have a login, signed out and blocked from logging back in. Their records (payslips, history, etc.) stay fully intact.`
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

    const { error: updateError } = await supabase
      .from('employees')
      .update({ employment_status_id: statusId })
      .eq('employee_id', employee.employee_id)


    if (updateError) {
      setActionError(updateError.message)
      return
    }

    loadEmployees()
  }

  async function handleDelete(employee: Employee) {
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

    const { error: deleteError } = await supabase
      .from('employees')
      .delete()
      .eq('employee_id', employee.employee_id)


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

    loadEmployees()
  }

  async function loadEmployees() {
    setLoading(true)

    const { data: employeeRows, error: employeeError } = await supabase
      .from('employees')
      .select(
        'employee_id, first_name, last_name, full_name, position, rate_type, hire_date, is_minimum_wage_earner, employment_status_id, daily_rate, weekly_salary, monthly_salary, hourly_rate, driver_license_number, driver_license_expiry_date, medical_exam_date, medical_exam_expiry_date, middle_name, phone_number, date_of_birth, email, address, city, province, zip_code, emergency_contact_name, emergency_contact_number, tin_number, sss_number, philhealth_number, pagibig_number',
      )
      .order('full_name', { ascending: true })

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
      employeeRows.map((row) => ({
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
          medical_exam_date: row.medical_exam_date,
          medical_exam_expiry_date: row.medical_exam_expiry_date,
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
    activeTab === 'Deactivated'
      ? employee.status === 'Deactivated'
      : employee.status !== 'Deactivated',
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
  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Staff records, logins and employment status."
        actions={
          <button
            onClick={() => setShowAddEmployee(true)}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            Add Employee
          </button>
        }
      />

      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab)
              setStatusFilter('')
            }}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
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
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label>
            <span className="sr-only">Search employee names</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search names..."
              className="w-full border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </label>
          <label>
            <span className="sr-only">Filter by position</span>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              className="w-full border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All positions</option>
              {positions.map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by status</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {loading && <p className="mt-4 text-slate-500">Loading employees...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && employees.length === 0 && (
        <EmptyState message="No employees yet." className="mt-4" />
      )}

      {!loading && !error && employees.length > 0 && filteredEmployees.length === 0 && (
        <EmptyState message="No employees match the current search and filters." className="mt-4" />
      )}

      {!loading && !error && filteredEmployees.length > 0 && (
        <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Hire Date</th>
                <th className="px-4 py-3 font-medium">License Expiry</th>
                <th className="px-4 py-3 font-medium">Medical Exam</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((employee) => {
                const isLinked = linkedEmployeeIds.has(employee.employee_id)
                return (
                  <tr
                    key={employee.employee_id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 text-slate-900">
                      {DETAIL_VIEW_POSITIONS.has(employee.position) ? (
                        <button
                          onClick={() => setDetailEmployee(employee)}
                          className="font-medium text-slate-900 underline decoration-slate-300 hover:text-slate-700"
                        >
                          {employee.name}
                        </button>
                      ) : (
                        employee.name
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {employee.position}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={employee.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(employee.hire_date)}
                    </td>
                    <td className={`px-4 py-3 ${expiryClass(employee.licenseExpiryDate)}`}>
                      {employee.position === 'Driver'
                        ? expiryLabel(employee.licenseExpiryDate)
                        : '—'}
                    </td>
                    <td className={`px-4 py-3 ${expiryClass(employee.medicalExamExpiryDate)}`}>
                      {employee.position === 'Driver'
                        ? expiryLabel(employee.medicalExamExpiryDate)
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {isLinked ? (
                        <StatusBadge status="Set Up" />
                      ) : (
                        <button
                          onClick={() => setAccountEmployee(employee)}
                          className="btn-secondary px-3 py-1.5 text-xs font-medium"
                        >
                          Set Up Account
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => setEditingEmployee(employee)}
                          className="font-medium text-slate-600 hover:text-slate-900"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pager {...paged.pager} />
        </div>
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
