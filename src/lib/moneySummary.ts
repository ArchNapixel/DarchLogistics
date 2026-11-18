// moneySummary: the monthly summary for Expenses -> Money Summary --
// revenue, expenses, net profit (earned / spent / left in the code), and
// the expenses breakdown.
// Pure functions (self-check: node scripts/check-money-summary.ts); the
// numbers come from loadProfitLoss() (lib/profitLoss.ts), so they always
// match the rest of the app. Supplier bills are left out on purpose
// (Accounts Payable is hidden for now).

import { csvField } from './csv.ts'

export type MoneySummaryInput = {
  earned: number // trips delivered this month x rate, plus adjustments
  // Per booking: revenue this month and its client (grouped by client below).
  // client_id groups the rows (two clients can share a name); old rows
  // without one group by name.
  revenueRows: { client_id?: number | null; client_name: string; amount: number }[]
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
  revenueByClient: { key: string; label: string; amount: number }[]
}

// The grouping key for one client: its id, else (no id) its name.
export const clientKey = (r: { client_id?: number | null; client_name: string }) =>
  r.client_id != null ? `id:${r.client_id}` : `name:${r.client_name}`

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
  const byClient = new Map<string, { label: string; amount: number }>()
  input.revenueRows.forEach((r) => {
    const key = clientKey(r)
    const row = byClient.get(key) ?? { label: r.client_name, amount: 0 }
    row.amount += r.amount
    byClient.set(key, row)
  })
  const revenueByClient = Array.from(byClient, ([key, r]) => ({ key, label: r.label, amount: cents(r.amount) }))
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

// Money in / Money out: cash that actually moved this month (loaded by
// loadCashFlow in lib/cashFlow.ts). Not profit -- a cash advance given is
// money out but not an expense, a repayment is money in but not revenue.
export type CashFlowInput = {
  clientPayments: number // booking_payments received (non-voided, > 0), by paid_on
  repayments: number // cash advances paid back outside payroll, by paid_on
  refunds: number // booking_payments refunds (positive number), by paid_on
  salariesPaid: number // net pay of payslips paid this month
  // Money actually sent to SSS / PhilHealth / Pag-IBIG / BIR this month
  // (government_remittances by paid_on) -- the shares withheld from pay
  // stay in the company's cash until they're remitted.
  remittances: number
  advancesGiven: number // Approved cash advances, by issued_at
  dieselEstimated: number // distance x diesel price of trips delivered this month
  tripExpenses: number // crew-logged fuel top-ups / tolls / parking / other
  stockBought: number // inventory received x its price
  // The company's share of damage decided this month (Company in full,
  // Insurance minus what the insurer covers -- the insurer pays the client /
  // repair shop directly, so its part never passes through us).
  companyDamage: number
}

export type CashFlow = {
  moneyIn: { label: string; amount: number }[]
  moneyOut: { label: string; amount: number }[]
  totalIn: number
  totalOut: number
  net: number
}

export function buildCashFlow(input: CashFlowInput): CashFlow {
  const moneyIn = [
    { label: 'Client payments', amount: cents(input.clientPayments) },
    { label: 'Cash advances paid back', amount: cents(input.repayments) },
  ]
  const moneyOut = [
    { label: 'Salaries paid (net pay)', amount: cents(input.salariesPaid) },
    { label: 'Government remittances (SSS / PhilHealth / Pag-IBIG / BIR)', amount: cents(input.remittances) },
    { label: 'Cash advances given', amount: cents(input.advancesGiven) },
    { label: 'Diesel', amount: cents(input.dieselEstimated) },
    { label: 'Trip expenses (incl. extra fuel)', amount: cents(input.tripExpenses) },
    { label: 'Parts / stock bought', amount: cents(input.stockBought) },
    { label: 'Damage we paid for', amount: cents(input.companyDamage) },
    { label: 'Refunds to clients', amount: cents(input.refunds) },
  ]
  const totalIn = cents(moneyIn.reduce((sum, l) => sum + l.amount, 0))
  const totalOut = cents(moneyOut.reduce((sum, l) => sum + l.amount, 0))
  return { moneyIn, moneyOut, totalIn, totalOut, net: cents(totalIn - totalOut) }
}

// "▲ 12% vs last month". null when last month was 0 (no base to compare to).
export function pctChange(now: number, before: number): number | null {
  if (before === 0) return null
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10
}

export const AGENCIES = ['SSS', 'PhilHealth', 'Pag-IBIG', 'BIR'] as const
export type Agency = (typeof AGENCIES)[number]

// Due (from finalized payslips) vs remitted, per agency.
export function remittanceStatus(due: Record<Agency, number>, paid: Record<Agency, number>) {
  return AGENCIES.map((agency) => {
    const left = cents(due[agency] - paid[agency])
    return {
      agency,
      due: cents(due[agency]),
      paid: cents(paid[agency]),
      left,
      state: due[agency] === 0 && paid[agency] === 0 ? 'none' : left <= 0 ? 'remitted' : paid[agency] > 0 ? 'partly' : 'not yet',
    } as const
  })
}

// Revenue by client next to what that client paid this month (any booking).
export function billedVsCollected(
  revenue: { key: string; label: string; amount: number }[],
  collected: { client_id?: number | null; client_name: string; amount: number }[],
): { label: string; billed: number; collected: number }[] {
  const map = new Map<string, { label: string; billed: number; collected: number }>()
  revenue.forEach((r) => map.set(r.key, { label: r.label, billed: r.amount, collected: 0 }))
  collected.forEach((c) => {
    const key = clientKey(c)
    const row = map.get(key) ?? { label: c.client_name, billed: 0, collected: 0 }
    row.collected += c.amount
    map.set(key, row)
  })
  return Array.from(map.values(), (v) => ({ label: v.label, billed: cents(v.billed), collected: cents(v.collected) }))
    .filter((r) => r.billed !== 0 || r.collected !== 0)
    .sort((a, b) => b.billed - a.billed || b.collected - a.collected || a.label.localeCompare(b.label))
}

// One CSV cell: quoted when it holds a comma, quote or line break.

// The Money Summary page as a CSV file ("Export"): the totals, how the net
// is worked out, and revenue per client. Amounts are plain numbers (no ₱ or
// commas) so a spreadsheet can add them up.
export function buildMoneySummaryCsv(month: string, summary: MoneySummary, cashFlow?: CashFlow | null): string {
  const flowRows: (string | number)[][] = cashFlow
    ? [
        [],
        ['Money in', 'Amount'],
        ...cashFlow.moneyIn.map((l) => [l.label, l.amount]),
        ['Total money in', cashFlow.totalIn],
        [],
        ['Money out', 'Amount'],
        ...cashFlow.moneyOut.map((l) => [l.label, l.amount]),
        ['Total money out', cashFlow.totalOut],
        [],
        ['Net money movement', cashFlow.net],
      ]
    : []
  const rows: (string | number)[][] = [
    [`Darch Logistics Financial Summary - ${monthLabel(month)}`],
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
    ...flowRows,
  ]
  return rows.map((cells) => cells.map(csvField).join(',')).join('\n')
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
