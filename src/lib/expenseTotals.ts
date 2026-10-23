// expenseTotals.ts: the pure math behind the Admin dashboard's Operational
// and Maintenance expense cards (no Supabase here, so it can be
// self-checked with `node scripts/check-expense-totals.ts`).
// The data loading lives in dashboardExpenses.ts.

// Same one-liner as toManilaDate() in payslip.ts, copied here because that
// file imports the Supabase client, which a plain-node self-check can't load.
const toManilaDate = (value: Date) =>
  value.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

// What one payslip costs the COMPANY: gross pay plus the employer's
// government shares (SSS ER + EC, PhilHealth ER, Pag-IBIG ER). Gross, not
// net: net is after cash-advance and employee deductions, which would
// understate the cost -- and a cash advance is a loan, not an expense.
// Driver commission and the per-trip fee are already inside gross_pay.
export type PayslipCostRow = {
  gross_pay: number | string | null
  sss_er: number | string | null
  sss_ec: number | string | null
  philhealth_er: number | string | null
  pagibig_er: number | string | null
}

const num = (v: number | string | null | undefined) => Number(v ?? 0)

export function payslipCost(row: PayslipCostRow) {
  const gross = num(row.gross_pay)
  const employerShares =
    num(row.sss_er) + num(row.sss_ec) + num(row.philhealth_er) + num(row.pagibig_er)
  return { gross, employerShares, total: gross + employerShares }
}

// A period: a number of whole months OR a number of days back from today
// (Admin dashboard), or one calendar month 'yyyy-mm' (Money Summary).
export type Period = { months: number } | { days: number } | { month: string }

const pad = (n: number) => String(n).padStart(2, '0')

// First day of the period as 'yyyy-mm-dd' in Manila time.
//  - days: "last N days" INCLUDING today, so 7 days = today and the 6 before.
//  - months: `months` back from today, with the day clamped so Mar 31 minus
//    1 month is Feb 28/29 (not Mar 3, which setMonth() would give).
//  - month: the 1st of that month.
export function rangeStartManila(period: Period, now: Date = new Date()): string {
  if ('month' in period) return `${period.month}-01`
  const [year, month, day] = toManilaDate(now).split('-').map(Number)
  if ('days' in period) {
    const start = new Date(Date.UTC(year, month - 1, day - (period.days - 1)))
    return `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`
  }
  const index = year * 12 + (month - 1) - period.months
  const startYear = Math.floor(index / 12)
  const startMonth = (index % 12) + 1
  const daysInMonth = new Date(startYear, startMonth, 0).getDate()
  return `${startYear}-${pad(startMonth)}-${pad(Math.min(day, daysInMonth))}`
}

// The day AFTER the period's last day ('yyyy-mm-dd', Manila), for `< end`
// filters: tomorrow for the dashboard periods (they run up to today), the
// 1st of the next month for a calendar month.
export function rangeEndManila(period: Period, now: Date = new Date()): string {
  const [year, month, day] =
    'month' in period
      ? [...period.month.split('-').map(Number), 0]
      : toManilaDate(now).split('-').map(Number)
  const end =
    'month' in period
      ? new Date(Date.UTC(year, month, 1))
      : new Date(Date.UTC(year, month - 1, day + 1))
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
}

export type PartLine = {
  item_name: string
  item_type: string
  quantity: number | string
  // null = the part has no price on record: counted as 0 but flagged
  unit_cost: number | string | null
}

export type TypeCost = { type: string; cost: number }
export type ItemCost = { name: string; type: string; quantity: number; cost: number }

export function summarizeParts(lines: PartLine[]) {
  const byType = new Map<string, number>()
  const byItem = new Map<string, ItemCost>()
  let total = 0
  let unpricedLines = 0

  for (const line of lines) {
    const quantity = num(line.quantity)
    if (line.unit_cost === null) unpricedLines += 1
    const cost = quantity * num(line.unit_cost)
    total += cost
    byType.set(line.item_type, (byType.get(line.item_type) ?? 0) + cost)
    const key = `${line.item_type}|${line.item_name}`
    const item = byItem.get(key) ?? {
      name: line.item_name,
      type: line.item_type,
      quantity: 0,
      cost: 0,
    }
    item.quantity += quantity
    item.cost += cost
    byItem.set(key, item)
  }

  return {
    total,
    unpricedLines,
    byType: Array.from(byType, ([type, cost]): TypeCost => ({ type, cost })).sort(
      (a, b) => b.cost - a.cost,
    ),
    topItems: Array.from(byItem.values())
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5),
  }
}
