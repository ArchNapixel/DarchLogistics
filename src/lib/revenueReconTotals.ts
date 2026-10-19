// revenueReconTotals: the pure math behind Accounting -> Revenue
// Reconciliation (no Supabase here, so it can be self-checked with
// `node scripts/check-revenue-recon-totals.ts`). Loading is in
// revenueReconciliation.ts.
//
// Takes the month's lines from the Statement of Account ledger
// (statementTotals.ts, all clients together) and splits them into:
//   trip revenue = delivered trips x rate (what Trip Profitability counts)
//   adjustments  = damage charges / discounts / advance billing
//   collected    = payments received minus refunds
// and works out, per booking, why billed and collected differ.
// Opening receivable + trip revenue + adjustments - collected = closing
// receivable, always.
import type { StatementLine } from './statementTotals.ts'

export type BookingMeta = {
  client_name: string
  balance_due: number
  total_trips: number
  completed_trips: number
}

export type ReconRow = {
  booking_id: number
  client_name: string
  trip_revenue: number
  adjustments: number
  collected: number
  // trip revenue + adjustments - collected: positive = billed more than collected.
  difference: number
  reason: string
}

// Round to cents so sums don't show 1234.5600000001.
const cents = (v: number) => Math.round(v * 100) / 100

export function reconcileRevenue(lines: StatementLine[], meta: Map<number, BookingMeta>) {
  const byBooking = new Map<number, { trip: number; adj: number; collected: number }>()
  lines.forEach((l) => {
    const row = byBooking.get(l.booking_id) ?? { trip: 0, adj: 0, collected: 0 }
    if (l.kind === 'Trip') row.trip += l.amount
    else if (l.kind === 'Adjustment') row.adj += l.amount
    else row.collected -= l.amount // payment lines are negative; a refund is positive
    byBooking.set(l.booking_id, row)
  })

  const rows: ReconRow[] = Array.from(byBooking, ([booking_id, r]) => {
    const info = meta.get(booking_id)
    const difference = cents(r.trip + r.adj - r.collected)
    let reason = 'Matches'
    if (difference > 0) {
      reason = (info?.balance_due ?? 0) > 0 ? 'Not fully paid yet' : 'Paid in another month'
    } else if (difference < 0) {
      reason =
        info && info.completed_trips < info.total_trips ? 'Paid ahead of delivery' : 'Paying earlier months'
    }
    return {
      booking_id,
      client_name: info?.client_name ?? '—',
      trip_revenue: cents(r.trip),
      adjustments: cents(r.adj),
      collected: cents(r.collected),
      difference,
      reason,
    }
  }).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.booking_id - b.booking_id)

  const sum = (pick: (r: ReconRow) => number) => cents(rows.reduce((s, r) => s + pick(r), 0))
  return {
    rows,
    tripRevenue: sum((r) => r.trip_revenue),
    adjustments: sum((r) => r.adjustments),
    collected: sum((r) => r.collected),
    difference: sum((r) => r.difference),
  }
}
