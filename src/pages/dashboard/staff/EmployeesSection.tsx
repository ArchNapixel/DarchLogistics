// EmployeesSection: lists employees in a table, with an "Add Employee"
// button that opens a form. The list reads real data from `employees`;
// employment_status_id has no foreign key at the database level, so the
// status name is looked up separately and merged in here (same pattern
// as place-name lookups in DriverTasks.tsx / MyBookingsSection.tsx).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import AddEmployeeModal from './AddEmployeeModal'

type Employee = {
  employee_id: number
  name: string
  position: string
  status: string
  hire_date: string
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

  useEffect(() => {
    loadEmployees()
  }, [])

  async function loadEmployees() {
    setLoading(true)

    const { data: employeeRows, error: employeeError } = await supabase
      .from('employees')
      .select('employee_id, full_name, position, hire_date, employment_status_id')
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
      })),
    )
    setError(null)
    setLoading(false)
  }

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

      {loading && <p className="mt-4 text-slate-500">Loading employees...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && employees.length === 0 && (
        <p className="mt-4 text-slate-500">No employees yet.</p>
      )}

      {!loading && !error && employees.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Hire Date</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddEmployee && (
        <AddEmployeeModal
          onClose={() => setShowAddEmployee(false)}
          onAdded={() => {
            setShowAddEmployee(false)
            loadEmployees()
          }}
        />
      )}
    </div>
  )
}

export default EmployeesSection
