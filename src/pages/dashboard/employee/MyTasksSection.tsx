// MyTasksSection: renders the right task list for the logged-in user's
// actual role -- DriverTasks for a Driver, MechanicTasks for a Mechanic.
// Both roles share this same EmployeeDashboard page/layout.
import { useAuth } from '../../../context/AuthContext'
import DriverTasks from './DriverTasks'
import MechanicTasks from './MechanicTasks'

function MyTasksSection() {
  const { role } = useAuth()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">My Tasks</h2>
      <div className="mt-4">
        {role === 'Driver' && <DriverTasks />}
        {role === 'Mechanic' && <MechanicTasks />}
      </div>
    </div>
  )
}

export default MyTasksSection
