// BookingsSection: lists real bookings in a table (searchable, filterable
// by status), with a click-through detail view for each row.
//
// Reads from `bookings`, then looks up client/place names and the source
// quote's reference code separately (same pattern as DriverTasks.tsx)
// since Supabase doesn't auto-join related tables. Bookings only ever get
// created via the Quotations Approve flow (QuoteReviewModal) -- staff
// wanting to log a booking that didn't come through the public form use
// "New Quote" on the Quotations page instead, so it goes through the
// same tested approve logic rather than a separate manual-entry path.
//
// Bookings are never deleted from here (they carry payment history):
// they're cancelled from the detail view (BookingDetailModal) instead.
// Status moves on its own -- Confirmed on Approve, then InProgress /
// Delivered as the trips move (sync_booking_status trigger in the DB).
//
// /dashboard/bookings?booking=12 opens booking #12's detail straight
// away -- the Dispatch Board links its booking numbers here.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import { formatLocationDisplay } from '../../../lib/locationReference'
import { formatDate } from '../../../lib/quoteRequest'
import { loadClientDamageChargesByBooking } from '../../../lib/damageCharges'
import BookingDetailModal from './BookingDetailModal'
import PaymentDuePanel from './PaymentDuePanel'

export type Booking = {
  booking_id: number
  client_name: string
  pickup_location: string
  delivery_location: string
  date: string
  status: string
  // rate is PER TRIP -- total_trips/completed_trips + the derived
  // totals below exist so nothing has to re-guess "rate x how many?"
  // billable_amount is the EFFECTIVE amount due: amount_to_pay if staff
  // overrode it in Financial Records, otherwise computed_billable_amount
  // (rate x completed trips) -- PLUS damage_charges (approved Client
  // damage, lib/damageCharges.ts). (See src/lib/paymentDue.ts for the
  // same rule applied to the Payments Due report.)
  rate: number | null
  total_trips: number
  completed_trips: number
  total_contract_value: number
  computed_billable_amount: number
  amount_to_pay: number | null
  damage_charges: number
  billable_amount: number
  amount_paid: number
  balance_due: number
  // The source quote's customer-facing reference ("Q-7F3K9A"), when it
  // has one. Optional so other screens building a Booking can skip it.
  reference_code?: string | null
}

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Confirmed: 'bg-blue-100 text-blue-700',
  InProgress: 'bg-amber-100 text-amber-800',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = { InProgress: 'In progress' }

