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
import ScheduleMaintenanceModal from './employee/ScheduleMaintenanceModal'

function EmployeeDashboard() {
  const { username, role, employeeId } = useAuth()
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0)
  const [showScheduleMaintenance, setShowScheduleMaintenance] = useState(false)
  const [scheduledMessage, setScheduledMessage] = useState<string | null>(null)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome, {username}
          </h1>
          <RoleBadge role={role} />
        </div>

        {role === 'Mechanic' && (
          <button
            onClick={() => setShowScheduleMaintenance(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Schedule Maintenance
          </button>
        )}
      </div>

      {scheduledMessage && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {scheduledMessage}
        </p>
      )}

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

      {showScheduleMaintenance && employeeId && (
        <ScheduleMaintenanceModal
          employeeId={employeeId}
          onClose={() => setShowScheduleMaintenance(false)}
          onScheduled={() => {
            setShowScheduleMaintenance(false)
            setScheduledMessage('Maintenance schedule sent to admin.')
          }}
        />
      )}
    </div>
  )
}

export default EmployeeDashboard
