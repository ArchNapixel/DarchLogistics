// QuoteWarnings: two advisory banners at the top of Review Quote (nothing
// here blocks pricing, offering or rejecting):
//   - "Similar quote" -- the same client already has another open quote or an
//     approved one on the same pickup / delivery barangays within 2 days of
//     this pickup date (a likely duplicate, e.g. submitted twice).
//   - "Client owes us" -- the client is flagged delinquent
//     (client_delinquency_log) and/or has an overdue balance (Payments Due).
// Both need the quote's client_id, so quotes logged for a brand-new client
// (no client row yet) show nothing. A failed lookup also shows nothing: these
// are hints, not rules.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { formatDate, formatMoney } from '../../../lib/format'
import { loadCurrentlyDelinquentClients } from '../../../lib/clientDelinquency'
import { loadPaymentDueReport } from '../../../lib/paymentDue'
import { addDays } from '../../../lib/offerTiming'

// How many days either side of the pickup date count as "the same day".
const SIMILAR_DAYS = 2

type Similar = { quote_request_id: number; label: string; status: string; pickup: string; booking_id: number | null }
type Owing = { overdue: number; oldestDays: number; delinquentSince: string | null; reason: string | null }

function QuoteWarnings({
  quoteId,
  clientId,
  clientName,
  pickupBarangay,
  deliveryBarangay,
  pickupDate,
}: {
  quoteId: number
  clientId: number | null
  clientName: string
  pickupBarangay: string | null
  deliveryBarangay: string | null
  pickupDate: string | null
}) {
  const [similar, setSimilar] = useState<Similar[]>([])
  const [owing, setOwing] = useState<Owing | null>(null)

  useEffect(() => {
    if (clientId === null) return
    let cancelled = false

    async function load() {
      // Similar quotes: same client, same barangays, pickup within +-2 days.
      if (pickupBarangay && deliveryBarangay && pickupDate) {
        const { data: quotes } = await supabase
          .from('quote_requests')
          .select('quote_request_id, reference_code, request_status, preferred_pickup_date')
          .eq('client_id', clientId)
          .neq('quote_request_id', quoteId)
          .eq('pickup_barangay', pickupBarangay)
          .eq('delivery_barangay', deliveryBarangay)
          .in('request_status', ['Pending', 'Offered', 'Countered', 'Approved'])
          .gte('preferred_pickup_date', addDays(pickupDate, -SIMILAR_DAYS))
          .lte('preferred_pickup_date', addDays(pickupDate, SIMILAR_DAYS))
        const approvedIds = (quotes ?? []).filter((q) => q.request_status === 'Approved').map((q) => q.quote_request_id)
        const { data: bookings } = approvedIds.length
          ? await supabase.from('bookings').select('booking_id, quote_request_id').in('quote_request_id', approvedIds)
          : { data: [] as { booking_id: number; quote_request_id: number }[] }
        const bookingByQuote = new Map((bookings ?? []).map((b) => [b.quote_request_id, b.booking_id]))
        if (!cancelled) {
          setSimilar(
            (quotes ?? []).map((q) => ({
              quote_request_id: q.quote_request_id,
              label: q.reference_code ?? `#${q.quote_request_id}`,
              status: q.request_status,
              pickup: q.preferred_pickup_date,
              booking_id: bookingByQuote.get(q.quote_request_id) ?? null,
            })),
          )
        }
      }

      // Delinquent flag + overdue balance.
      const [delinquent, dues] = await Promise.all([loadCurrentlyDelinquentClients(), loadPaymentDueReport(clientId as number)])
      if (cancelled) return
      const flag = delinquent.clients.find((c) => c.client_id === clientId)
      const overdueRows = dues.rows.filter((r) => r.balance_due > 0 && r.days_until_due !== null && r.days_until_due < 0)
      const overdue = overdueRows.reduce((sum, r) => sum + r.balance_due, 0)
      setOwing(
        flag || overdue > 0
          ? {
              overdue,
              oldestDays: Math.max(0, ...overdueRows.map((r) => -(r.days_until_due as number))),
              delinquentSince: flag?.since ?? null,
              reason: flag?.reason ?? null,
            }
          : null,
      )
    }

    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [quoteId, clientId, pickupBarangay, deliveryBarangay, pickupDate])

  if (similar.length === 0 && !owing) return null
  return (
    <>
      {similar.length > 0 && (
        <div className="border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <p className="font-semibold">Similar quote from {clientName}: same route, pickup within {SIMILAR_DAYS} days</p>
          <ul className="mt-1">
            {similar.map((s) => (
              <li key={s.quote_request_id}>
                {s.label} · {s.status === 'Approved' ? `booking${s.booking_id ? ` #${s.booking_id}` : ' created'}` : s.status.toLowerCase()} ·
                pickup {formatDate(s.pickup)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {owing && (
        <div className="border-2 border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-900">
          <p className="font-semibold">
            {clientName}
            {owing.delinquentSince ? ' is flagged delinquent' : ' has an overdue balance'}
            {owing.overdue > 0 && ` · ${formatMoney(owing.overdue)} overdue (oldest ${owing.oldestDays} ${owing.oldestDays === 1 ? 'day' : 'days'})`}
          </p>
          {owing.delinquentSince && (
            <p className="mt-0.5">
              Flagged {formatDate(owing.delinquentSince)}
              {owing.reason ? `: ${owing.reason}` : ''}
            </p>
          )}
        </div>
      )}
    </>
  )
}

export default QuoteWarnings
