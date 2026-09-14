// maintenanceSchedules: shared data access for a mechanic flagging a
// truck or trailer as needing maintenance sometime in the future (e.g.
// "oil change due in 3 months"), so admin/dispatch can plan ahead
// instead of only finding out once something actually breaks.
import { supabase } from './supabaseClient'

export const MAINTENANCE_INTERVALS = ['1 month', '3 months', '6 months'] as const
export type MaintenanceInterval = (typeof MAINTENANCE_INTERVALS)[number]

const INTERVAL_MONTHS: Record<MaintenanceInterval, number> = {
  '1 month': 1,
  '3 months': 3,
  '6 months': 6,
}

function dueDateFromInterval(interval: MaintenanceInterval): string {
  const date = new Date()
  date.setMonth(date.getMonth() + INTERVAL_MONTHS[interval])
  return date.toISOString().slice(0, 10)
}

export async function createMaintenanceSchedule({
  plateNumber,
  trailerId,
  reportedByEmployeeId,
  maintenanceType,
  notes,
  interval,
}: {
  plateNumber: string | null
  trailerId: number | null
  reportedByEmployeeId: number
  maintenanceType: string
  notes?: string
  interval: MaintenanceInterval
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('maintenance_schedules').insert({
    plate_number: plateNumber,
    trailer_id: trailerId,
    reported_by_employee_id: reportedByEmployeeId,
    maintenance_type: maintenanceType,
    notes: notes?.trim() || null,
    due_date: dueDateFromInterval(interval),
  })

  return { error: error?.message ?? null }
}

export type PendingMaintenanceSchedule = {
  schedule_id: number
  vehicle_label: string
  maintenance_type: string
  notes: string | null
  due_date: string
  reported_by_name: string
  created_at: string
}

export async function loadPendingMaintenanceSchedules(): Promise<{
  schedules: PendingMaintenanceSchedule[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('maintenance_schedules')
    .select(
      'schedule_id, plate_number, trailer_id, reported_by_employee_id, maintenance_type, notes, due_date, created_at',
    )
    .eq('status', 'Pending')
    .order('due_date', { ascending: true })

  if (error) {
    return { schedules: [], error: error.message }
  }
  if (rows.length === 0) {
    return { schedules: [], error: null }
  }

  const trailerIds = Array.from(
    new Set(rows.filter((r) => r.trailer_id !== null).map((r) => r.trailer_id as number)),
  )
  const employeeIds = Array.from(new Set(rows.map((r) => r.reported_by_employee_id)))

  const [trailersResult, employeesResult] = await Promise.all([
    trailerIds.length > 0
      ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : Promise.resolve({ data: [] as { trailer_id: number; plate_number: string | null }[], error: null }),
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
  ])

  if (trailersResult.error) {
    return { schedules: [], error: trailersResult.error.message }
  }
  if (employeesResult.error) {
    return { schedules: [], error: employeesResult.error.message }
  }

  const trailerPlateById = new Map(trailersResult.data.map((t) => [t.trailer_id, t.plate_number]))
  const employeeNameById = new Map(employeesResult.data.map((e) => [e.employee_id, e.full_name]))

  return {
    schedules: rows.map((row) => ({
      schedule_id: row.schedule_id,
      vehicle_label: row.plate_number
        ? `Truck: ${row.plate_number}`
        : `Trailer: ${trailerPlateById.get(row.trailer_id as number) ?? `#${row.trailer_id}`}`,
      maintenance_type: row.maintenance_type,
      notes: row.notes,
      due_date: row.due_date,
      reported_by_name:
        employeeNameById.get(row.reported_by_employee_id) ??
        `Employee #${row.reported_by_employee_id}`,
      created_at: row.created_at,
    })),
    error: null,
  }
}

// Race-guarded the same way decideCashAdvanceRequest is -- only updates
// if it's still Pending, so two admins clicking "Mark Done" at once
// can't both succeed.
export async function markMaintenanceScheduleDone({
  scheduleId,
  completedByEmployeeId,
}: {
  scheduleId: number
  completedByEmployeeId: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('maintenance_schedules')
    .update({
      status: 'Completed',
      completed_by_employee_id: completedByEmployeeId,
      completed_at: new Date().toISOString(),
    })
    .eq('schedule_id', scheduleId)
    .eq('status', 'Pending')

  return { error: error?.message ?? null }
}

export type ScheduleDueTone = 'overdue' | 'soon' | 'upcoming'

export const SCHEDULE_TONE_STYLES: Record<ScheduleDueTone, string> = {
  overdue: 'bg-red-100 text-red-700',
  soon: 'bg-orange-100 text-orange-700',
  upcoming: 'bg-slate-100 text-slate-700',
}

export function formatScheduleDueDate(dueDate: string): {
  label: string
  tone: ScheduleDueTone
} {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysUntil = Math.round(
    (new Date(dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  )

  if (daysUntil < 0) {
    return { label: `Overdue by ${Math.abs(daysUntil)}d`, tone: 'overdue' }
  }
  if (daysUntil === 0) {
    return { label: 'Due today', tone: 'soon' }
  }
  if (daysUntil <= 14) {
    return { label: `Due in ${daysUntil}d`, tone: 'soon' }
  }
  return { label: `Due ${dueDate}`, tone: 'upcoming' }
}
