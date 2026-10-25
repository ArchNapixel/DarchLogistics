// BillingPage (Admin, Accounting -> Billing): the printable "Billing" for ONE
// booking -- the bill to hand the client. Works like Statements of Account:
// pick a client, then one of their bookings, then Print (choose "Save as
// PDF" in the print dialog to send a file). Also opens straight on a
// booking from the links in Bills Receivable / the booking detail
// (/dashboard/billing/:bookingId). The sidebar/header are hidden when
// printing (print: classes in DashboardLayout). It is a billing statement,
// not a BIR invoice; the invoice number shown is whatever was typed in
// Bills Receivable. Numbers come from lib/billing.ts, which narrows the
// Statement of Account ledger to this booking.
// Laid out like the canvas board: every booking in a list on the left
// (search by booking # or client), the chosen one's bill on the right.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { loadBilling, type Billing } from '../../../lib/billing'
import { loadPaymentDueReport, type PaymentDueRow } from '../../../lib/paymentDue'
import { usePaged } from '../../../lib/usePaged'
import StatusBadge from '../../../components/StatusBadge'
import { PAYMENT_TERMS_LABELS } from '../../../lib/quoteRequest'
import { toManilaDate } from '../../../lib/payslip'
import { COMPANY } from '../../../lib/company'
import PageHeader from '../../../components/PageHeader'
import { formatMoney, formatDate } from '../../../lib/format'

