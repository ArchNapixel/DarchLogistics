// leaveRequests: shared data access for employee leave -- used by the
// employee page (employee/MyLeaveSection.tsx + RequestLeaveModal.tsx), the
// Admin queue (staff/LeaveRequestsSection.tsx) and the Dispatch Board
// (which greys out drivers/helpers who are on approved leave on a trip's
// dates).
//
// Everyone can file a request (Driver/Mechanic/Helper/Dispatcher). Only
// Admin decides (RLS: leave_requests_update_admin). Approving a
// non-driver's request also writes 'Leave' rows into employee_attendance
// so payroll pays those days. Drivers are paid per trip, so for them
// approval is just a record -- no attendance rows.
import { supabase } from './supabaseClient'
import { loadAttendanceRecords, saveAttendanceRecord } from './employeeAttendance'

export type LeaveType = 'Vacation' | 'Sick' | 'Emergency' | 'Other'
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected'

export const LEAVE_TYPES: LeaveType[] = ['Vacation', 'Sick', 'Emergency', 'Other']

// Paid leave days per calendar year (PH Service Incentive Leave minimum).
// Company-wide constant -- not stored per employee.
export const ANNUAL_PAID_LEAVE_DAYS = 5

export type LeaveRequest = {
  leave_id: number
  employee_id: number
  start_date: string
  end_date: string
  leave_type: LeaveType
  reason: string | null
  status: LeaveStatus
  decided_at: string | null
  rejection_reason: string | null
  created_at: string
}

const COLUMNS =
  'leave_id, employee_id, start_date, end_date, leave_type, reason, status, decided_at, rejection_reason, created_at'

// Hours stored for a Leave day (same default the Attendance sheet uses
// for Present; only legacy Hourly payslips read it).
const LEAVE_HOURS = 8

// ---- date helpers (plain YYYY-MM-DD strings, no timezone surprises) ----

// Every date from start to end inclusive.
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = []
  const d = new Date(`${start}T12:00:00Z`)
  const last = new Date(`${end}T12:00:00Z`)
  while (d <= last) {
    dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dates
}

// Sunday is the rest day (Weekly Salary is ÷6), so it isn't a leave day.
function isSunday(date: string): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 0
}

// Working days (Mon-Sat) a request covers.
export function leaveDayCount(start: string, end: string): number {
  return datesBetween(start, end).filter((d) => !isSunday(d)).length
}

// Do two date ranges share at least one day? `to` null = a single day.
export function rangesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  return aFrom <= (bTo ?? bFrom) && bFrom <= (aTo ?? aFrom)
}

// ---- employee side ----

export async function loadLeaveForEmployee(
  employeeId: number,
): Promise<{ requests: LeaveRequest[]; error: string | null }> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select(COLUMNS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) return { requests: [], error: error.message }
  return { requests: data as LeaveRequest[], error: null }
}

export async function submitLeaveRequest({
  employeeId,
  startDate,
  endDate,
  leaveType,
  reason,
  today,
}: {
  employeeId: number
  startDate: string
  endDate: string
  leaveType: LeaveType
  reason: string
  // Manila "today", passed in so the past-date check matches the rest of the app.
  today: string
}): Promise<{ error: string | null }> {
  if (!startDate || !endDate) return { error: 'Pick a start and end date.' }
  if (endDate < startDate) return { error: 'The end date cannot be before the start date.' }
  if (startDate < today) return { error: 'The start date cannot be in the past.' }

  // No overlapping with their own Pending/Approved requests.
  const { data: mine, error: mineError } = await supabase
    .from('leave_requests')
    .select('start_date, end_date')
    .eq('employee_id', employeeId)
    .in('status', ['Pending', 'Approved'])
    .lte('start_date', endDate)
    .gte('end_date', startDate)
  if (mineError) return { error: mineError.message }
  if (mine.length > 0) {
    return { error: 'You already have a pending or approved leave request on some of these dates.' }
  }

  const { error } = await supabase.from('leave_requests').insert({
    employee_id: employeeId,
    start_date: startDate,
    end_date: endDate,
    leave_type: leaveType,
    reason: reason || null,
  })
  return { error: error?.message ?? null }
}

// Paid days used this calendar year (approved only, Mon-Sat). Only the
// part of a request that falls inside the year counts.
export async function getLeaveDaysUsed(
  employeeId: number,
  year: number,
): Promise<{ used: number; error: string | null }> {
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`
  const { data, error } = await supabase
    .from('leave_requests')
    .select('start_date, end_date')
    .eq('employee_id', employeeId)
    .eq('status', 'Approved')
    .lte('start_date', yearEnd)
    .gte('end_date', yearStart)

  if (error) return { used: 0, error: error.message }
  const used = data.reduce(
    (sum, r) =>
      sum +
      leaveDayCount(r.start_date < yearStart ? yearStart : r.start_date, r.end_date > yearEnd ? yearEnd : r.end_date),
    0,
  )
  return { used, error: null }
}

// ---- Admin side ----

export type PendingLeaveRequest = LeaveRequest & {
  employee_name: string
  // Drivers are paid per trip -- approving doesn't touch attendance.
  is_driver: boolean
}

export async function loadPendingLeaveRequests(): Promise<{
  requests: PendingLeaveRequest[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('leave_requests')
    .select(COLUMNS)
    .eq('status', 'Pending')
    .order('start_date', { ascending: true })

  if (error) return { requests: [], error: error.message }
  if (rows.length === 0) return { requests: [], error: null }

  const ids = Array.from(new Set(rows.map((r) => r.employee_id)))
  const { data: employees, error: employeesError } = await supabase
    .from('employees')
    .select('employee_id, full_name, position')
    .in('employee_id', ids)
  if (employeesError) return { requests: [], error: employeesError.message }

  const byId = new Map(employees.map((e) => [e.employee_id, e]))
  return {
    requests: (rows as LeaveRequest[]).map((r) => ({
      ...r,
      employee_name: byId.get(r.employee_id)?.full_name ?? `Employee #${r.employee_id}`,
      is_driver: byId.get(r.employee_id)?.position === 'Driver',
    })),
    error: null,
  }
}

