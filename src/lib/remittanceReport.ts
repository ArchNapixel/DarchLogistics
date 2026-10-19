// remittanceReport: loads a month's payslips for Accounting -> Payroll &
// Remittances and builds its CSV. The adding-up is in remittanceTotals.ts
// (self-checked); this file only fetches and formats.
//
// A payslip belongs to the month of its payroll_period_end (same rule as
// the monthly contribution split in payslip.ts). Only FINALIZED payslips
// count -- drafts can still change -- but how many drafts are waiting is
// returned so the page can warn that the month isn't complete yet.
import { supabase } from './supabaseClient'
import { toManilaDate } from './payslip'
import { csvField } from './inventoryReport'
import {
  agencyAmounts,
  nextMonthStart,
  summarizeRemittances,
  type EmployeeRemit,
  type PayslipRemitRow,
  type RemitTotals,
} from './remittanceTotals'

export function currentRemittanceMonth(): string {
  return toManilaDate(new Date()).slice(0, 7)
}

const COLUMNS =
  'employee_id, gross_pay, cash_advance_deducted, net_pay, sss_ee, sss_er, sss_ec, philhealth_ee, philhealth_er, pagibig_ee, pagibig_er, withholding_tax'

export async function loadRemittanceReport(month: string): Promise<{
  employees: EmployeeRemit[]
  totals: RemitTotals
  draftCount: number
  error: string | null
}> {
  const empty = { employees: [], totals: summarizeRemittances([], new Map()).totals, draftCount: 0 }
  const from = `${month}-01`
  const to = nextMonthStart(month)

  // ponytail: one request returns at most 1000 rows -- fine for a few
  // hundred employees x ~5 weekly payslips; page with .range() past that.
  const [finalizedResult, draftResult] = await Promise.all([
    supabase
      .from('payroll_payslips')
      .select(COLUMNS)
      .gte('payroll_period_end', from)
      .lt('payroll_period_end', to)
      .not('finalized_at', 'is', null),
    supabase
      .from('payroll_payslips')
      .select('payroll_id', { count: 'exact', head: true })
      .gte('payroll_period_end', from)
      .lt('payroll_period_end', to)
      .is('finalized_at', null),
  ])

  if (finalizedResult.error) return { ...empty, error: finalizedResult.error.message }
  if (draftResult.error) return { ...empty, error: draftResult.error.message }

  const rows = finalizedResult.data as PayslipRemitRow[]
  const employeeIds = Array.from(new Set(rows.map((r) => r.employee_id)))

  const { data: employeeRows, error: employeeError } =
    employeeIds.length > 0
      ? await supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds)
      : { data: [], error: null }
  if (employeeError) return { ...empty, error: employeeError.message }

  const nameById = new Map((employeeRows ?? []).map((e) => [e.employee_id, e.full_name as string]))
  const { employees, totals } = summarizeRemittances(rows, nameById)

  return { employees, totals, draftCount: draftResult.count ?? 0, error: null }
}

// Plain numbers (no ₱ / thousands separators) so the CSV opens as
// numbers in Excel.
export function buildRemittanceCsv(
  month: string,
  employees: EmployeeRemit[],
  totals: RemitTotals,
): string {
  const lines: string[] = []
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvField).join(','))

  row([`Payroll & Remittances - ${month} (finalized payslips)`])
  lines.push('')

  row(['To remit to'])
  Object.entries(agencyAmounts(totals)).forEach(([agency, amount]) => row([agency, amount]))
  lines.push('')

  row([
    'Employee', 'Payslips', 'Gross Pay', 'Cash Advance Deducted', 'Net Pay',
    'SSS EE', 'SSS ER', 'SSS EC', 'PhilHealth EE', 'PhilHealth ER',
    'Pag-IBIG EE', 'Pag-IBIG ER', 'Withholding Tax', 'Employer Shares', 'Company Cost',
  ])
  const line = (name: string, t: RemitTotals) =>
    row([
      name, t.payslips, t.gross, t.cash_advance_deducted, t.net_pay,
      t.sss_ee, t.sss_er, t.sss_ec, t.philhealth_ee, t.philhealth_er,
      t.pagibig_ee, t.pagibig_er, t.withholding_tax, t.employer_shares, t.company_cost,
    ])
  employees.forEach((e) => line(e.name, e))
  line('TOTAL', totals)

  return lines.join('\n')
}
