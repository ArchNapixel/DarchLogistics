// CollectionsSection (Admin, Accounting -> Collections): every payment and
// refund recorded in Bills Receivable (booking_payments), newest first.
// Filter by date received, method and client; download as CSV. A wrong
// payment is VOIDED here (reason required) -- the row stays on record,
// dimmed and struck through, and stops counting toward the totals and
// toward the booking's amount paid (a DB trigger does that).
// Totals math: lib/paymentTotals.ts. Loading/saving: lib/bookingPayments.ts.
import { useEffect, useMemo, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { Link } from 'react-router-dom'
import {
  PAYMENT_METHODS,
  buildCollectionsCsv,
  loadPayments,
  openPaymentProof,
  voidBookingPayment,
  type PaymentRow,
} from '../../../lib/bookingPayments'
import { summarizePayments } from '../../../lib/paymentTotals'
import { toManilaDate } from '../../../lib/payslip'
import { promptDialog } from '../../../components/ConfirmDialog'
import PageHeader from '../../../components/PageHeader'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

function CollectionsSection() {
  const today = toManilaDate(new Date())
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [methodFilter, setMethodFilter] = useState('')
  const [clientFilter, setClientFilter] = useState('')
  const [showVoided, setShowVoided] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [voidingId, setVoidingId] = useState<number | null>(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function load() {
    // A date box can be cleared -- nothing to load then.
    if (!from || !to) return
    if (from > to) {
      setError('"From" is after "To".')
      return
    }
    setLoading(true)

    const result = await loadPayments(from, to)

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setRows(result.rows)
    setError(null)
    setLoading(false)
  }

  async function handleVoid(row: PaymentRow) {
    const reason = await promptDialog({
      title: `Void payment #${row.payment_id}`,
      message: `${formatMoney(row.amount)} from ${row.client_name} (booking #${row.booking_id}). It stays on record but stops counting, and the booking's amount paid goes back down. Why is it being voided?`,
      confirmLabel: 'Void payment',
      danger: true,
    })
    if (reason === null) return
    if (!reason.trim()) {
      setActionError('Enter a reason to void a payment.')
      return
    }

    setVoidingId(row.payment_id)
    setActionError(null)

    const voidError = await voidBookingPayment(row.payment_id, reason)

    setVoidingId(null)

    if (voidError) {
      setActionError(voidError)
      return
    }
    load()
  }

  const clients = useMemo(
    () =>
      Array.from(new Map(rows.map((r) => [r.client_id, r.client_name]))).sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [rows],
  )

  const visible = rows.filter(
    (r) =>
      (!methodFilter || r.method === methodFilter) &&
      (!clientFilter || String(r.client_id) === clientFilter) &&
      (showVoided || r.voided_at === null),
  )
  const totals = summarizePayments(visible)

  function handleDownload() {
    const csv = buildCollectionsCsv(from, to, visible)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `collections_${from}_to_${to}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const fieldClass = 'border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900'

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(visible, `${from}|${to}|${methodFilter}|${clientFilter}|${showVoided}`)
  return (
    <div>
      <PageHeader
        title="Collections"
        subtitle="Every payment and refund received, by date."
        actions={<>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="coll-from" className="text-sm font-medium text-slate-700">From</label>
          <input id="coll-from" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
          <label htmlFor="coll-to" className="text-sm font-medium text-slate-700">To</label>
          <input id="coll-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
          <select aria-label="Filter by method" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className={fieldClass}>
            <option value="">All methods</option>
            {[...PAYMENT_METHODS, 'Refund'].map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
          <select aria-label="Filter by client" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className={fieldClass}>
            <option value="">All clients</option>
            {clients.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            Show voided
          </label>
          <button
            onClick={handleDownload}
            disabled={visible.length === 0}
            className="btn-primary px-3 py-1.5 text-sm font-medium"
          >
            Download CSV
          </button>
        </div>
        </>}
      />

      {actionError && (
        <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>
      )}
      {loading && <p className="mt-4 text-slate-500">Loading payments...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <EmptyState message="No payments were received in this period." className="mt-4" />
      )}
      {!loading && !error && rows.length > 0 && visible.length === 0 && (
        <EmptyState message="No payments match these filters." className="mt-4" />
      )}

      {!loading && !error && visible.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Net collected" value={formatMoney(totals.net)} note={`${totals.count} payment${totals.count === 1 ? '' : 's'} counted`} />
            <Card label="Received" value={formatMoney(totals.received)} />
            <Card label="Refunded" value={formatMoney(totals.refunded)} />
            <div className="border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">By method</p>
              <div className="mt-1 flex flex-col gap-0.5 text-sm text-slate-700">
                {totals.byMethod.map((m) => (
                  <div key={m.method} className="flex justify-between gap-3">
                    <span>{m.method}</span>
                    <span className="font-medium text-slate-900">{formatMoney(m.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Received</th>
                  <th className="px-4 py-3 font-medium">Booking</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Reference / OR</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Recorded by</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((r) => {
                  const voided = r.voided_at !== null
                  return (
                    <tr key={r.payment_id} className={`border-b border-slate-100 ${voided ? 'bg-slate-50 text-slate-400' : ''}`}>
                      <td className="whitespace-nowrap px-4 py-3">{formatDate(r.paid_on)}</td>
                      <td className="px-4 py-3">
                        <Link to={`/dashboard/bookings?booking=${r.booking_id}`} className="hover:underline">
                          #{r.booking_id}
                        </Link>
                        {r.invoice_number && <p className="text-xs">Inv. {r.invoice_number}</p>}
                      </td>
                      <td className="px-4 py-3">{r.client_name}</td>
                      <td className="px-4 py-3">{r.method}</td>
                      <td className="px-4 py-3 text-xs">
                        {r.reference_no && <p>Ref: {r.reference_no}</p>}
                        {r.or_number && <p>OR: {r.or_number}</p>}
                        {r.note && <p>{r.note}</p>}
                        {r.proof_path && (
                          <button
                            type="button"
                            onClick={async () => {
                              const openError = await openPaymentProof(r.proof_path!)
                              if (openError) setError(openError)
                            }}
                            className="font-medium text-slate-700 underline hover:text-slate-900"
                          >
                            📎 Proof
                          </button>
                        )}
                        {!r.reference_no && !r.or_number && !r.note && !r.proof_path && '—'}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-medium ${voided ? 'line-through' : r.amount < 0 ? 'text-amber-700' : 'text-slate-900'}`}>
                        {formatMoney(r.amount)}
                      </td>
                      <td className="px-4 py-3">{r.recorded_by_name}</td>
                      <td className="px-4 py-3">
                        {voided ? (
                          <span className="text-xs">
                            Voided{r.voided_by_name ? ` by ${r.voided_by_name}` : ''}: {r.void_reason}
                          </span>
                        ) : (
                          <button
                            onClick={() => handleVoid(r)}
                            disabled={voidingId === r.payment_id}
                            className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                          >
                            {voidingId === r.payment_id ? 'Voiding...' : 'Void'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pager {...paged.pager} />
          </div>
        </>
      )}
    </div>
  )
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

export default CollectionsSection