// Active (non-Delivered, non-Cancelled) trips this person is crewed on
// that overlap the given dates -- shown to Admin as a warning on approve.
export async function loadTripConflicts(
  employeeId: number,
  startDate: string,
  endDate: string,
): Promise<{ trips: { booking_id: number; trip_date_from: string; trip_date_to: string | null }[]; error: string | null }> {
  const { data: crew, error: crewError } = await supabase
    .from('itinerary_crews')
    .select('itinerary_id')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
  if (crewError) return { trips: [], error: crewError.message }
  if (crew.length === 0) return { trips: [], error: null }

  const { data: trips, error: tripsError } = await supabase
    .from('itineraries')
    .select('booking_id, trip_date_from, trip_date_to')
    .in('itinerary_id', crew.map((c) => c.itinerary_id))
    .not('itinerary_status', 'in', '(Delivered,Cancelled)')
  if (tripsError) return { trips: [], error: tripsError.message }

  return {
    trips: trips.filter((t) => rangesOverlap(t.trip_date_from, t.trip_date_to, startDate, endDate)),
    error: null,
  }
}

// Guarded like decideCashAdvanceRequest: only updates if still Pending, so
// two admins can't both decide it. On approve of a non-driver it then
// writes the Leave attendance rows (not one DB transaction -- if that part
// fails the request is already Approved, so the error says so).
export async function decideLeaveRequest({
  request,
  approve,
  decidedByEmployeeId,
  rejectionReason,
}: {
  request: PendingLeaveRequest
  approve: boolean
  decidedByEmployeeId: number
  rejectionReason?: string
}): Promise<{ error: string | null; alreadyDecided: boolean }> {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({
      status: approve ? 'Approved' : 'Rejected',
      decided_by: decidedByEmployeeId,
      decided_at: new Date().toISOString(),
      rejection_reason: approve ? null : rejectionReason ?? null,
    })
    .eq('leave_id', request.leave_id)
    .eq('status', 'Pending')
    .select('leave_id')
    .maybeSingle()

  if (error) return { error: error.message, alreadyDecided: false }
  if (!data) return { error: null, alreadyDecided: true }

  if (approve && !request.is_driver) {
    const { error: attendanceError } = await writeLeaveAttendance(request, decidedByEmployeeId)
    if (attendanceError) {
      return {
        error: `Leave was approved, but marking the attendance days failed (${attendanceError}). Mark those days as Leave on the Attendance page by hand.`,
        alreadyDecided: false,
      }
    }
  }
  return { error: null, alreadyDecided: false }
}

// One 'Leave' row per Mon-Sat day. Days already Present, already Leave, or
// already paid on a payslip are left alone.
async function writeLeaveAttendance(
  request: LeaveRequest,
  recordedBy: number,
): Promise<{ error: string | null }> {
  const { records, error } = await loadAttendanceRecords(request.start_date, request.end_date, request.employee_id)
  if (error) return { error }
  const existing = new Map(records.map((r) => [r.attendance_date, r]))

  for (const date of datesBetween(request.start_date, request.end_date)) {
    if (isSunday(date)) continue
    const row = existing.get(date)
    if (row && (row.paid_payroll_id !== null || row.attendance_status !== 'Absent')) continue

    const { error: saveError } = await saveAttendanceRecord({
      employeeId: request.employee_id,
      attendanceDate: date,
      status: 'Leave',
      hoursWorked: LEAVE_HOURS,
      notes: `Approved leave (${request.leave_type})`,
      recordedBy,
    })
    if (saveError) return { error: saveError }
  }
  return { error: null }
}

// ---- Dispatch Board ----

export type LeaveRange = { start_date: string; end_date: string }

// Approved leave that hasn't ended yet, grouped by employee. Pending
// requests are ignored on purpose -- they shouldn't lock someone out
// before Admin decides.
export async function loadApprovedLeave(
  today: string,
): Promise<{ byEmployee: Map<number, LeaveRange[]>; error: string | null }> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('employee_id, start_date, end_date')
    .eq('status', 'Approved')
    .gte('end_date', today)

  const byEmployee = new Map<number, LeaveRange[]>()
  if (error) return { byEmployee, error: error.message }
  for (const r of data) {
    byEmployee.set(r.employee_id, [...(byEmployee.get(r.employee_id) ?? []), r])
  }
  return { byEmployee, error: null }
}
