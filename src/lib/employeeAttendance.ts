import { supabase } from './supabaseClient'

export type AttendanceStatus = 'Present' | 'Absent' | 'Leave'

export type AttendanceRecord = {
  attendance_id: number
  employee_id: number
  employee_name: string
  attendance_date: string
  attendance_status: AttendanceStatus
  hours_worked: number | null
  notes: string | null
  // Set once a payslip used this day -- the daily roster locks such rows.
  paid_payroll_id: number | null
}

export async function loadAttendanceRecords(
  startDate: string,
  endDate: string,
): Promise<{ records: AttendanceRecord[]; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('employee_attendance')
    .select('attendance_id, employee_id, attendance_date, attendance_status, hours_worked, notes, paid_payroll_id')
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)
    .order('attendance_date', { ascending: false })

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
  const { error } = await supabase.from('employee_attendance').upsert(
    {
      employee_id: employeeId,
      attendance_date: attendanceDate,
      attendance_status: status,
      hours_worked: hoursWorked,
      notes,
      recorded_by: recordedBy,
    },
    { onConflict: 'employee_id,attendance_date' },
  )

  return { error: error?.message ?? null }
}

// Both functions below only count a day toward a payslip once --
// paid_payroll_id gets set on these rows by markAttendanceAsPaid()
// once a payslip that used them is actually issued, so a day already
// paid on an earlier payslip is excluded here even if its date falls
// inside a later (or overlapping) period.
export async function countPaidAttendanceDays(
  employeeId: number,
  startDate: string,
  endDate: string,
): Promise<{ days: number; error: string | null }> {
  const { data, error } = await supabase
    .from('employee_attendance')
    .select('attendance_status')
    .eq('employee_id', employeeId)
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)
    .in('attendance_status', ['Present', 'Leave'])
    .is('paid_payroll_id', null)

  return { days: data?.length ?? 0, error: error?.message ?? null }
}

// For Hourly-rate employees' payslips -- sums hours_worked across the
// same unpaid "Present"/"Leave" days countPaidAttendanceDays counts, so
// a day logged without hours (null) just contributes 0 instead of
// breaking the sum.
export async function sumPaidAttendanceHours(
  employeeId: number,
  startDate: string,
  endDate: string,
): Promise<{ hours: number; error: string | null }> {
  const { data, error } = await supabase
    .from('employee_attendance')
    .select('hours_worked')
    .eq('employee_id', employeeId)
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)
    .in('attendance_status', ['Present', 'Leave'])
    .is('paid_payroll_id', null)

  if (error) return { hours: 0, error: error.message }

  const hours = data.reduce((sum, row) => sum + (row.hours_worked ?? 0), 0)
  return { hours, error: null }
}

// Called by issuePayslip() right after a Daily Fixed / Monthly Salary /
// Hourly payslip is created, so those same days can never be counted
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
