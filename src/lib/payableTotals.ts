// payableTotals: the pure rules behind Accounting -> Accounts Payable (no
// Supabase here, so it can be self-checked with
// `node scripts/check-payable-totals.ts`). Loading/saving is in payables.ts.
//
// A bill is what the company owes a creditor (or a one-off expense, which
// is just a bill paid the day it's entered). bills.amount_paid is kept by a
// DB trigger = sum of the bill's non-voided payments.

// Must match the CHECK constraint on bills.category in the database.
export const BILL_CATEGORIES = [
  'Fuel',
  'Parts',
  'Utilities',
  'Rent',
  'Permits & Registration',
  'Insurance',
  'Tolls',
  'Office',
  'Other',
] as const

export type BillStatus = 'Unpaid' | 'Partial' | 'Paid' | 'Voided'

type Money = number | string | null

export type BillLike = {
  amount: Money
  amount_paid: Money
  due_date: string | null
  voided_at: string | null
}

const num = (v: Money) => Number(v ?? 0)
// Round to cents so sums don't show 1234.5600000001.
const cents = (v: number) => Math.round(v * 100) / 100

export function billRemaining(bill: BillLike): number {
  return cents(num(bill.amount) - num(bill.amount_paid))
}

export function billStatus(bill: BillLike): BillStatus {
  if (bill.voided_at) return 'Voided'
  const paid = num(bill.amount_paid)
  if (paid >= num(bill.amount)) return 'Paid'
  return paid > 0 ? 'Partial' : 'Unpaid'
}

// Still owed and the due date has passed (today itself isn't overdue).
export function isOverdue(bill: BillLike, today: string): boolean {
  const status = billStatus(bill)
  return (status === 'Unpaid' || status === 'Partial') && !!bill.due_date && bill.due_date < today
}

// Done in UTC so the date can't shift a day in Manila (UTC+8).
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// Totals for the cards at the top of the page: everything still owed,
// the overdue part, and what falls due in the next 7 days.
export function summarizeOpenBills(bills: BillLike[], today: string) {
  const weekAhead = addDays(today, 7)
  let open = 0
  let overdue = 0
  let dueSoon = 0
  let count = 0
  bills.forEach((b) => {
    const status = billStatus(b)
    if (status !== 'Unpaid' && status !== 'Partial') return
    const remaining = billRemaining(b)
    count += 1
    open += remaining
    if (isOverdue(b, today)) overdue += remaining
    else if (b.due_date && b.due_date <= weekAhead) dueSoon += remaining
  })
  return { count, open: cents(open), overdue: cents(overdue), dueSoon: cents(dueSoon) }
}