export function BookingStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'
  return (
    <span className={`whitespace-nowrap px-3 py-1 text-xs font-semibold ${style}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

const STATUS_FILTERS = [
  { value: 'Active', label: 'Active' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'All', label: 'All' },
] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]['value']

function matchesStatus(status: string, filter: StatusFilter) {
  if (filter === 'All') return true
  if (filter === 'Active') return status !== 'Delivered' && status !== 'Cancelled'
  return status === filter
}

function BookingsSection() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Active')
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedBookingId = Number(searchParams.get('booking')) || null

  useEffect(() => {
    loadBookings()
  }, [])

  // Open the booking named in the link once the list has loaded.
  const linkedBooking = linkedBookingId
    ? (bookings.find((b) => b.booking_id === linkedBookingId) ?? null)
    : null
  const shownBooking = selectedBooking ?? linkedBooking

  function closeDetail() {
    setSelectedBooking(null)
    if (linkedBookingId) setSearchParams({}, { replace: true })
  }

  async function loadBookings() {
    setLoading(true)

    // 1. Load the bookings themselves.
    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select(
        'booking_id, client_id, quote_request_id, place_of_pickup_id, place_of_delivery_id, pickup_address_detail, delivery_address_detail, booking_date, booking_status, rate_of_delivery_service, amount_to_pay, amount_paid',
      )
      .order('created_at', { ascending: false })

    if (bookingsError) {
      setError(bookingsError.message)
      setLoading(false)
      return
    }

    if (bookingRows.length === 0) {
      setBookings([])
      setError(null)
      setLoading(false)
      return
    }

    // 2. Look up client names, places, quote reference codes, and
    // itinerary counts (bookings only stores IDs, and rate is per trip so
    // the total/billable amounts need the itinerary counts to compute).
    const clientIds = Array.from(new Set(bookingRows.map((b) => b.client_id)))
    const placeIds = Array.from(
      new Set(
        bookingRows.flatMap((b) => [
          b.place_of_pickup_id,
          b.place_of_delivery_id,
        ]),
      ),
    )
    const quoteIds = bookingRows
      .map((b) => b.quote_request_id)
      .filter((id): id is number => id !== null)
    const bookingIds = bookingRows.map((b) => b.booking_id)

    const [clientsResult, placesResult, quotesResult, itinerariesResult] = await Promise.all([
      supabase.from('clients').select('client_id, client_name').in('client_id', clientIds),
      supabase.from('places').select('place_id, place_name, city, barangay').in('place_id', placeIds),
      quoteIds.length > 0
        ? supabase
            .from('quote_requests')
            .select('quote_request_id, reference_code')
            .in('quote_request_id', quoteIds)
        : Promise.resolve({
            data: [] as { quote_request_id: number; reference_code: string | null }[],
            error: null,
          }),
      supabase
        .from('itineraries')
        .select('booking_id, itinerary_status')
        .in('booking_id', bookingIds),
    ])

    const firstError =
      clientsResult.error ?? placesResult.error ?? quotesResult.error ?? itinerariesResult.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }


    // Approved Client damage charges, added on top of the delivery amount.
    const { byBooking: damageByBooking, error: damageError } =
      await loadClientDamageChargesByBooking(bookingIds)
    if (damageError) {
      setError(damageError)
      setLoading(false)
      return
    }

    const clientNameById = new Map(
      (clientsResult.data ?? []).map((c) => [c.client_id, c.client_name]),
    )
    const placeById = new Map((placesResult.data ?? []).map((p) => [p.place_id, p]))
    const referenceByQuote = new Map(
      (quotesResult.data ?? []).map((q) => [q.quote_request_id, q.reference_code]),
    )

    // "Warehouse 3, Brgy. Sasa, Davao City" -- falls back to the place's
    // own name for older places rows without city/barangay.
    function locationLabel(placeId: number, detail: string | null) {
      const place = placeById.get(placeId)
      if (!place) return detail || '—'
      if (!place.city || !place.barangay) {
        return [detail, place.place_name].filter(Boolean).join(', ') || '—'
      }
      return formatLocationDisplay({ city: place.city, barangay: place.barangay, detail })
    }

    const totalTripsByBooking = new Map<number, number>()
    const completedTripsByBooking = new Map<number, number>()
    const itineraryRows = itinerariesResult.data ?? []
    itineraryRows.forEach((itinerary) => {
      // Cancelled trips aren't part of the contract any more.
      if (itinerary.itinerary_status === 'Cancelled') return
      totalTripsByBooking.set(
        itinerary.booking_id,
        (totalTripsByBooking.get(itinerary.booking_id) ?? 0) + 1,
      )
      if (itinerary.itinerary_status === 'Delivered') {
        completedTripsByBooking.set(
          itinerary.booking_id,
          (completedTripsByBooking.get(itinerary.booking_id) ?? 0) + 1,
        )
      }
    })

    setBookings(
      bookingRows.map((b) => {
        const rate = b.rate_of_delivery_service ?? 0
        const totalTrips = totalTripsByBooking.get(b.booking_id) ?? 0
        const completedTrips = completedTripsByBooking.get(b.booking_id) ?? 0
        const computedBillableAmount = rate * completedTrips
        const damageCharges = damageByBooking.get(b.booking_id) ?? 0
        const billableAmount = (b.amount_to_pay ?? computedBillableAmount) + damageCharges
        const amountPaid = b.amount_paid ?? 0

        return {
          booking_id: b.booking_id,
          client_name: clientNameById.get(b.client_id) ?? '—',
          pickup_location: locationLabel(b.place_of_pickup_id, b.pickup_address_detail),
          delivery_location: locationLabel(b.place_of_delivery_id, b.delivery_address_detail),
          date: b.booking_date,
          status: b.booking_status ?? 'Draft',
          rate: b.rate_of_delivery_service,
          total_trips: totalTrips,
          completed_trips: completedTrips,
          total_contract_value: rate * totalTrips,
          computed_billable_amount: computedBillableAmount,
          amount_to_pay: b.amount_to_pay,
          damage_charges: damageCharges,
          billable_amount: billableAmount,
          amount_paid: amountPaid,
          balance_due: billableAmount - amountPaid,
          reference_code:
            b.quote_request_id !== null ? (referenceByQuote.get(b.quote_request_id) ?? null) : null,
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  const query = search.trim().toLowerCase()
  const visibleBookings = bookings.filter(
    (booking) =>
      matchesStatus(booking.status, statusFilter) &&
      (!query ||
        [
          `#${booking.booking_id}`,
          String(booking.booking_id),
          booking.client_name,
          booking.pickup_location,
          booking.delivery_location,
          booking.reference_code ?? '',
        ].some((text) => text.toLowerCase().includes(query))),
  )
  const countFor = (filter: StatusFilter) =>
    bookings.filter((booking) => matchesStatus(booking.status, filter)).length

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Bookings</h2>

      <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Filter by status" className="flex">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  aria-pressed={statusFilter === filter.value}
                  className={`border px-3 py-1.5 text-sm font-medium first:rounded-l-lg last:rounded-r-lg [&:not(:first-child)]:-ml-px ${
                    statusFilter === filter.value
                      ? 'relative border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {filter.label}
                  {!loading && (
                    <span className="ml-1.5 text-xs opacity-70">{countFor(filter.value)}</span>
                  )}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client, place, booking # or Q- reference"
              aria-label="Search bookings"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none sm:max-w-sm"
            />
          </div>

          {loading ? (
            <p className="text-slate-500">Loading bookings…</p>
          ) : error ? (
            <p className="text-red-700">{error}</p>
          ) : bookings.length === 0 ? (
            <p className="text-slate-500">
              No bookings yet. Bookings are created when a quote is approved
              on the Quotations page.
            </p>
          ) : visibleBookings.length === 0 ? (
            <p className="text-slate-500">
              No bookings match.{' '}
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('All')
                }}
                className="font-medium text-slate-700 underline hover:text-slate-900"
              >
                Clear filters
              </button>
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Booking</th>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Pickup → Delivery</th>
                    <th className="px-4 py-3 font-medium">Pickup date</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Rate / trip</th>
                    <th className="px-4 py-3 font-medium">Contract value</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleBookings.map((booking) => (
                    <tr
                      key={booking.booking_id}
                      onClick={() => setSelectedBooking(booking)}
                      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 text-slate-900">
                        {/* A real button so keyboard users can open it too. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedBooking(booking)
                          }}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          #{booking.booking_id}
                        </button>
                        {booking.reference_code && (
                          <span className="block font-mono text-xs text-slate-500">
                            {booking.reference_code}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-900">
                        {booking.client_name}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-slate-600">
                        <span className="block truncate" title={booking.pickup_location}>
                          {booking.pickup_location}
                        </span>
                        <span className="block truncate text-slate-500" title={booking.delivery_location}>
                          → {booking.delivery_location}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {booking.date ? formatDate(booking.date) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <BookingStatusBadge status={booking.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {booking.rate !== null
                          ? `₱${booking.rate.toLocaleString()}`
                          : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        ₱{booking.total_contract_value.toLocaleString()}
                        <span className="ml-1 text-xs text-slate-400">
                          ({booking.completed_trips}/{booking.total_trips}{' '}
                          trips)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="w-full lg:max-w-sm">
          <PaymentDuePanel />
        </div>
      </div>

      {shownBooking && (
        <BookingDetailModal
          booking={shownBooking}
          onClose={closeDetail}
          onChanged={() => {
            closeDetail()
            loadBookings()
          }}
        />
      )}
    </div>
  )
}

export default BookingsSection
