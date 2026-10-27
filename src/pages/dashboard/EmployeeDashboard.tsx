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
        subtitle={
          role === 'Mechanic'
            ? 'Your work orders, and new ones waiting to be taken.'
            : `Welcome, ${username} · ${new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}`
        }
        actions={<>
          <button
            onClick={() => setShowIssueRequest(true)}
            className={`flex items-center gap-2 px-4 text-sm ${role === 'Mechanic' ? 'btn-primary' : 'btn-secondary font-medium'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14.5 6.5a4 4 0 0 0 4.5 5L9 21.5a2 2 0 0 1-3-3l10-10 M14.5 6.5l3-3 2 2-3 3" />
            </svg>
            Issue Maintenance Request
          </button>

          {role === 'Mechanic' && (
            <button onClick={() => setShowScheduleMaintenance(true)} className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9h16 M8 2v4 M16 2v4" />
              </svg>
              Schedule Maintenance
            </button>
          )}
          {/* Every employee role can report an issue -- about a vehicle
              or general (InspectionReportModal covers both). */}
          <button onClick={() => setShowInspectionReport(true)} className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={role === 'Mechanic' ? 'M9 5h6 M9 3h6v4H9z M6 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1 M8 13l3 3 5-6' : 'M12 3l10 18H2z M12 10v5 M12 18h.01'} />
            </svg>
            {role === 'Mechanic' ? 'Submit Inspection Report' : 'Report Issue'}
          </button>
        </>}
      />



      {role === 'Mechanic' ? (
        // My Tasks + Recently Completed on the left, the Task Board beside them.
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start">
          <MyTasksSection key={tasksRefreshKey} />
          <TaskBoard onAccepted={() => setTasksRefreshKey((key) => key + 1)} />
        </div>
      ) : (
        <MyTasksSection key={tasksRefreshKey} />
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
