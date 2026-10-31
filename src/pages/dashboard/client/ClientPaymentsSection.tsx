// ClientPaymentsSection: the client portal's Payments page (the canvas's
// Client Payments boards). Three tiles (balance due, next payment due,
// bookings paid in full), then one card per booking: its state (Downpayment
// due / Downpayment paid / Overdue / Paid in full -- lib/clientPaymentState.ts),
// trips delivered, terms, rate, total, balance, and what's due when.
//
// Same src/lib/paymentDue.ts calculation as the admin pages, scoped to this
// client's own bookings (fully paid ones included), via loadClientPaymentCards
// in lib/clientPortal.ts.
import { useEffect, useState } from 'react'
import { loadClientPaymentCards, type PaymentCard } from '../../../lib/clientPortal'
import { PAYMENT_STATE_STYLES, type PaymentStateKey } from '../../../lib/clientPaymentState'
import { PAYMENT_TERMS_LABELS } from '../../../lib/quoteRequest'
import { formatDaysUntilDue } from '../../../lib/paymentDue'
import { formatMoney, formatDate } from '../../../lib/format'
import { bookingRateLabel } from '../../../lib/lineRates'

// Card order: what needs paying first, settled bookings last.
const STATE_ORDER: Record<PaymentStateKey, number> = { overdue: 0, downpaymentDue: 1, due: 2, none: 3, paid: 4 }

const termsLabel =(terms: string) => PAYMENT_TERMS_LABELS[terms as keyof typeof PAYMENT_TERMS_LABELS] ?? terms

function ClientPaymentsSection({ clientId }: { clientId: number }) {
  const [cards, setCards] = useState<PaymentCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadClientPaymentCards(clientId).then(({ cards: loaded, error: loadError }) => {
      if (cancelled) return
      setCards(loaded)
      setError(loadError)
    })
    return () => {
      cancelled = true
    }
  }, [clientId])

  if (error) return <p className="text-red-700">{error}</p>
  if (!cards) return <p className="text-ink-muted">Loading your payments...</p>

  const owing = cards.filter((c) => c.row.balance_due > 0)
  const totalDue = owing.reduce((sum, c) => sum + c.row.balance_due, 0)
  const overdue = cards.filter((c) => c.state.key === 'overdue').length
  // Rows come sorted soonest-due first from lib/paymentDue.ts.
  const nextDue = owing.find((c) => c.row.due_date !== null)
  const paidInFull = cards.filter((c) => c.state.key === 'paid').length

  const tiles = [
    {
      label: 'Balance due',
      value: formatMoney(totalDue),
      note: overdue > 0 ? `${overdue} overdue` : totalDue > 0 ? 'Not overdue' : 'Paid up',
      noteClass: overdue > 0 ? 'text-red-700' : 'text-green-800',
    },
    {
      label: 'Next payment due',
      value: nextDue?.row.due_date ? formatDate(nextDue.row.due_date) : 'None',
      note: nextDue ? formatDaysUntilDue(nextDue.row.days_until_due, nextDue.row.balance_due).label : '',
      noteClass: 'text-ink-muted',
    },
    {
      label: 'Bookings paid in full',
      value: String(paidInFull),
      note: `of ${cards.length}`,
      noteClass: 'text-ink-muted',
    },
  ]

  return (
    <div>
      <section aria-label="Summary" className="mb-4 grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="card px-[18px] py-3.5">
            <p className="text-sm font-medium text-ink-secondary">{tile.label}</p>
            <p className="text-[28px] leading-9 font-bold tracking-[-0.01em] text-ink tabular-nums">{tile.value}</p>
            {tile.note && <p className={`text-[13px] font-medium ${tile.noteClass}`}>{tile.note}</p>}
          </div>
        ))}
      </section>

      {cards.length === 0 ? (
        <div className="card px-5 py-8 text-center">
          <p className="font-semibold text-ink">No bookings to pay for yet.</p>
          <p className="mt-1 text-[13px] text-ink-muted">A booking shows here once you accept one of our offers.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {/* Unpaid first (stable sort: each group keeps its soonest-due order). */}
          {cards.toSorted((a, b) => STATE_ORDER[a.state.key] - STATE_ORDER[b.state.key]).map(({ row, reference, state }) => {
            const style = PAYMENT_STATE_STYLES[state.key]
            return (
              <article key={row.booking_id} aria-labelledby={`pc-${row.booking_id}`} className="card flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
                  <h2 id={`pc-${row.booking_id}`} className="text-base font-semibold text-ink">
                    Booking #{row.booking_id}
                    {reference && <span className="ml-2 font-mono text-[13px] font-medium text-ink-muted">{reference}</span>}
                  </h2>
                  <span className={`rounded-[2px] px-2 py-0.5 text-xs font-semibold ${style.chip}`}>{state.label}</span>
                </div>
                <dl className="grid flex-1 grid-cols-2 gap-x-5 gap-y-3 px-5 py-4 text-sm">
                  <div>
                    <dt className="text-[13px] font-medium text-ink-muted">Trips delivered</dt>
                    <dd className="font-semibold text-ink">
                      {row.completed_trips} of {row.total_trips}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[13px] font-medium text-ink-muted">Terms</dt>
                    <dd className="font-semibold text-ink">{termsLabel(row.payment_terms)}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] font-medium text-ink-muted">Rate per trip</dt>
                    <dd className="font-semibold text-ink tabular-nums">{bookingRateLabel(row.trip_rates, row.rate_per_trip)}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] font-medium text-ink-muted">Total</dt>
                    {/* every trip's rate added up; the balance below is what's billed so far */}
                    <dd className="font-semibold text-ink tabular-nums">{formatMoney(row.total_contract_value)}</dd>
                  </div>
                  <div className="col-span-2 border-t border-slate-200 pt-3">
                    <dt className="text-[13px] font-medium text-ink-muted">Balance</dt>
                    <dd className="text-xl font-bold text-ink tabular-nums">{formatMoney(Math.max(row.balance_due, 0))}</dd>
                    {row.amount_paid > 0 && <dd className="text-[13px] text-ink-muted">{formatMoney(row.amount_paid)} paid so far</dd>}
                    {row.damage_charges > 0 && (
                      <dd className="text-[13px] text-ink-muted">Includes {formatMoney(row.damage_charges)} extra charges (damage, added charges)</dd>
                    )}
                  </div>
                </dl>
                <p className={`border-t border-line px-5 py-3 text-sm font-medium ${style.foot}`}>{state.detail}</p>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ClientPaymentsSection
