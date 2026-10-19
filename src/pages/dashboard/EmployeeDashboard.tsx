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
import MyTasksSection from './employee/MyTasksSection'
import TaskBoard from './employee/TaskBoard'
import ScheduleMaintenanceModal from './employee/ScheduleMaintenanceModal'
import IssueMaintenanceRequestModal from './employee/IssueMaintenanceRequestModal'
import InspectionReportModal from './employee/InspectionReportModal'
import PageHeader from '../../components/PageHeader'
import { showToast } from '../../components/Toast'

function EmployeeDashboard() {
  const { username, role, employeeId } = useAuth()
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0)
  const [showScheduleMaintenance, setShowScheduleMaintenance] = useState(false)
  const [showIssueRequest, setShowIssueRequest] = useState(false)
  const [showInspectionReport, setShowInspectionReport] = useState(false)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome, ${username} · ${new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}`}
        actions={<>
          <button
            onClick={() => setShowIssueRequest(true)}
            className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:border-slate-900 hover:bg-slate-900 hover:text-white"
          >
            Issue Maintenance Request
          </button>

          {role === 'Mechanic' && (
            <button
              onClick={() => setShowScheduleMaintenance(true)}
              className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              Schedule Maintenance
            </button>
          )}
          {/* Every employee role can report an issue -- about a vehicle
              or general (InspectionReportModal covers both). */}
          <button
            onClick={() => setShowInspectionReport(true)}
            className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:border-slate-900 hover:bg-slate-900 hover:text-white"
          >
            {role === 'Mechanic' ? 'Submit Inspection Report' : 'Report Issue'}
          </button>
        </>}
      />



      <div className="mt-8">
        <MyTasksSection key={tasksRefreshKey} />
      </div>

      {role === 'Mechanic' && (
        <TaskBoard onAccepted={() => setTasksRefreshKey((key) => key + 1)} />
      )}

      {showScheduleMaintenance && employeeId && (
        <ScheduleMaintenanceModal
          employeeId={employeeId}
          onClose={() => setShowScheduleMaintenance(false)}
          onScheduled={() => {
            setShowScheduleMaintenance(false)
            showToast('Maintenance schedule sent to admin.')
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
            showToast('Maintenance request sent to admin for approval.')
          }}
        />
      )}
    </div>
  )
}

export default EmployeeDashboard
