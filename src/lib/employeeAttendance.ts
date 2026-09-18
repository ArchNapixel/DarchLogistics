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
}

export async function loadAttendanceRecords(
  startDate: string,
  endDate: string,
): Promise<{ records: AttendanceRecord[]; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('employee_attendance')
    .select('attendance_id, employee_id, attendance_date, attendance_status, hours_worked, notes')
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

  return { days: data?.length ?? 0, error: error?.message ?? null }
}
