// MyTasksSection: renders the right task list for the logged-in user's
// actual role -- DriverTasks for a Driver or Helper (a Helper gets the
// same trip list, read-only), MechanicTasks for a Mechanic. All share
// this same EmployeeDashboard page/layout.
import { useAuth } from '../../../context/AuthContext'
import DriverTasks from './DriverTasks'
import MechanicTasks from './MechanicTasks'
import { SectionHeader } from '../../../components/PageHeader'

function MyTasksSection() {
  const { role } = useAuth()

  return (
    <div className="border border-slate-200 bg-white p-8 shadow-sm">
      <SectionHeader title="My Tasks" />
      <div>
        {role === 'Driver' && <DriverTasks crewRole="Driver" />}
        {role === 'Helper' && <DriverTasks crewRole="Helper" />}
        {role === 'Mechanic' && <MechanicTasks />}
      </div>
    </div>
  )
}

export default MyTasksSection
