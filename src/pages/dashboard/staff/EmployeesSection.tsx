// EmployeesSection: lists employees in a table, with an "Add Employee"
// button that opens a form.
//
// MOCK DATA -- replace with real Supabase query later. Nothing on this
// page reads from or writes to the database yet.
import { useState } from 'react'
import AddEmployeeModal from './AddEmployeeModal'

type EmploymentStatus = 'Active' | 'On Leave' | 'Terminated'

type Employee = {
  employee_id: number
  name: string
  position: string
  status: EmploymentStatus
  hire_date: string
}

// MOCK DATA -- replace with real Supabase query later.
const MOCK_EMPLOYEES: Employee[] = [
  {
    employee_id: 1,
    name: 'Ramon Cruz',
    position: 'Driver',
    status: 'Active',
    hire_date: '2022-03-14',
  },
  {
    employee_id: 2,
    name: 'Ariel Santos',
    position: 'Driver',
    status: 'Active',
    hire_date: '2021-11-02',
  },
  {
    employee_id: 3,
    name: 'Ben Villareal',
    position: 'Driver',
    status: 'On Leave',
    hire_date: '2023-06-19',
  },
  {
    employee_id: 4,
    name: 'Carlo Reyes',
    position: 'Mechanic',
    status: 'Active',
    hire_date: '2020-09-30',
  },
  {
    employee_id: 5,
    name: 'Diego Fernandez',
    position: 'Mechanic',
    status: 'Terminated',
    hire_date: '2019-01-08',
  },
  {
    employee_id: 6,
    name: 'Elena Torres',
    position: 'Dispatcher',
    status: 'Active',
    hire_date: '2024-02-26',
  },
]

const STATUS_STYLES: Record<EmploymentStatus, string> = {
  Active: 'bg-green-100 text-green-700',
  'On Leave': 'bg-orange-100 text-orange-700',
  Terminated: 'bg-red-100 text-red-700',
}

function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

function EmployeesSection() {
  const [employees] = useState<Employee[]>(MOCK_EMPLOYEES)
  const [showAddEmployee, setShowAddEmployee] = useState(false)

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

      {showAddEmployee && (
        <AddEmployeeModal onClose={() => setShowAddEmployee(false)} />
      )}
    </div>
  )
}

export default EmployeesSection
