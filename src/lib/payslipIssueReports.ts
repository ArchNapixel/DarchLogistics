// payslipIssueReports: shared data access for an employee flagging a
// problem with a specific payslip. Same request/resolve shape as
// cashAdvanceRequests.ts -- employee submits 'Pending', staff resolves
// it and it becomes 'Resolved'.
import { supabase } from './supabaseClient'

export type PayslipIssueStatus = 'Pending' | 'Resolved'

export type PayslipIssueReport = {
  report_id: number
  payroll_id: number
  employee_id: number
  description: string
  status: PayslipIssueStatus
  resolution_note: string | null
  resolved_at: string | null
  created_at: string
}

const REPORT_COLUMNS =
  'report_id, payroll_id, employee_id, description, status, resolution_note, resolved_at, created_at'

export async function reportPayslipIssue({
  employeeId,
  payrollId,
  description,
}: {
  employeeId: number
  payrollId: number
  description: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('payslip_issue_reports').insert({
    employee_id: employeeId,
    payroll_id: payrollId,
    description,
  })

  return { error: error?.message ?? null }
}

export async function loadPayslipIssuesForEmployee(
  employeeId: number,
): Promise<{ reports: PayslipIssueReport[]; error: string | null }> {
  const { data, error } = await supabase
    .from('payslip_issue_reports')
    .select(REPORT_COLUMNS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) {
    return { reports: [], error: error.message }
  }

  return { reports: data, error: null }
}

export type PendingPayslipIssue = PayslipIssueReport & {
  employee_name: string
  payroll_period: string
}

export async function loadPendingPayslipIssues(): Promise<{
  reports: PendingPayslipIssue[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('payslip_issue_reports')
    .select(REPORT_COLUMNS)
    .eq('status', 'Pending')
    .order('created_at', { ascending: true })

  if (error) {
    return { reports: [], error: error.message }
  }
  if (rows.length === 0) {
    return { reports: [], error: null }
  }

  const employeeIds = Array.from(new Set(rows.map((row) => row.employee_id)))
  const payrollIds = Array.from(new Set(rows.map((row) => row.payroll_id)))

  const [employeesResult, payslipsResult] = await Promise.all([
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
    supabase
      .from('payroll_payslips')
      .select('payroll_id, payroll_period_start, payroll_period_end')
      .in('payroll_id', payrollIds),
  ])

  if (employeesResult.error) {
    return { reports: [], error: employeesResult.error.message }
  }
  if (payslipsResult.error) {
    return { reports: [], error: payslipsResult.error.message }
  }

  const nameById = new Map(
    employeesResult.data.map((e) => [e.employee_id, e.full_name]),
  )
  const payslipById = new Map(
    payslipsResult.data.map((p) => [p.payroll_id, p]),
  )

  return {
    reports: rows.map((row) => {
      const payslip = payslipById.get(row.payroll_id)
      return {
        ...row,
        employee_name: nameById.get(row.employee_id) ?? `Employee #${row.employee_id}`,
        payroll_period: payslip
          ? `${payslip.payroll_period_start} – ${payslip.payroll_period_end}`
          : `#${row.payroll_id}`,
      }
    }),
    error: null,
  }
}

export async function resolvePayslipIssue({
  reportId,
  resolutionNote,
  resolvedByEmployeeId,
}: {
  reportId: number
  resolutionNote: string
  resolvedByEmployeeId: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('payslip_issue_reports')
    .update({
      status: 'Resolved',
      resolution_note: resolutionNote,
      resolved_by: resolvedByEmployeeId,
      resolved_at: new Date().toISOString(),
    })
    .eq('report_id', reportId)

  return { error: error?.message ?? null }
}
