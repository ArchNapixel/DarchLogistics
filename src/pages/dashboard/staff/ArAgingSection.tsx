// ArAgingSection (Admin, Accounting -> AR Aging): what every client owes,
// sorted by how overdue it is. Read-only -- payments are recorded in Bills
// Receivable (FinancialSection.tsx). Balances and due dates come from
// lib/paymentDue.ts (same numbers as the Payments Due tab), the bucketing
// from lib/arAging.ts. Click a client to see the bookings behind their total.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  loadPaymentDueReport,
  formatDaysUntilDue,
  DUE_TONE_STYLES,
  type PaymentDueRow,
} from '../../../lib/paymentDue'
import { AGING_BUCKETS, summarizeAging, type AgingBucket, type ClientAging } from '../../../lib/arAging'

type ClientRow = ClientAging<PaymentDueRow>

function formatMoney(value: number): string {
  return value === 0 ? '—' : `₱${value.toLocaleString()}`
}

// Colors per bucket so the further overdue, the louder it reads.
const BUCKET_TEXT: Record<AgingBucket, string> = {
  Current: 'text-slate-900',
  '1–30': 'text-amber-700',
  '31–60': 'text-orange-700',
  '61–90': 'text-red-700',
  '90+': 'text-red-800',
  'No due date': 'text-slate-500',
}

function ArAgingSection() {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [totals, setTotals] = useState<Record<AgingBucket, number> | null>(null)
  const [grandTotal, setGrandTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openClientId, setOpenClientId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const { rows, error: loadError } = await loadPaymentDueReport()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    const summary = summarizeAging(rows)
    setClients(summary.clients)
    setTotals(summary.totals)
    setGrandTotal(summary.grandTotal)
    setError(null)
    setLoading(false)
  }

  // Only show the "No due date" column when something is actually in it.
  const buckets = AGING_BUCKETS.filter((b) => b !== 'No due date' || (totals?.[b] ?? 0) > 0)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-900">AR Aging</h2>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Unpaid balances grouped by days past their due date, as of today.
      </p>

      {loading && <p className="mt-4 text-slate-500">Loading balances...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && clients.length === 0 && (
        <p className="mt-4 text-slate-500">No client owes anything right now.</p>
      )}

      {!loading && !error && totals && clients.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total owed</p>
              <p className="mt-1 text-lg font-bold text-slate-900">₱{grandTotal.toLocaleString()}</p>
            </div>
            {buckets.map((bucket) => (
              <div key={bucket} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {bucket === 'Current' || bucket === 'No due date' ? bucket : `${bucket} days`}
                </p>
                <p
                  className={`mt-1 text-lg font-bold ${totals[bucket] > 0 ? BUCKET_TEXT[bucket] : 'text-slate-400'}`}
                >
                  ₱{totals[bucket].toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Client</th>
                  {buckets.map((bucket) => (
                    <th key={bucket} className="whitespace-nowrap px-4 py-3 text-right font-medium">
                      {bucket}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const open = openClientId === client.client_id
                  return (
                    <ClientRows
                      key={client.client_id}
                      client={client}
                      buckets={buckets}
                      open={open}
                      onToggle={() => setOpenClientId(open ? null : client.client_id)}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function ClientRows({
  client,
  buckets,
  open,
  onToggle,
}: {
  client: ClientRow
  buckets: AgingBucket[]
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className="border-b border-slate-100 last:border-0">
        <td className="px-4 py-3">
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="font-medium text-slate-900 hover:underline"
          >
            {open ? '▾' : '▸'} {client.client_name}
          </button>
        </td>
        {buckets.map((bucket) => (
          <td key={bucket} className={`px-4 py-3 text-right ${BUCKET_TEXT[bucket]}`}>
            {formatMoney(client.buckets[bucket])}
          </td>
        ))}
        <td className="px-4 py-3 text-right font-semibold text-slate-900">
          ₱{client.total.toLocaleString()}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={buckets.length + 2} className="px-4 py-3">
            <div className="flex flex-col gap-2">
              {client.bookings.map((booking) => {
                const due = formatDaysUntilDue(booking.days_until_due)
                return (
                  <div
                    key={booking.booking_id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <Link
                      to={`/dashboard/bookings?booking=${booking.booking_id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      Booking #{booking.booking_id}
                    </Link>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-600">{booking.due_date ?? 'No due date'}</span>
                      <span className={`px-2.5 py-1 text-xs font-semibold ${DUE_TONE_STYLES[due.tone]}`}>
                        {due.label}
                      </span>
                      <span className="font-medium text-slate-900">
                        ₱{booking.balance_due.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default ArAgingSection
