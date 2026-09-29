// EmployeeDashboard: shown to both Driver and Mechanic -- identical view
// for both roles, only the role badge text differs, plus Mechanics get
// an extra Task Board below "My Tasks" for accepting unassigned work
// orders (their own assigned work comes first), and their header also
// holds "Schedule Maintenance". Every role's header has "Issue
// Maintenance Request" and "Report Issue" (labelled "Submit Inspection
// Report" for Mechanics) -- the Driver's report buttons used to sit
// inside the trip list, now every action is in one place. Accepting a work order on the
// Task Board bumps tasksRefreshKey, which is passed as
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
import IssueMaintenanceRequestModal from './employee/IssueMaintenanceRequestModal'
import InspectionReportModal from './employee/InspectionReportModal'

function EmployeeDashboard() {
  const { username, role, employeeId } = useAuth()
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0)
  const [showScheduleMaintenance, setShowScheduleMaintenance] = useState(false)
  const [scheduledMessage, setScheduledMessage] = useState<string | null>(null)
  const [showIssueRequest, setShowIssueRequest] = useState(false)
  const [requestMessage, setRequestMessage] = useState<string | null>(null)
  const [showInspectionReport, setShowInspectionReport] = useState(false)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome, {username}
            </h1>
            <RoleBadge role={role} />
          </div>
          <p className="text-sm text-slate-500">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowIssueRequest(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Issue Maintenance Request
          </button>

          {role === 'Mechanic' && (
            <button
              onClick={() => setShowScheduleMaintenance(true)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Schedule Maintenance
            </button>
          )}
          {/* Every employee role can report an issue -- about a vehicle
              or general (InspectionReportModal covers both). */}
          <button
            onClick={() => setShowInspectionReport(true)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {role === 'Mechanic' ? 'Submit Inspection Report' : 'Report Issue'}
          </button>
        </div>
      </div>

      {scheduledMessage && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {scheduledMessage}
        </p>
      )}

      {requestMessage && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {requestMessage}
        </p>
      )}

      <div className="mt-8">
        <MyTasksSection key={tasksRefreshKey} />
      </div>

      {role === 'Mechanic' && (
        <div className="mt-8">
          <TaskBoard
            onAccepted={() => setTasksRefreshKey((key) => key + 1)}
          />
        </div>
      )}

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

      {showInspectionReport && (
        <InspectionReportModal onClose={() => setShowInspectionReport(false)} />
      )}

      {showIssueRequest && employeeId && (
        <IssueMaintenanceRequestModal
          employeeId={employeeId}
          onClose={() => setShowIssueRequest(false)}
          onSubmitted={() => {
            setShowIssueRequest(false)
            setRequestMessage('Maintenance request sent to admin for approval.')
          }}
        />
      )}
    </div>
  )
}

export default EmployeeDashboard
