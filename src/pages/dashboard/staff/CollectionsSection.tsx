// CollectionsSection (Admin, Accounting -> Collections): every payment and
// refund recorded in Bills Receivable (booking_payments), newest first.
// Filter by date received, method and client; download as CSV. A wrong
// payment is VOIDED here (reason required) -- the row stays on record,
// dimmed and struck through, and stops counting toward the totals and
// toward the booking's amount paid (a DB trigger does that).
// Totals math: lib/paymentTotals.ts. Loading/saving: lib/bookingPayments.ts.
import { useEffect, useMemo, useState } from 'react'
import { usePaged } from '../../../lib/usePaged'
import { Link, useNavigate } from 'react-router-dom'
import { loadPaymentDueReport, type PaymentDueRow } from '../../../lib/paymentDue'
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
  const [search, setSearch] = useState('')
  // "Record Payment" panel: bookings that still owe something.
  const navigate = useNavigate()
  const [owing, setOwing] = useState<PaymentDueRow[]>([])
  const [payBookingId, setPayBookingId] = useState('')
  useEffect(() => {
    let cancelled = false
    loadPaymentDueReport().then(({ rows: due }) => {
      if (!cancelled) setOwing(due.filter((r) => r.balance_due > 0).sort((a, b) => b.booking_id - a.booking_id))
    })
    return () => {
      cancelled = true
    }
  }, [])

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
      (showVoided || r.voided_at === null) &&
      (!search.trim() ||
        [`#${r.booking_id}`, String(r.booking_id), r.reference_no ?? '', r.or_number ?? '', r.invoice_number ?? '']
          .join(' ')
          .toLowerCase()
          .includes(search.trim().toLowerCase().replace(/^#/, ''))),
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

  const fieldClass =
    'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'
  const filterLabel = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
  const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
  const TD = 'px-2 py-2 first:pl-5 last:pr-5'
  const payBooking = owing.find((r) => String(r.booking_id) === payBookingId) ?? null

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(visible, `${from}|${to}|${methodFilter}|${clientFilter}|${showVoided}|${search}`)
  return (
    <div>
      <PageHeader
        title="Collections"
        subtitle="Every payment received from clients, full or partial, and every refund."
        actions={
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-medium text-ink-secondary">
              Collected, {formatDate(from)} – {formatDate(to)}
            </span>
            <span className="text-2xl leading-8 font-bold text-ink tabular-nums">{formatMoney(totals.net)}</span>
          </div>
        }
      />

      {actionError && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className={filterLabel}>
              From
              <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
            </label>
            <label className={filterLabel}>
              To
              <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
            </label>
            <label className={filterLabel}>
              Method
              <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className={`${fieldClass} w-40`}>
                <option value="">All methods</option>
                {[...PAYMENT_METHODS, 'Refund'].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterLabel}>
              Client
              <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className={`${fieldClass} w-44`}>
                <option value="">All clients</option>
                {clients.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={filterLabel}>
              Search
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Booking or reference no."
                className={`${fieldClass} w-56 font-normal placeholder:text-ink-muted`}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-ink-secondary">
              <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} className="h-5 w-5 accent-primary" />
              Show voided
            </label>
          </div>

          <section aria-label="Payments received" className="card flex min-h-[calc(100dvh-17rem)] flex-col">
            {loading ? (
              <p className="p-5 text-ink-muted">Loading payments...</p>
            ) : error ? (
              <p className="p-5 text-red-700">{error}</p>
            ) : rows.length === 0 ? (
              <EmptyState message="No payments were received in this period." className="m-5" />
            ) : visible.length === 0 ? (
              <EmptyState message="No payments match these filters." className="m-5" />
            ) : (
              <div className="flex-1 overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm text-ink-metric">
                  <thead>
                    <tr>
                      <th className={TH}>Date</th>
                      <th className={TH}>Client</th>
                      <th className={TH}>Booking</th>
                      <th className={TH}>Reference No.</th>
                      <th className={TH}>Method</th>
                      <th className={`${TH} text-right`}>Amount</th>
                      <th className={TH}>Recorded by</th>
                      <th className={TH}>
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((r) => {
                      const voided = r.voided_at !== null
                      return (
                        <tr key={r.payment_id} className={`h-[60px] border-b border-slate-200 ${voided ? 'bg-slate-50 text-ink-muted' : ''}`}>
                          <td className={`${TD} whitespace-nowrap`}>{formatDate(r.paid_on)}</td>
                          <td className={`${TD} font-semibold`}>{r.client_name}</td>
                          <td className={TD}>
                            <Link to={`/dashboard/bookings?booking=${r.booking_id}`} className="font-semibold text-primary hover:underline">
                              Booking #{r.booking_id}
                            </Link>
                            {r.invoice_number && <span className="block text-[13px] text-ink-muted">Inv. {r.invoice_number}</span>}
                          </td>
                          <td className={`${TD} text-[13px]`}>
                            {r.reference_no && <span className="block">Ref: {r.reference_no}</span>}
                            {r.or_number && <span className="block">OR: {r.or_number}</span>}
                            {r.note && <span className="block text-ink-muted">{r.note}</span>}
                            {r.proof_path && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const openError = await openPaymentProof(r.proof_path!)
                                  if (openError) setError(openError)
                                }}
                                className="font-semibold text-primary underline"
                              >
                                📎 Proof
                              </button>
                            )}
                            {!r.reference_no && !r.or_number && !r.note && !r.proof_path && '—'}
                          </td>
                          <td className={TD}>{r.method}</td>
                          <td
                            className={`${TD} text-right font-semibold whitespace-nowrap tabular-nums ${
                              voided ? 'line-through' : r.amount < 0 ? 'text-amber-800' : ''
                            }`}
                          >
                            {formatMoney(r.amount)}
                          </td>
                          <td className={TD}>{r.recorded_by_name}</td>
                          <td className={TD}>
                            {voided ? (
                              <span className="text-[13px]">
                                Voided{r.voided_by_name ? ` by ${r.voided_by_name}` : ''}: {r.void_reason}
                              </span>
                            ) : (
                              <button
                                onClick={() => handleVoid(r)}
                                disabled={voidingId === r.payment_id}
                                className="btn-danger px-4 text-sm"
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
              </div>
            )}
            <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
              <span>
                {paged.pager.pageCount > 1
                  ? `Page ${paged.pager.page + 1} of ${paged.pager.pageCount}`
                  : `${totals.count} ${totals.count === 1 ? 'payment' : 'payments'} counted`}
              </span>
              <span className="flex flex-wrap gap-2">
                <button onClick={handleDownload} disabled={visible.length === 0} className="btn-secondary px-4 text-sm font-medium">
                  Download CSV
                </button>
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                  disabled={paged.pager.page === 0}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                  disabled={paged.pager.page >= paged.pager.pageCount - 1}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  Next ›
                </button>
              </span>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <aside aria-labelledby="rp-h" className="card flex flex-col">
            <div className="border-b border-line px-5 py-4">
              <h2 id="rp-h" className="text-lg leading-[26px] font-bold text-ink">
                Record Payment
              </h2>
            </div>
            <div className="flex flex-col gap-4 px-5 py-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-secondary">
                Booking
                <select value={payBookingId} onChange={(e) => setPayBookingId(e.target.value)} className={fieldClass}>
                  <option value="">Select a booking with a balance</option>
                  {owing.map((r) => (
                    <option key={r.booking_id} value={r.booking_id}>
                      #{r.booking_id} · {r.client_name} · {formatMoney(r.balance_due)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-baseline justify-between gap-3 border border-line bg-slate-50 px-4 py-3 text-sm">
                <span className="text-ink-secondary">Balance due</span>
                <span className="text-lg font-bold tabular-nums">{payBooking ? formatMoney(payBooking.balance_due) : '—'}</span>
              </div>
              <p className="text-[13px] leading-[18px] text-ink-muted">
                The payment form (amount, method, reference no., OR no., proof) opens on Bills Receivable, so every payment is
                recorded the same way.
              </p>
            </div>
            <div className="border-t border-line px-5 py-4">
              <button
                type="button"
                disabled={!payBooking}
                onClick={() => payBooking && navigate(`/dashboard/financial-records?pay=${payBooking.booking_id}`)}
                className="btn-primary w-full px-5 text-sm"
              >
                Record Payment
              </button>
            </div>
          </aside>

          <section className="card px-5 py-4">
            <h2 className="mb-1 border-b border-line pb-2 text-sm font-semibold text-ink">This period</h2>
            {(
              [
                ['Received', totals.received],
                ['Refunded', totals.refunded],
              ] as const
            ).map(([label, amount]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm">
                <span className="text-ink-secondary">{label}</span>
                <span className="font-semibold tabular-nums">{formatMoney(amount)}</span>
              </div>
            ))}
            {totals.byMethod.map((m) => (
              <div key={m.method} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm">
                <span className="text-ink-secondary">{m.method}</span>
                <span className="font-semibold tabular-nums">{formatMoney(m.amount)}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="font-semibold text-ink">Net collected</span>
              <span className="font-bold tabular-nums">{formatMoney(totals.net)}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export default CollectionsSection
