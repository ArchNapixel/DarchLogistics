// EmployeesSection: lists employees in a table, with an "Add Employee"
// button that opens a form. The list reads real data from `employees`;
// employment_status_id has no foreign key at the database level, so the
// status name is looked up separately and merged in here (same pattern
// as place-name lookups in DriverTasks.tsx / MyBookingsSection.tsx).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import AddEmployeeModal, { RATE_TYPES, type EditableEmployee } from './AddEmployeeModal'

type Employee = {
  employee_id: number
  name: string
  position: string
  status: string
  hire_date: string
  editable: EditableEmployee
}

function extractRateAmount(row: Record<string, unknown>, rateType: string) {
  const rateInfo = RATE_TYPES.find((r) => r.value === rateType)
  if (!rateInfo) return null
  const value = row[rateInfo.column]
  return typeof value === 'number' ? value : null
}

const STATUS_STYLES: Record<string, string> = {
  Active: 'bg-green-100 text-green-700',
  'On Leave': 'bg-orange-100 text-orange-700',
  Terminated: 'bg-red-100 text-red-700',
}

function EmploymentStatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

function EmployeesSection() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [positionFilter, setPositionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    loadEmployees()
  }, [])

  async function handleDelete(employee: Employee) {
    if (!window.confirm(`Delete ${employee.name}? This cannot be undone.`)) {
      return
    }

    setDeletingId(employee.employee_id)
    setActionError(null)

    const { error: deleteError } = await supabase
      .from('employees')
      .delete()
      .eq('employee_id', employee.employee_id)

    setDeletingId(null)

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
        'employee_id, first_name, last_name, full_name, position, rate_type, hire_date, employment_status_id, daily_rate, commission_per_trip, monthly_salary, hourly_rate',
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
        },
      })),
    )
    setError(null)
    setLoading(false)
  }

  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const positions = Array.from(
    new Set(['Dispatcher', ...employees.map((employee) => employee.position)]),
  ).sort()
  const statuses = Array.from(
    new Set(['Inactive', ...employees.map((employee) => employee.status)]),
  ).sort()
  const filteredEmployees = employees.filter(
    (employee) =>
      employee.name.toLowerCase().includes(normalizedSearchTerm) &&
      (!positionFilter || employee.position === positionFilter) &&
      (!statusFilter || employee.status === statusFilter),
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Employees</h2>
        <button
          onClick={() => setShowAddEmployee(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Add Employee
        </button>
      </div>

      {actionError && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
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
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </label>
          <label>
            <span className="sr-only">Filter by position</span>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
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
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
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
        <p className="mt-4 text-slate-500">No employees yet.</p>
      )}

      {!loading && !error && employees.length > 0 && filteredEmployees.length === 0 && (
        <p className="mt-4 text-slate-500">
          No employees match the current search and filters.
        </p>
      )}

      {!loading && !error && filteredEmployees.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Hire Date</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr
                  key={employee.employee_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">{employee.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {employee.position}
                  </td>
                  <td className="px-4 py-3">
                    <EmploymentStatusBadge status={employee.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {employee.hire_date}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button
                        onClick={() => setEditingEmployee(employee)}
                        className="font-medium text-slate-600 hover:text-slate-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(employee)}
                        disabled={deletingId === employee.employee_id}
                        className="font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {deletingId === employee.employee_id
                          ? 'Deleting...'
                          : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showAddEmployee || editingEmployee) && (
        <AddEmployeeModal
          employee={editingEmployee?.editable}
          onClose={() => {
            setShowAddEmployee(false)
            setEditingEmployee(null)
          }}
          onSaved={() => {
            setShowAddEmployee(false)
            setEditingEmployee(null)
            loadEmployees()
          }}
        />
      )}
    </div>
  )
}

export default EmployeesSection
