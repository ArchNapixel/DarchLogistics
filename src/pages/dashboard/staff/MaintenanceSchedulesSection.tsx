// MaintenanceSchedulesSection: pending maintenance alerts mechanics
// flagged for a truck/trailer (employee/ScheduleMaintenanceModal.tsx) --
// e.g. "oil change due in 3 months". Shared between the Reports page
// and the Maintenance page so staff can see it from either place. Mark
// Done clears it once the actual maintenance happens.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPendingMaintenanceSchedules,
  markMaintenanceScheduleDone,
  formatScheduleDueDate,
  SCHEDULE_TONE_STYLES,
  type PendingMaintenanceSchedule,
} from '../../../lib/maintenanceSchedules'

function MaintenanceSchedulesSection() {
  const { employeeId } = useAuth()
  const [schedules, setSchedules] = useState<PendingMaintenanceSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { schedules: loaded, error: loadError } = await loadPendingMaintenanceSchedules()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setSchedules(loaded)
    setError(null)
    setLoading(false)
  }

  async function handleMarkDone(schedule: PendingMaintenanceSchedule) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as done by you. Contact an admin.',
      )
      return
    }

    setCompletingId(schedule.schedule_id)
    setActionError(null)

    const { error: markError } = await markMaintenanceScheduleDone({
      scheduleId: schedule.schedule_id,
      completedByEmployeeId: employeeId,
    })

    setCompletingId(null)

    if (markError) {
      setActionError(markError)
      return
    }

    setSchedules((prev) => prev.filter((s) => s.schedule_id !== schedule.schedule_id))
  }

  if (loading) {
    return <p className="text-slate-500">Loading maintenance schedules...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      {actionError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {schedules.length === 0 ? (
        <p className="text-slate-500">No upcoming maintenance schedules.</p>
      ) : (
        <div className="grid gap-3">
          {schedules.map((schedule) => {
            const due = formatScheduleDueDate(schedule.due_date)
            return (
              <div
                key={schedule.schedule_id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{schedule.vehicle_label}</p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${SCHEDULE_TONE_STYLES[due.tone]}`}
                  >
                    {due.label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Flagged by {schedule.reported_by_name}
                </p>
                <p className="mt-2 text-sm text-slate-700">{schedule.maintenance_type}</p>
                {schedule.notes && (
                  <p className="mt-1 text-sm text-slate-500">Notes: {schedule.notes}</p>
                )}
                <button
                  onClick={() => handleMarkDone(schedule)}
                  disabled={completingId === schedule.schedule_id}
                  className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {completingId === schedule.schedule_id ? 'Saving...' : 'Mark Done'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default MaintenanceSchedulesSection
