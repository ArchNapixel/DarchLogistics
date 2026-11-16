// cashAdvanceLedger: loads every employee's cash advance log for Finance ->
// Cash Advance Ledger, and records / voids repayments (money paid back
// outside payroll). The log math is in lib/cashAdvanceLedgerTotals.ts.
// Reads: cash_advances (Approved), payroll_payslips (deduction > 0),
// cash_advance_repayments, employees. Writes ONLY through the RPCs
// record_cash_advance_repayment / void_cash_advance_repayment.
import { supabase } from './supabaseClient'
import { fetchAll, fetchIn } from './dashboardExpenses'
import { buildEmployeeLedger, type EmployeeLedger, type LedgerEntry } from './cashAdvanceLedgerTotals'
import { formatDate } from './format'
import { csvField } from './inventoryReport'

export const REPAYMENT_METHODS = ['Cash', 'GCash', 'Bank Transfer', 'Check', 'Other'] as const
export type RepaymentMethod = (typeof REPAYMENT_METHODS)[number]
// Mirrors the DB check cash_advance_repayments_reference_required.
export const repaymentNeedsReference = (method: RepaymentMethod) =>
  method === 'GCash' || method === 'Bank Transfer' || method === 'Check'

export type EmployeeCashAdvance = EmployeeLedger & {
  employee_id: number
  name: string
  position: string
  // Deductions on payslips not finalized yet -- not in the log or the
  // balance, but payroll already counts them as taken.
  draftDeducted: number
}

export async function loadCashAdvanceLedger(): Promise<{ employees: EmployeeCashAdvance[]; error: string | null }> {
  const [advances, payslips, repayments] = await Promise.all([
    fetchAll<{ cash_advance_id: number; employee_id: number; amount: number; issued_at: string; note: string | null }>(
      (from, to) =>
        supabase
          .from('cash_advances')
          .select('cash_advance_id, employee_id, amount, issued_at, note')
          .eq('status', 'Approved')
          .order('cash_advance_id')
          .range(from, to),
    ),
    fetchAll<{
      payroll_id: number
      employee_id: number
      payroll_period_start: string
      payroll_period_end: string
      cash_advance_deducted: number
      finalized_at: string | null
    }>((from, to) =>
      supabase
        .from('payroll_payslips')
        .select('payroll_id, employee_id, payroll_period_start, payroll_period_end, cash_advance_deducted, finalized_at')
        .gt('cash_advance_deducted', 0)
        .order('payroll_id')
        .range(from, to),
    ),
    fetchAll<{
      repayment_id: number
      employee_id: number
      amount: number
      paid_on: string
      method: string
      reference_no: string | null
      note: string | null
      voided_at: string | null
      void_reason: string | null
    }>((from, to) =>
      supabase
        .from('cash_advance_repayments')
        .select('repayment_id, employee_id, amount, paid_on, method, reference_no, note, voided_at, void_reason')
        .order('repayment_id')
        .range(from, to),
    ),
  ])
  const error = advances.error ?? payslips.error ?? repayments.error
  if (error) return { employees: [], error }

  const entries = new Map<number, LedgerEntry[]>()
  const drafts = new Map<number, number>()
  const add = (employeeId: number, entry: LedgerEntry) => {
    const list = entries.get(employeeId) ?? []
    list.push(entry)
    entries.set(employeeId, list)
  }

  for (const a of advances.rows) {
    add(a.employee_id, {
      kind: 'issued',
      id: a.cash_advance_id,
      date: a.issued_at,
      amount: Number(a.amount),
      label: a.note ? `Cash advance issued — ${a.note}` : 'Cash advance issued',
    })
  }
  for (const p of payslips.rows) {
    const amount = Number(p.cash_advance_deducted)
    if (!p.finalized_at) {
      drafts.set(p.employee_id, (drafts.get(p.employee_id) ?? 0) + amount)
      continue
    }
    add(p.employee_id, {
      kind: 'deducted',
      id: p.payroll_id,
      date: p.payroll_period_end,
      amount,
      label: `Payslip deduction — week ${formatDate(p.payroll_period_start)} – ${formatDate(p.payroll_period_end)}`,
    })
  }
  for (const r of repayments.rows) {
    const details = [r.method, r.reference_no && `Ref ${r.reference_no}`, r.note].filter(Boolean).join(' · ')
    add(r.employee_id, {
      kind: 'repaid',
      id: r.repayment_id,
      date: r.paid_on,
      amount: Number(r.amount),
      label: r.voided_at
        ? `Paid back (voided: ${r.void_reason ?? 'no reason'}) — ${details}`
        : `Paid back — ${details}`,
      voided: r.voided_at !== null,
    })
  }

  // Only people who ever had an approved advance are in the ledger.
  const ids = [...new Set(advances.rows.map((a) => a.employee_id))]
  const people = await fetchIn<{ employee_id: number; full_name: string; position: string | null }>(ids, (chunk, from, to) =>
    supabase.from('employees').select('employee_id, full_name, position').in('employee_id', chunk).range(from, to),
  )
  if (people.error) return { employees: [], error: people.error }
  const byId = new Map(people.rows.map((p) => [p.employee_id, p]))

  const employees = ids
    .map((id) => ({
      ...buildEmployeeLedger(entries.get(id) ?? []),
      employee_id: id,
      name: byId.get(id)?.full_name ?? `Employee #${id}`,
      position: byId.get(id)?.position ?? '',
      draftDeducted: drafts.get(id) ?? 0,
    }))
    .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name))
  return { employees, error: null }
}

// Error text, or null when saved.
export async function recordCashAdvanceRepayment(args: {
  employeeId: number
  amount: number
  paidOn: string
  method: RepaymentMethod
  referenceNo: string
  note: string
}): Promise<string | null> {
  const { error } = await supabase.rpc('record_cash_advance_repayment', {
    p_employee_id: args.employeeId,
    p_amount: args.amount,
    p_paid_on: args.paidOn,
    p_method: args.method,
    p_reference_no: args.referenceNo.trim() || null,
    p_note: args.note.trim() || null,
  })
  return error?.message ?? null
}

export async function voidCashAdvanceRepayment(repaymentId: number, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('void_cash_advance_repayment', {
    p_repayment_id: repaymentId,
    p_reason: reason,
  })
  return error?.message ?? null
}

const KIND_LABEL = { issued: 'Issued', deducted: 'Payslip deduction', repaid: 'Paid back' } as const

// One employee's log as CSV (dates YYYY-MM-DD, plain numbers).
export function buildLedgerCsv(employee: EmployeeCashAdvance): string {
  const header = ['Date', 'Type', 'Details', 'Added', 'Deducted / paid back', 'Balance', 'Voided']
  const lines = employee.lines.map((l) =>
    [
      l.date,
      KIND_LABEL[l.kind],
      l.label,
      l.kind === 'issued' ? l.amount.toFixed(2) : '',
      l.kind === 'issued' ? '' : l.amount.toFixed(2),
      l.balance.toFixed(2),
      l.voided ? 'Yes' : '',
    ]
      .map(csvField)
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}
