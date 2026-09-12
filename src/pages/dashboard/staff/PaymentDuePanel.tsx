// PaymentDuePanel: simplified payment-due list shown beside the
// Bookings table -- client name, route, balance due (rate/trip x trips
// completed so far, minus anything already paid), due date, and a day
// counter, across every client. View-only: payments themselves are
// recorded in Financial Records (FinancialSection.tsx), which is also
// where the amount due can be manually overridden -- this panel already
// reflects any such override via balance_due. The full breakdown
// (contract value, completed/total trips, base date source) lives on
// the Reports page's "Payments Due" tab instead -- this is just a quick
// glance while working the main Bookings list.
import { useEffect, useState } from 'react'
import {
  loadPaymentDueReport,
  formatDaysUntilDue,
  DUE_TONE_STYLES,
  type PaymentDueRow,
} from '../../../lib/paymentDue'

function PaymentDuePanel() {
  const [rows, setRows] = useState<PaymentDueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const { rows: loadedRows, error: loadError } = await loadPaymentDueReport()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRows(loadedRows)
    setError(null)
    setLoading(false)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
        Payment Due
      </h3>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {loading && <p className="mt-3 text-sm text-slate-500">Loading...</p>}
      {!loading && rows.length === 0 && (
        <p className="mt-3 text-sm text-slate-500">
          No outstanding balances right now.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <div className="mt-3 flex max-h-[28rem] flex-col gap-2 overflow-y-auto">
          {rows.map((row) => {
            const due = formatDaysUntilDue(row.days_until_due)
            return (
              <div
                key={row.booking_id}
                className="rounded-lg bg-slate-50 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">
                    {row.client_name}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${DUE_TONE_STYLES[due.tone]}`}
                  >
                    {due.label}
                  </span>
                </div>
                <p className="mt-1 text-slate-500">
                  {row.pickup_place_name} → {row.delivery_place_name}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {row.completed_trips}/{row.total_trips} trips completed
                </p>
                <div className="mt-1 flex items-center justify-between text-slate-600">
                  <span>Balance: ₱{row.balance_due.toLocaleString()}</span>
                  <span>{row.due_date ?? 'TBD'}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default PaymentDuePanel
