// MyTasksSection: renders the right task list for the logged-in user's
// actual role -- DriverTasks for a Driver or Helper (a Helper gets the
// same trip list, read-only), MechanicTasks for a Mechanic. All share
// this same EmployeeDashboard page/layout.
import { useAuth } from '../../../context/AuthContext'
import DriverTasks from './DriverTasks'
import MechanicTasks from './MechanicTasks'

function MyTasksSection() {
  const { role } = useAuth()

  // Drivers and helpers: DriverTasks lays out its own cards and side
  // panels (the canvas's Driver Dashboard).
  if (role === 'Driver' || role === 'Helper') return <DriverTasks crewRole={role} />

  // Mechanics: MechanicTasks draws its own My Tasks / Recently Completed cards.
  return role === 'Mechanic' ? <MechanicTasks /> : null
}

export default MyTasksSection
