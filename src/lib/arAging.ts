// arAging: sorts what clients owe into "how overdue is it" buckets for the
// AR Aging page (Accounting -> AR Aging). Pure math only -- the rows come
// from loadPaymentDueReport() in paymentDue.ts, which already works out
// each booking's balance_due and days_until_due. Self-check:
//   node scripts/check-ar-aging.ts
//
// Buckets go by days PAST the due date:
//   Current = not due yet, or due today
//   1-30 / 31-60 / 61-90 / 90+ = that many days overdue
//   No due date = a balance with no date to count from (no delivered trip
//   and no preferred date on the quote) -- shown so it isn't hidden.
// Only positive balances count; fully paid or overpaid (refund) bookings
// are left out.

export const AGING_BUCKETS = ['Current', '1–30', '31–60', '61–90', '90+', 'No due date'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

export function agingBucket(daysUntilDue: number | null): AgingBucket {
  if (daysUntilDue === null) return 'No due date'
  const daysOverdue = -daysUntilDue
  if (daysOverdue <= 0) return 'Current'
  if (daysOverdue <= 30) return '1–30'
  if (daysOverdue <= 60) return '31–60'
  if (daysOverdue <= 90) return '61–90'
  return '90+'
}

// The few PaymentDueRow fields this needs (kept narrow so the self-check
// script doesn't have to build full rows).
export type AgingInputRow = {
  booking_id: number
  client_id: number
  client_name: string
  balance_due: number
  days_until_due: number | null
}

// Generic so the page gets its full PaymentDueRow back (due_date etc.).
export type ClientAging<T extends AgingInputRow = AgingInputRow> = {
  client_id: number
  client_name: string
  buckets: Record<AgingBucket, number>
  total: number
  bookings: (T & { bucket: AgingBucket })[]
}

function emptyBuckets(): Record<AgingBucket, number> {
  return Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>
}

// One entry per client that owes something, biggest total first, plus the
// grand total per bucket across everyone.
export function summarizeAging<T extends AgingInputRow>(
  rows: T[],
): { clients: ClientAging<T>[]; totals: Record<AgingBucket, number>; grandTotal: number } {
  const byClient = new Map<number, ClientAging<T>>()
  const totals = emptyBuckets()
  let grandTotal = 0

  rows
    .filter((row) => row.balance_due > 0)
    .forEach((row) => {
      const bucket = agingBucket(row.days_until_due)
      const client = byClient.get(row.client_id) ?? {
        client_id: row.client_id,
        client_name: row.client_name,
        buckets: emptyBuckets(),
        total: 0,
        bookings: [],
      }
      client.buckets[bucket] += row.balance_due
      client.total += row.balance_due
      client.bookings.push({ ...row, bucket })
      byClient.set(row.client_id, client)

      totals[bucket] += row.balance_due
      grandTotal += row.balance_due
    })

  const clients = Array.from(byClient.values()).sort((a, b) => b.total - a.total)
  // Most overdue booking first inside each client (null dates last).
  clients.forEach((c) =>
    c.bookings.sort((a, b) => (a.days_until_due ?? Infinity) - (b.days_until_due ?? Infinity)),
  )

  return { clients, totals, grandTotal }
}
