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
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'

const TH = 'px-4 py-2.5 text-xs font-semibold tracking-[0.04em] text-ink-secondary uppercase'

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

  // Ongoing (still to pay, soonest first) and Paid in full are separate tabs,
  // 8 rows per page. (Hooks sit above the early returns.)
  const [showPaid, setShowPaid] = useState(false)
  const ongoingCards = (cards ?? []).filter((c) => c.state.key !== 'paid').toSorted((a, b) => STATE_ORDER[a.state.key] - STATE_ORDER[b.state.key])
  const paidCards = (cards ?? []).filter((c) => c.state.key === 'paid')
  const shownCards = showPaid ? paidCards : ongoingCards
  const paged = usePaged(shownCards, String(showPaid), 8)

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
        <>
          {/* Ongoing and paid-in-full bookings are kept apart. */}
          <div className="mb-4 flex gap-2">
            {[
              { label: 'Ongoing', count: ongoingCards.length, paid: false },
              { label: 'Paid in full', count: paidCards.length, paid: true },
            ].map((t) => (
              <button
                key={t.label}
                type="button"
                aria-pressed={showPaid === t.paid}
                onClick={() => setShowPaid(t.paid)}
                className={`flex h-11 items-center gap-2 rounded-[2px] border px-4 text-sm font-semibold ${
                  showPaid === t.paid ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-50'
                }`}
              >
                {t.label}
                <span className={`rounded-[2px] px-1.5 text-xs ${showPaid === t.paid ? 'bg-white text-primary' : 'bg-primary text-white'}`}>{t.count}</span>
              </button>
            ))}
          </div>

          <section aria-label="Payments" className="card">
            {shownCards.length === 0 ? (
              <p className="px-5 py-8 text-center font-semibold text-ink">
                {showPaid ? 'No bookings paid in full yet' : 'Nothing to pay right now'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm text-ink-metric">
                  <thead>
                    <tr className="border-b border-line bg-slate-100">
                      <th className={TH}>Booking</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Trips delivered</th>
                      <th className={TH}>Terms</th>
                      <th className={`${TH} text-right`}>Rate per trip</th>
                      <th className={`${TH} text-right`}>Total</th>
                      <th className={`${TH} text-right`}>Paid</th>
                      <th className={`${TH} text-right`}>Balance</th>
                      <th className={TH}>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map(({ row, reference, state }) => {
                      const style = PAYMENT_STATE_STYLES[state.key]
                      return (
                        <tr key={row.booking_id} className="border-b border-slate-200 last:border-0">
                          <td className="px-4 py-3">
                            <span className="font-semibold text-ink">#{row.booking_id}</span>
                            {reference && <span className="block font-mono text-xs text-ink-muted">{reference}</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-[2px] px-2 py-0.5 text-xs font-semibold ${style.chip}`}>{state.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            {row.completed_trips} of {row.total_trips}
                          </td>
                          <td className="px-4 py-3">{termsLabel(row.payment_terms)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{bookingRateLabel(row.trip_rates, row.rate_per_trip)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.total_contract_value)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.amount_paid)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">
                            {formatMoney(Math.max(row.balance_due, 0))}
                            {/* Each extra charge by name (damage, added charges). */}
                            {row.extra_items.map((item) => (
                              <span key={`${item.source}-${item.id}`} className="block text-xs font-normal text-ink-muted">
                                incl. {item.description} {formatMoney(item.amount)}
                              </span>
                            ))}
                          </td>
                          <td className={`px-4 py-3 font-medium ${style.foot}`}>{state.detail}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {shownCards.length > 0 && <Pager {...paged.pager} className="px-5 py-2" />}
          </section>
        </>
      )}
    </div>
  )
}

export default ClientPaymentsSection
