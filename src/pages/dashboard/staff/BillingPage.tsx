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
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import { loadBilling, type Billing } from '../../../lib/billing'
import { loadPaymentDueReport } from '../../../lib/paymentDue'
import { PAYMENT_TERMS_LABELS } from '../../../lib/quoteRequest'
import { toManilaDate } from '../../../lib/payslip'
import { COMPANY } from '../../../lib/company'
import PageHeader from '../../../components/PageHeader'
import { formatMoney, formatDate } from '../../../lib/format'

type BookingOption = { booking_id: number; label: string }

function BillingPage() {
  // Set when opened from a booking's "Billing" link.
  const { bookingId: linkedBookingId } = useParams()
  const [clients, setClients] = useState<{ client_id: number; client_name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [bookingId, setBookingId] = useState(linkedBookingId ?? '')
  const [options, setOptions] = useState<BookingOption[]>([])
  const [billing, setBilling] = useState<Billing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Client choices (everyone, A-Z). Loaded once.
  useEffect(() => {
    supabase
      .from('clients')
      .select('client_id, client_name')
      .order('client_name')
      .then(({ data, error: clientsError }) => {
        if (clientsError) setError(clientsError.message)
        else setClients(data ?? [])
      })
  }, [])

  // This client's bookings for the second dropdown (newest first), with
  // what's still owed so the right one is easy to spot.
  useEffect(() => {
    if (!clientId) {
      setOptions([])
      return
    }
    let ignore = false
    loadPaymentDueReport(Number(clientId), { includeSettled: true }).then((result) => {
      if (ignore) return
      if (result.error) {
        setError(result.error)
        return
      }
      setOptions(
        [...result.rows]
          .sort((a, b) => b.booking_id - a.booking_id)
          .map((r) => ({
            booking_id: r.booking_id,
            label: `#${r.booking_id} · ${r.pickup_place_name} → ${r.delivery_place_name} · ${
              r.balance_due > 0 ? `owes ${formatMoney(r.balance_due)}` : 'paid'
            }`,
          })),
      )
    })
    return () => {
      ignore = true
    }
  }, [clientId])

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
      // Opened from a link: fill in the client so the dropdowns match.
      if (result.billing) setClientId(String(result.billing.client_id))
    })
    return () => {
      ignore = true
    }
  }, [bookingId])

  const fieldClass = 'border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900'

  return (
    <div>
      {/* Controls: not printed */}
      <PageHeader
        title="Billing"
        subtitle="Printable bill for one booking."
        actions={<>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Client"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value)
              setBookingId('')
              setError(null)
            }}
            className={fieldClass}
          >
            <option value="">Choose a client...</option>
            {clients.map((c) => (
              <option key={c.client_id} value={c.client_id}>{c.client_name}</option>
            ))}
          </select>
          <select
            aria-label="Booking"
            value={bookingId}
            disabled={!clientId}
            onChange={(e) => {
              setBookingId(e.target.value)
              setError(null)
            }}
            className={`${fieldClass} max-w-xs disabled:opacity-50`}
          >
            <option value="">Choose a booking...</option>
            {options.map((o) => (
              <option key={o.booking_id} value={o.booking_id}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => window.print()}
            disabled={!billing}
            className="btn-primary px-3 py-1.5 text-sm font-medium"
          >
            Print
          </button>
        </div>
        </>}
      />

      {error && <p className="mt-4 text-red-700 print:hidden">{error}</p>}
      {!bookingId && <p className="mt-4 text-slate-500 print:hidden">Choose a client and a booking to see its billing.</p>}
      {loading && <p className="mt-4 text-slate-500 print:hidden">Preparing billing...</p>}

      {billing && !loading && (
        <div className="mt-4 border border-slate-200 bg-white p-6 shadow-sm print:mt-0 print:border-0 print:p-0 print:shadow-none">
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
            <thead className="border-b border-slate-300 text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Description</th>
                <th className="py-2 pr-3 text-right font-medium">Billed</th>
                <th className="py-2 pr-3 text-right font-medium">Paid</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {billing.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-slate-500">Nothing has been billed for this booking yet.</td>
                </tr>
              )}
              {billing.lines.map((line, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{formatDate(line.date)}</td>
                  <td className="py-2 pr-3 text-slate-900">{line.description}</td>
                  <td className="py-2 pr-3 text-right text-slate-900">{line.amount > 0 ? formatMoney(line.amount) : ''}</td>
                  <td className="py-2 pr-3 text-right text-slate-900">{line.amount < 0 ? formatMoney(-line.amount) : ''}</td>
                  <td className="py-2 text-right text-slate-900">{formatMoney(line.balance)}</td>
                </tr>
              ))}
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
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  )
}

export default BillingPage