function BillingPage() {
  // Set when opened from a booking's "Billing" link.
  const { bookingId: linkedBookingId } = useParams()
  const [pickedBookingId, setBookingId] = useState(linkedBookingId ?? '')
  // Every booking with what it's billed / owes (newest first) for the list.
  const [bookings, setBookings] = useState<PaymentDueRow[] | null>(null)
  const [search, setSearch] = useState('')
  const [billing, setBilling] = useState<Billing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadPaymentDueReport(undefined, { includeSettled: true }).then((result) => {
      if (result.error) setError(result.error)
      setBookings([...result.rows].sort((a, b) => b.booking_id - a.booking_id))
    })
  }, [])

  const query = search.trim().toLowerCase().replace(/^#/, '')
  const visible = (bookings ?? []).filter(
    (b) => !query || String(b.booking_id) === query || b.client_name.toLowerCase().includes(query),
  )
  const paged = usePaged(visible, search)
  // Nothing picked yet: show the newest booking's bill.
  const bookingId = pickedBookingId || (bookings?.[0] ? String(bookings[0].booking_id) : '')

  // The bill itself, whenever a booking is chosen.
  useEffect(() => {
    const id = Number(bookingId)
    if (!bookingId) {
      setBilling(null)
      return
    }
    if (!Number.isInteger(id) || id <= 0) {
      setError("That isn't a valid booking number.")
      return
    }
    let ignore = false
    setLoading(true)
    loadBilling(id).then((result) => {
      if (ignore) return // a newer pick already replaced this one
      setBilling(result.billing)
      setError(result.error)
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [bookingId])


  // The statement's dated lines, with each trip not delivered yet slotted in
  // by its scheduled date (after any line of the same day).
  const rows = billing
    ? (() => {
        const out: ({ kind: 'line'; line: (typeof billing.lines)[number] } | { kind: 'pending'; trip: (typeof billing.pendingTrips)[number] })[] =
          billing.lines.map((line) => ({ kind: 'line' as const, line }))
        for (const trip of billing.pendingTrips) {
          const at = out.findIndex((r) => (r.kind === 'line' ? r.line.date : (r.trip.date ?? '')) > (trip.date ?? '9999-12-31'))
          out.splice(at === -1 ? out.length : at, 0, { kind: 'pending', trip })
        }
        return out
      })()
    : []

  return (
    <div>
      {/* Controls: not printed */}
      <PageHeader
        title="Billing"
        subtitle="One bill per booking: its delivered trips, extra charges and payments."
        actions={
          <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary">
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Booking or client"
              className="min-h-11 w-64 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm text-ink-metric placeholder:text-ink-muted focus:border-primary"
            />
          </label>
        }
      />

      {error && <p className="mb-4 text-red-700 print:hidden">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[480px_minmax(0,1fr)] xl:items-start print:block">
        <section aria-label="Bookings" className="card flex flex-col print:hidden">
          <table className="w-full table-fixed text-left text-sm text-ink-metric">
            <colgroup>
              <col style={{ width: '90px' }} />
              <col />
              <col style={{ width: '150px' }} />
              <col style={{ width: '110px' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="px-2 py-2.5 first:pl-5">Booking</th>
                <th className="px-2 py-2.5">Client</th>
                <th className="px-2 py-2.5 text-right">Billed</th>
                <th className="px-2 py-2.5 last:pr-5">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings === null ? (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-ink-muted">
                    Loading bookings...
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-ink-muted">
                    {search ? 'No bookings match.' : 'No bookings yet.'}
                  </td>
                </tr>
              ) : (
                paged.rows.map((b) => {
                  const active = String(b.booking_id) === bookingId
                  return (
                    <tr
                      key={b.booking_id}
                      onClick={() => {
                        setBookingId(String(b.booking_id))
                        setError(null)
                      }}
                      aria-current={active || undefined}
                      className={`h-[60px] cursor-pointer border-b border-slate-200 ${
                        active ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="px-2 py-2 font-semibold text-primary first:pl-5">#{b.booking_id}</td>
                      <td className="truncate px-2 py-2 font-semibold" title={b.client_name}>
                        {b.client_name}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <span className="block font-semibold">{formatMoney(b.billable_amount)}</span>
                        <span className="block text-[13px] text-ink-muted">
                          {b.completed_trips} × {b.rate_per_trip !== null ? formatMoney(b.rate_per_trip) : '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2 last:pr-5">
                        {b.billable_amount <= 0 ? (
                          <span className="text-[13px] text-ink-muted">Not billed</span>
                        ) : b.balance_due <= 0 ? (
                          <StatusBadge status="Paid" icon />
                        ) : (
                          <StatusBadge status="Unpaid" label="Owes" />
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
            <span>
              {paged.pager.pageCount > 1
                ? `Page ${paged.pager.page + 1} of ${paged.pager.pageCount}`
                : `${visible.length} ${visible.length === 1 ? 'booking' : 'bookings'}`}
            </span>
            <span className="flex gap-2">
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

        <div className="min-w-0">
      {loading && <p className="text-ink-muted print:hidden">Preparing billing...</p>}
      {!bookingId && bookings !== null && <p className="text-ink-muted print:hidden">Choose a booking to see its billing.</p>}
      {billing && !loading && (
        <div className="card print:border-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4 print:hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-lg leading-[26px] font-bold text-ink">
                {billing.invoice_number ? `Invoice ${billing.invoice_number} · ` : ''}Booking #{billing.booking_id}
              </h2>
              {billing.balance_due <= 0 && billing.billed > 0 ? (
                <StatusBadge status="Paid" icon />
              ) : billing.balance_due > 0 ? (
                <StatusBadge status="Unpaid" label={`${formatMoney(billing.balance_due)} due`} />
              ) : null}
            </div>
            <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12 M7 10l5 5 5-5 M5 21h14" />
              </svg>
              Print / Save as PDF
            </button>
          </div>
          <div className="p-6 print:p-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">{COMPANY.name}</p>
              <p className="text-xs text-slate-500">{COMPANY.address} · {COMPANY.phone}</p>
              <h3 className="mt-3 text-lg font-bold text-slate-900">Billing</h3>
            </div>
            <div className="text-right text-sm text-slate-600">
              <p>Booking #{billing.booking_id}</p>
              {billing.invoice_number && <p>Invoice no. {billing.invoice_number}</p>}
              <p className="text-xs">Prepared {formatDate(toManilaDate(new Date()))}</p>
            </div>
          </div>

          <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Detail label="Billed to" value={billing.client_name} />
            <Detail label="Booking date" value={formatDate(billing.booking_date)} />
            <Detail label="Pickup" value={billing.pickup} />
            <Detail label="Delivery" value={billing.delivery} />
            {billing.cargo && <Detail label="Cargo" value={billing.cargo} />}
            <Detail
              label="Payment terms"
              value={PAYMENT_TERMS_LABELS[billing.payment_terms as keyof typeof PAYMENT_TERMS_LABELS] ?? billing.payment_terms}
            />
            <Detail label="Trips delivered" value={`${billing.trips_delivered} of ${billing.trips_total}`} />
            {billing.due_date && billing.balance_due > 0 && (
              <Detail label="Payment due" value={formatDate(billing.due_date)} />
            )}
          </dl>

          <table className="mt-6 w-full text-left text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Description</th>
                <th className="px-3 py-2.5 text-right">Billed</th>
                <th className="px-3 py-2.5 text-right">Paid</th>
                <th className="px-3 py-2.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-ink-muted">Nothing has been billed for this booking yet.</td>
                </tr>
              )}
              {rows.map((row, i) =>
                row.kind === 'pending' ? (
                  // A trip not delivered yet: listed in date order, billed on delivery.
                  <tr key={`t${row.trip.itinerary_id}`} className="border-b border-slate-200 align-top text-slate-400">
                    <td className="whitespace-nowrap px-3 py-2">{row.trip.date ? formatDate(row.trip.date) : '—'}</td>
                    <td className="px-3 py-2">{row.trip.description}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2" />
                  </tr>
                ) : (
                  <tr key={i} className="border-b border-slate-200 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-ink-secondary">{formatDate(row.line.date)}</td>
                    <td className="px-3 py-2">{row.line.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.line.amount > 0 ? formatMoney(row.line.amount) : ''}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.line.amount < 0 ? formatMoney(-row.line.amount) : ''}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(row.line.balance)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>

          <div className="mt-4 ml-auto w-full max-w-xs text-sm">
            <div className="flex justify-between py-1 text-slate-700">
              <span>Total billed</span>
              <span className="text-slate-900">{formatMoney(billing.billed)}</span>
            </div>
            <div className="flex justify-between py-1 text-slate-700">
              <span>Paid so far</span>
              <span className="text-slate-900">{formatMoney(billing.paid)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-300 py-2 text-base font-bold text-slate-900">
              <span>{billing.balance_due > 0 ? 'Amount due' : billing.balance_due < 0 ? 'Credit' : 'Balance'}</span>
              <span>{billing.balance_due === 0 ? 'PAID' : formatMoney(Math.abs(billing.balance_due))}</span>
            </div>
          </div>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  )
}

export default BillingPage
