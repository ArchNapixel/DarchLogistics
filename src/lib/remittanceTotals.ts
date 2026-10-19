// remittanceTotals: the pure math behind Accounting -> Payroll & Remittances
// (no Supabase here, so it can be self-checked with
// `node scripts/check-remittance-totals.ts`). Data loading is in
// remittanceReport.ts.
//
// Takes the month's finalized payslips and adds them up per employee and
// overall: the government contributions (employee + employer shares) that
// have to be paid over to SSS / PhilHealth / Pag-IBIG / BIR, and what the
// payroll cost the company. All the amounts were already worked out and
// stored on each payslip (see payslip.ts / governmentContributions.ts) --
// nothing is recalculated here.

type Money = number | string | null | undefined

export type PayslipRemitRow = {
  employee_id: number
  gross_pay: Money
  cash_advance_deducted: Money
  net_pay: Money
  sss_ee: Money
  sss_er: Money
  sss_ec: Money
  philhealth_ee: Money
  philhealth_er: Money
  pagibig_ee: Money
  pagibig_er: Money
  withholding_tax: Money
}

export type RemitTotals = {
  payslips: number
  gross: number
  cash_advance_deducted: number
  net_pay: number
  sss_ee: number
  sss_er: number
  sss_ec: number
  philhealth_ee: number
  philhealth_er: number
  pagibig_ee: number
  pagibig_er: number
  withholding_tax: number
  // Employer's own shares (SSS ER + EC, PhilHealth ER, Pag-IBIG ER) -- the
  // part of the government money that is a company cost, not the employee's.
  employer_shares: number
  // gross + employer_shares: what the payroll cost the company.
  company_cost: number
}

export type EmployeeRemit = RemitTotals & { employee_id: number; name: string }

const num = (v: Money) => Number(v ?? 0)
// Money is summed as floats, so round to cents (1234.5600000001 otherwise).
const cents = (v: number) => Math.round(v * 100) / 100

function emptyTotals(): RemitTotals {
  return {
    payslips: 0,
    gross: 0,
    cash_advance_deducted: 0,
    net_pay: 0,
    sss_ee: 0,
    sss_er: 0,
    sss_ec: 0,
    philhealth_ee: 0,
    philhealth_er: 0,
    pagibig_ee: 0,
    pagibig_er: 0,
    withholding_tax: 0,
    employer_shares: 0,
    company_cost: 0,
  }
}

function addPayslip(t: RemitTotals, row: PayslipRemitRow) {
  t.payslips += 1
  t.gross += num(row.gross_pay)
  t.cash_advance_deducted += num(row.cash_advance_deducted)
  t.net_pay += num(row.net_pay)
  t.sss_ee += num(row.sss_ee)
  t.sss_er += num(row.sss_er)
  t.sss_ec += num(row.sss_ec)
  t.philhealth_ee += num(row.philhealth_ee)
  t.philhealth_er += num(row.philhealth_er)
  t.pagibig_ee += num(row.pagibig_ee)
  t.pagibig_er += num(row.pagibig_er)
  t.withholding_tax += num(row.withholding_tax)
}

function finish(t: RemitTotals): RemitTotals {
  const rounded = Object.fromEntries(
    Object.entries(t).map(([key, value]) => [key, key === 'payslips' ? value : cents(value)]),
  ) as RemitTotals
  rounded.employer_shares = cents(t.sss_er + t.sss_ec + t.philhealth_er + t.pagibig_er)
  rounded.company_cost = cents(t.gross + rounded.employer_shares)
  return rounded
}

// One entry per employee (sorted by name) plus the grand total.
export function summarizeRemittances(
  rows: PayslipRemitRow[],
  nameById: Map<number, string>,
): { employees: EmployeeRemit[]; totals: RemitTotals } {
  const byEmployee = new Map<number, RemitTotals>()
  const all = emptyTotals()

  rows.forEach((row) => {
    const t = byEmployee.get(row.employee_id) ?? emptyTotals()
    addPayslip(t, row)
    byEmployee.set(row.employee_id, t)
    addPayslip(all, row)
  })

  const employees = Array.from(byEmployee, ([employee_id, t]) => ({
    employee_id,
    name: nameById.get(employee_id) ?? `Employee #${employee_id}`,
    ...finish(t),
  })).sort((a, b) => a.name.localeCompare(b.name))

  return { employees, totals: finish(all) }
}

// What gets paid over to each agency for the month: employee share +
// employer share (+ SSS EC). BIR is just the tax withheld from pay.
export function agencyAmounts(t: RemitTotals) {
  return {
    SSS: cents(t.sss_ee + t.sss_er + t.sss_ec),
    PhilHealth: cents(t.philhealth_ee + t.philhealth_er),
    'Pag-IBIG': cents(t.pagibig_ee + t.pagibig_er),
    'BIR (withholding tax)': cents(t.withholding_tax),
  }
}

// First day of the month after "YYYY-MM" (for a >= month, < next-month range).
export function nextMonthStart(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  return mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, '0')}-01`
}
