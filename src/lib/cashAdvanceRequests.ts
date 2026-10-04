// cashAdvanceRequests: shared data access for employee-requested cash
// advances -- used by the employee-side request form/list
// (employee/MyCashAdvanceRequestsSection.tsx) and the staff-side
// approval view (staff/CashAdvanceRequestsSection.tsx).
//
// cash_advances now has a `status` column (added specifically for this
// feature -- migration run directly in Supabase, default 'Approved' so
// every existing row and every future admin direct-issue insert from
// IssueCashAdvanceModal.tsx, which still never sets status itself,
// lands as already-approved with no code change there). A row an
// employee requests here is inserted as 'Pending' instead.
//
// IMPORTANT: payslip.ts's getOutstandingCashAdvance() must only count
// 'Approved' rows -- a 'Pending' request hasn't actually been given to
// the employee yet, so it must not inflate what gets deducted from
// their next payslip.
import { supabase } from './supabaseClient'
import { getOutstandingCashAdvance } from './payslip'

export type CashAdvanceStatus = 'Pending' | 'Approved' | 'Rejected'

export type CashAdvanceRequest = {
  cash_advance_id: number
  employee_id: number
  amount: number
  note: string | null
  status: CashAdvanceStatus
  created_at: string
  approved_at: string | null
  rejection_reason: string | null
}

const REQUEST_COLUMNS =
  'cash_advance_id, employee_id, amount, note, status, created_at, approved_at, rejection_reason'

export async function requestCashAdvance({
  employeeId,
  amount,
  reason,
}: {
  employeeId: number
  amount: number
  reason: string
}): Promise<{ error: string | null }> {
  // One advance at a time: no new request until the current one is repaid.
  const owed = await getOutstandingCashAdvance(employeeId)
  if (owed.error) return { error: owed.error }
  if (owed.outstanding > 0) {
    return {
      error: `You still owe ₱${owed.outstanding.toLocaleString()} on your current cash advance. You can request again once it's fully paid.`,
    }
  }

  const { error } = await supabase.from('cash_advances').insert({
    employee_id: employeeId,
    amount,
    note: reason,
    status: 'Pending',
  })

  return { error: error?.message ?? null }
}

export async function loadCashAdvanceRequestsForEmployee(
  employeeId: number,
): Promise<{ requests: CashAdvanceRequest[]; error: string | null }> {
  const { data, error } = await supabase
    .from('cash_advances')
    .select(REQUEST_COLUMNS)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) {
    return { requests: [], error: error.message }
  }

  return { requests: data, error: null }
}

// The four ledger totals (same math as the cards on the Cash Advance
// page's ledger), used by the Admin dashboard.
export async function loadCashAdvanceTotals(): Promise<{
  totals: { pending: number; issued: number; deducted: number; current: number }
  error: string | null
}> {
  const [advances, payslips] = await Promise.all([
    supabase.from('cash_advances').select('amount, status'),
    supabase.from('payroll_payslips').select('cash_advance_deducted'),
  ])
  const failed = advances.error ?? payslips.error
  if (failed) {
    return { totals: { pending: 0, issued: 0, deducted: 0, current: 0 }, error: failed.message }
  }

  const sumByStatus = (status: string) =>
    advances.data.filter((a) => a.status === status).reduce((sum, a) => sum + Number(a.amount), 0)
  const issued = sumByStatus('Approved')
  const deducted = payslips.data.reduce((sum, p) => sum + Number(p.cash_advance_deducted ?? 0), 0)

  return {
    totals: { pending: sumByStatus('Pending'), issued, deducted, current: Math.max(0, issued - deducted) },
    error: null,
  }
}

export type PendingCashAdvanceRequest =CashAdvanceRequest & {
  employee_name: string
}

export async function loadPendingCashAdvanceRequests(): Promise<{
  requests: PendingCashAdvanceRequest[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('cash_advances')
    .select(REQUEST_COLUMNS)
    .eq('status', 'Pending')
    .order('created_at', { ascending: true })

  if (error) {
    return { requests: [], error: error.message }
  }
  if (rows.length === 0) {
    return { requests: [], error: null }
  }

  const employeeIds = Array.from(new Set(rows.map((row) => row.employee_id)))
  const { data: employees, error: employeesError } = await supabase
    .from('employees')
    .select('employee_id, full_name')
    .in('employee_id', employeeIds)

  if (employeesError) {
    return { requests: [], error: employeesError.message }
  }

  const nameById = new Map(employees.map((e) => [e.employee_id, e.full_name]))

  return {
    requests: rows.map((row) => ({
      ...row,
      employee_name: nameById.get(row.employee_id) ?? `Employee #${row.employee_id}`,
    })),
    error: null,
  }
}

// Guarded the same way TaskBoard.tsx's "accept" is: the WHERE clause
// only matches if the row is STILL Pending at the moment of the update,
// so two staff members deciding the same request at nearly the same
// time can't both succeed. .select().maybeSingle() tells us whether it
// actually matched -- if not, someone else already decided it.
export async function decideCashAdvanceRequest({
  cashAdvanceId,
  approve,
  approvedByEmployeeId,
  rejectionReason,
}: {
  cashAdvanceId: number
  approve: boolean
  approvedByEmployeeId: number
  rejectionReason?: string
}): Promise<{ error: string | null; alreadyDecided: boolean }> {
  const { data, error } = await supabase
    .from('cash_advances')
    .update({
      status: approve ? 'Approved' : 'Rejected',
      approved_by: approvedByEmployeeId,
      approved_at: new Date().toISOString(),
      rejection_reason: approve ? null : rejectionReason ?? null,
    })
    .eq('cash_advance_id', cashAdvanceId)
    .eq('status', 'Pending')
    .select('cash_advance_id')
    .maybeSingle()

  if (error) {
    return { error: error.message, alreadyDecided: false }
  }

  return { error: null, alreadyDecided: !data }
}
