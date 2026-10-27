// moneySummary: the monthly summary for Expenses -> Money Summary --
// revenue, expenses, net profit (earned / spent / left in the code), and
// the expenses breakdown.
// Pure functions (self-check: node scripts/check-money-summary.ts); the
// numbers come from loadProfitLoss() (lib/profitLoss.ts), so they always
// match the rest of the app. Supplier bills are left out on purpose
// (Accounts Payable is hidden for now).

export type MoneySummaryInput = {
  earned: number // trips delivered this month x rate, plus adjustments
  // Per booking: revenue this month and its client (grouped by client below).
  revenueRows: { client_name: string; amount: number }[]
  collected: number // money actually received this month
  tripCount: number
  salaries: number // payroll gross + employer SSS/PhilHealth/Pag-IBIG
  diesel: number
  tripExpenses: number // tolls, parking, other crew-logged costs
  repairs: number // maintenance parts used
  damage: number // damage the company paid for
}

export type MoneySummary = {
  earned: number
  spent: number
  left: number
  collected: number
  tripCount: number
  // Where the money went, biggest first, zero lines left out.
  spending: { label: string; amount: number }[]
  // Where the money came from: revenue per client, biggest first, zero left out.
  revenueByClient: { label: string; amount: number }[]
}

const cents = (n: number) => Math.round(n * 100) / 100

export function buildMoneySummary(input: MoneySummaryInput): MoneySummary {
  const spending = [
    { label: 'Salaries', amount: input.salaries },
    { label: 'Diesel', amount: input.diesel },
    { label: 'Trip expenses', amount: input.tripExpenses },
    { label: 'Truck repairs', amount: input.repairs },
    { label: 'Damage we paid for', amount: input.damage },
  ]
    .map((line) => ({ ...line, amount: cents(line.amount) }))
    .filter((line) => line.amount !== 0)
    .sort((a, b) => b.amount - a.amount)
  const earned = cents(input.earned)
  const spent = cents(spending.reduce((sum, line) => sum + line.amount, 0))
  const byClient = new Map<string, number>()
  input.revenueRows.forEach((r) => byClient.set(r.client_name, (byClient.get(r.client_name) ?? 0) + r.amount))
  const revenueByClient = Array.from(byClient, ([label, amount]) => ({ label, amount: cents(amount) }))
    .filter((line) => line.amount !== 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
  return {
    earned,
    revenueByClient,
    spent,
    left: cents(earned - spent),
    collected: cents(input.collected),
    tripCount: input.tripCount,
    spending,
  }
}

// One CSV cell: quoted when it holds a comma, quote or line break.
function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// The Money Summary page as a CSV file ("Export"): the totals, how the net
// is worked out, and revenue per client. Amounts are plain numbers (no ₱ or
// commas) so a spreadsheet can add them up.
export function buildMoneySummaryCsv(month: string, summary: MoneySummary): string {
  const rows: (string | number)[][] = [
    [`Darch Logistics Money Summary - ${monthLabel(month)}`],
    [],
    ['Totals', 'Amount'],
    ['Revenue', summary.earned],
    ['Collected', summary.collected],
    ['Expenses', summary.spent],
    [summary.left < 0 ? 'Net loss' : 'Net profit', summary.left],
    ['Delivered trips', summary.tripCount],
    [],
    ['Expenses breakdown', 'Amount'],
    ...summary.spending.map((s) => [s.label, s.amount]),
    [],
    ['Revenue by client', 'Amount'],
    ...summary.revenueByClient.map((r) => [r.label, r.amount]),
  ]
  return rows.map((cells) => cells.map(csvCell).join(',')).join('\n')
}

// "2026-10" moved by `delta` months -> "2026-11" / "2026-09".
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// "2026-10" -> "October 2026".
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
