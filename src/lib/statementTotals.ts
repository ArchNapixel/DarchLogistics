// statementTotals: the pure math behind Accounting -> Statements of Account
// (no Supabase here, so it can be self-checked with
// `node scripts/check-statement-totals.ts`). Loading is in statement.ts.
//
// A statement is a dated ledger of what ONE client was billed and what they
// paid. Positive = the client owes more, negative = they paid.
//   - Each delivered trip bills the booking's rate on its delivery date.
//   - Adjustment: whatever else makes the booking's billable amount differ
//     from rate x delivered trips -- approved client damage charges, a
//     manual discount (amount_to_pay override), or an advance lock at the
//     full contract. One line per booking, dated its latest delivery (or
//     the booking date if nothing is delivered yet).
//   - Payments (and refunds, which are negative payments) on the date
//     received; voided payments are never passed in.
// Opening balance = everything dated before the period; closing = opening
// + the period's lines. Anything dated after the period is ignored. With
// the period ending today the closing balance equals the clients' balance
// in Bills Receivable (billable - paid, summed over their bookings).

export type StatementBooking = {
  booking_id: number
  booking_date: string
  route: string
  rate: number
  billable_amount: number // delivery (override or computed) + client damage
}

export type StatementTrip = { itinerary_id: number; booking_id: number; delivered_on: string }

export type StatementPayment = {
  payment_id: number
  booking_id: number
  amount: number // positive = received, negative = refund
  paid_on: string
  method: string
  reference_no: string | null
  or_number: string | null
}

export type StatementLine = {
  date: string
  kind: 'Trip' | 'Adjustment' | 'Payment'
  booking_id: number
  description: string
  amount: number // + billed, - paid
  balance: number // running balance after this line (period lines only)
}

// Round to cents so sums don't show 1234.5600000001.
const cents = (v: number) => Math.round(v * 100) / 100

const KIND_ORDER = { Trip: 0, Adjustment: 1, Payment: 2 } as const

export function buildStatement(
  input: {
    bookings: StatementBooking[]
    trips: StatementTrip[]
    payments: StatementPayment[]
  },
  from: string,
  to: string,
) {
  type Event = Omit<StatementLine, 'balance'> & { id: number }
  const events: Event[] = []
  const bookingById = new Map(input.bookings.map((b) => [b.booking_id, b]))

  const tripsByBooking = new Map<number, StatementTrip[]>()
  input.trips.forEach((t) => {
    tripsByBooking.set(t.booking_id, [...(tripsByBooking.get(t.booking_id) ?? []), t])
    const booking = bookingById.get(t.booking_id)
    if (!booking) return
    events.push({
      id: t.itinerary_id,
      date: t.delivered_on,
      kind: 'Trip',
      booking_id: t.booking_id,
      description: `Trip #${t.itinerary_id} delivered: ${booking.route}`,
      amount: booking.rate,
    })
  })

  input.bookings.forEach((b) => {
    const trips = tripsByBooking.get(b.booking_id) ?? []
    const adjustment = cents(b.billable_amount - b.rate * trips.length)
    if (adjustment === 0) return
    const lastDelivery = trips.map((t) => t.delivered_on).sort().pop()
    events.push({
      id: b.booking_id,
      date: lastDelivery ?? b.booking_date,
      kind: 'Adjustment',
      booking_id: b.booking_id,
      description: 'Adjustment (damage charges / discount / advance billing)',
      amount: adjustment,
    })
  })

  input.payments.forEach((p) =>
    events.push({
      id: p.payment_id,
      date: p.paid_on,
      kind: 'Payment',
      booking_id: p.booking_id,
      description:
        (p.amount < 0 ? 'Refund' : `Payment (${p.method})`) +
        (p.reference_no ? ` ref ${p.reference_no}` : '') +
        (p.or_number ? ` OR ${p.or_number}` : ''),
      amount: -p.amount,
    }),
  )

  const upToEnd = events.filter((e) => e.date <= to)
  const opening = cents(upToEnd.filter((e) => e.date < from).reduce((s, e) => s + e.amount, 0))

  let running = opening
  const lines: StatementLine[] = upToEnd
    .filter((e) => e.date >= from)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.booking_id - b.booking_id ||
        a.id - b.id,
    )
    .map(({ id: _id, ...e }) => {
      running = cents(running + e.amount)
      return { ...e, amount: cents(e.amount), balance: running }
    })

  const billed = cents(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))
  const paid = cents(-lines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0))

  return { opening, billed, paid, closing: cents(opening + billed - paid), lines }
}
