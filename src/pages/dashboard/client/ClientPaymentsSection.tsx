// ClientPaymentsSection: the client-portal version of the payment-due
// report -- same src/lib/paymentDue.ts calculation as the admin Reports
// and Bookings pages, but scoped to just this client's own bookings
// (via the clientId argument). No client name column since it's
// obviously their own.
import { useEffect, useState } from 'react'
import {
  loadPaymentDueReport,
  formatDaysUntilDue,
  DUE_TONE_STYLES,
  type PaymentDueRow,
} from '../../../lib/paymentDue'

function ClientPaymentsSection({ clientId }: { clientId: number }) {
  const [rows, setRows] = useState<PaymentDueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load(clientId)
  }, [clientId])

  async function load(id: number) {
    setLoading(true)

    const { rows: loadedRows, error: loadError } = await loadPaymentDueReport(id)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRows(loadedRows)
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your payment schedule...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (rows.length === 0) {
    return <p className="text-slate-500">No bookings to track yet.</p>
  }

  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const due = formatDaysUntilDue(row.days_until_due)
        return (
          <div
            key={row.booking_id}
            className="rounded-xl border border-slate-200 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">
                {row.pickup_place_name} → {row.delivery_place_name}
              </p>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${DUE_TONE_STYLES[due.tone]}`}
              >
                {due.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {row.completed_trips}/{row.total_trips} trips completed ·{' '}
              {row.payment_terms}
            </p>
            <div className="mt-1 flex items-center justify-between text-sm text-slate-500">
              <span>
                Balance due: ₱{row.balance_due.toLocaleString()}
                {row.amount_paid > 0 && (
                  <span className="text-slate-400">
                    {' '}
                    (₱{row.amount_paid.toLocaleString()} already paid)
                  </span>
                )}
              </span>
              <span>
                {row.due_date ? `Due ${row.due_date}` : 'Due date TBD'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default ClientPaymentsSection
