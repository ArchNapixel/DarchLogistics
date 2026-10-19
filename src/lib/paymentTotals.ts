// paymentTotals: the pure math for Accounting -> Collections (no Supabase
// here, so it can be self-checked with `node scripts/check-payment-totals.ts`).
//
// Voided payments never count -- they stay in the list for the audit trail
// but are skipped here. A refund is a payment with a negative amount.

export type SummablePayment = {
  amount: number
  method: string
  voided_at: string | null
}

// Round to cents so sums don't show 1234.5600000001.
const cents = (v: number) => Math.round(v * 100) / 100

export function summarizePayments(payments: SummablePayment[]) {
  let received = 0
  let refunded = 0
  let count = 0
  const byMethod = new Map<string, number>()

  payments
    .filter((p) => p.voided_at === null)
    .forEach((p) => {
      count += 1
      if (p.amount >= 0) received += p.amount
      else refunded += -p.amount
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount)
    })

  return {
    received: cents(received),
    refunded: cents(refunded),
    net: cents(received - refunded),
    count,
    // Net per method (refunds reduce the 'Refund' line), biggest first.
    byMethod: Array.from(byMethod, ([method, amount]) => ({ method, amount: cents(amount) })).sort(
      (a, b) => b.amount - a.amount,
    ),
  }
}
