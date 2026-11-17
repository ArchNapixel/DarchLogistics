import { supabase } from './supabaseClient'


// 'Leave' = PAID leave (payroll pays it like Present). 'Unpaid Leave' =
// approved leave beyond the yearly paid balance (lib/leaveRequests.ts) --
// shown as leave, but payroll doesn't pay it (only Present/Leave count).
export type AttendanceStatus = 'Present' | 'Absent' | 'Leave' | 'Unpaid Leave'

// What a day with NO attendance row shows as: a finished Mon-Sat day =
// Absent; Sunday is a rest day (can still be marked, but never auto-Absent);
// today / future = not marked yet. Display only -- payroll just pays rows.
export function unrecordedStatus(date: string, today: string): 'Absent' | null {
  const sunday = new Date(`${date}T12:00:00Z`).getUTCDay() === 0
  return date < today && !sunday ? 'Absent' : null
}

export type AttendanceRecord = {
  attendance_id: number
  employee_id: number
  employee_name: string
  attendance_date: string
  attendance_status: AttendanceStatus
  // 8 on a Present day (only legacy Hourly payslips read it).
  hours_worked: number | null
  notes: string | null
  // Set once a payslip used this day -- the daily roster locks such rows.
  paid_payroll_id: number | null
}

export async function loadAttendanceRecords(
  startDate: string,
  endDate: string,
  // Only this employee's rows (the "My Attendance" page)
  onlyEmployeeId?: number,
): Promise<{ records: AttendanceRecord[]; error: string | null }> {
  let query = supabase
    .from('employee_attendance')
    .select('attendance_id, employee_id, attendance_date, attendance_status, hours_worked, notes, paid_payroll_id')
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)
    .order('attendance_date', { ascending: false })
  if (onlyEmployeeId !== undefined) query = query.eq('employee_id', onlyEmployeeId)
  const { data: rows, error } = await query

  if (error) return { records: [], error: error.message }
  if (!rows || rows.length === 0) return { records: [], error: null }

  const employeeIds = Array.from(new Set(rows.map((row) => row.employee_id)))
  const { data: employees, error: employeesError } = await supabase
    .from('employees')
    .select('employee_id, full_name')
    .in('employee_id', employeeIds)

  if (employeesError) return { records: [], error: employeesError.message }

  const names = new Map((employees ?? []).map((employee) => [employee.employee_id, employee.full_name]))
  return {
    records: rows.map((row) => ({
      ...row,
      employee_name: names.get(row.employee_id) ?? `Employee #${row.employee_id}`,
      attendance_status: row.attendance_status as AttendanceStatus,
    })),
    error: null,
  }
}

export async function saveAttendanceRecord({
  employeeId,
  attendanceDate,
  status,
  hoursWorked,
  notes,
  recordedBy,
}: {
  employeeId: number
  attendanceDate: string
  status: AttendanceStatus
  hoursWorked: number | null
  notes: string | null
  recordedBy: number
}): Promise<{ error: string | null }> {
  const row = {
    employee_id: employeeId,
    attendance_date: attendanceDate,
    attendance_status: status,
    hours_worked: hoursWorked,
    notes,
    recorded_by: recordedBy,
  }
  const { error } = await supabase
    .from('employee_attendance')
    .upsert(row, { onConflict: 'employee_id,attendance_date' })

  return { error: error?.message ?? null }
}

// Called by issuePayslip() right after a Weekly Salary payslip is
// created, so those same days can never be counted
// again on a future payslip -- the attendance equivalent of how a
// Commission Per Trip payslip's trips get excluded via
// payslip_line_items.itinerary_id.
export async function markAttendanceAsPaid(
  employeeId: number,
  startDate: string,
  endDate: string,
  payrollId: number,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('employee_attendance')
    .update({ paid_payroll_id: payrollId })
    .eq('employee_id', employeeId)
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)
    .in('attendance_status', ['Present', 'Leave'])
    .is('paid_payroll_id', null)

  return { error: error?.message ?? null }
}
