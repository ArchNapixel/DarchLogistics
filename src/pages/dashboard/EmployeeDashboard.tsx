// EmployeeDashboard: shown to both Driver and Mechanic -- identical view
// for both roles, only the role badge text differs, plus Mechanics get
// an extra Task Board above "My Tasks" for accepting unassigned work
// orders. Accepting one bumps tasksRefreshKey, which is passed as
// MyTasksSection's `key` -- changing a component's key remounts it, so
// this is a lightweight way to make the newly-accepted work order show
// up in "My Tasks" immediately without wiring a shared data store
// between the two sibling components.
import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import RoleBadge from '../../components/RoleBadge'
import MyTasksSection from './employee/MyTasksSection'
import TaskBoard from './employee/TaskBoard'

function EmployeeDashboard() {
  const { username, role } = useAuth()
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0)

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {username}
        </h1>
        <RoleBadge role={role} />
      </div>

      {role === 'Mechanic' && (
        <div className="mt-8">
          <TaskBoard
            onAccepted={() => setTasksRefreshKey((key) => key + 1)}
          />
        </div>
      )}

      <div className="mt-8">
        <MyTasksSection key={tasksRefreshKey} />
      </div>
    </div>
  )
}

export default EmployeeDashboard
