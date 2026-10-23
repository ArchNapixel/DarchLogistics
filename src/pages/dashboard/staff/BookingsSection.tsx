// BookingsSection: the Bookings & Trips page. Two tabs (PageViewSwitch):
// - Bookings (default): status filter (Active / Delivered / Cancelled /
//   All, with counts) and one search box -- client, place, booking #, trip #
//   or Q- reference. The list is on the left; the clicked booking's card
//   (BookingDetailModal inline: downpayment, cargo, money, trips,
//   documents, cancel) is on the right. Phones open it as a pop-up.
// - Trips (?view=trips, TripsView.tsx): every trip with its own detail.
//
// Reads from `bookings`, then looks up client/place names, the source
// quote's reference code and the trips separately (same pattern as
// DriverTasks.tsx) since Supabase doesn't auto-join related tables.
// Bookings only ever get created when a quote's offer is accepted
// (lib/quoteOffers.ts).
//
// Bookings are never deleted from here (they carry payment history):
// they're cancelled from the booking card (BookingDetailModal) instead.
// Status moves on its own -- Confirmed on acceptance, then InProgress /
// Delivered as the trips move (sync_booking_status trigger in the DB).
//
// /dashboard/bookings?booking=12 opens booking #12 straight away -- the
// Dispatch Board links its booking numbers here. Adding &trip=57 also
// highlights trip #57's row in it; so does typing a trip number in search.
// Trip numbers are itineraries.itinerary_id -- one running number across
// all bookings, not "trip 1 of booking 12".
import { useEffect, useState } from 'react'
import { usePaged } from '../../../lib/usePaged'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import { formatLocationDisplay } from '../../../lib/locationReference'
import { loadClientDamageChargesByBooking } from '../../../lib/damageCharges'
import { deliveryAmountFor } from '../../../lib/paymentDue'
import { fetchAll, fetchIn } from '../../../lib/dashboardExpenses'
import TripsView from './TripsView'
import BookingDetailModal from './BookingDetailModal'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import { DetailPane, FilterButtons, ListBox, PageViewSwitch, SearchBox } from './BookingsTripsControls'

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
  // Number from the printed invoice booklet, typed in on Bills Receivable.
  // Optional for the same reason as reference_code.
  invoice_number?: string | null
  // When the booking was created (Bills Receivable: earliest allowed
  // "date received" for its payments). Optional for the same reason.
  created_at?: string
  // Cancelled trips -- NOT in total_trips (a 3-trip booking with 2
  // cancelled reads "1/1 · 2 cancelled"). Optional for the same reason.
  cancelled_trips?: number
  // Set when the booking was cancelled (fully or partway): it's then only
  // billed for delivered trips (deliveryAmountFor in lib/paymentDue.ts).
  cancelled_at?: string | null
  // Its trip numbers (itineraries.itinerary_id) -- the search box finds a
  // booking by any of them. Optional for the same reason as reference_code.
  trip_ids?: number[]
}

// One row of the bookings query in loadBookings().
type BookingRow = {
  booking_id: number
  client_id: number
  quote_request_id: number | null
  place_of_pickup_id: number
  place_of_delivery_id: number
  pickup_address_detail: string | null
  delivery_address_detail: string | null
  booking_date: string
  booking_status: string | null
  cancelled_at: string | null
  rate_of_delivery_service: number | null
  amount_to_pay: number | null
  amount_paid: number | null
  invoice_number: string | null
}

const STATUS_FILTERS = [
  { value: 'Active', label: 'Active' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'All', label: 'All' },
] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]['value']

// Wide screens show the list and the booking side by side; phones open
// the booking as a pop-up (no room for two panes).
const WIDE = '(min-width: 1024px)' // Tailwind's lg

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
  // The booking shown in the right pane (null = first on the page).
  const [paneId, setPaneId] = useState<number | null>(null)
  const [isWide, setIsWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const onChange = () => setIsWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const split = isWide
  const [searchParams, setSearchParams] = useSearchParams()

  const linkedBookingId = Number(searchParams.get('booking')) || null
  const linkedTripId = Number(searchParams.get('trip')) || null
  // Page tab: Bookings (default) or Trips (?view=trips, TripsView.tsx).
  const pageView = searchParams.get('view') === 'trips' ? 'trips' : 'bookings'

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

    // 1. Load the bookings themselves -- every page (Supabase returns at
    // most 1000 rows per request; fetchAll keeps going past that).
    const { rows: bookingRows, error: bookingsError } = await fetchAll<BookingRow>((from, to) =>
      supabase
        .from('bookings')
        .select(
          'booking_id, client_id, quote_request_id, place_of_pickup_id, place_of_delivery_id, pickup_address_detail, delivery_address_detail, booking_date, booking_status, cancelled_at, rate_of_delivery_service, amount_to_pay, amount_paid, invoice_number',
        )
        .order('created_at', { ascending: false })
        .order('booking_id', { ascending: false })
        .range(from, to),
    )

    if (bookingsError) {
      setError(bookingsError)
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

    // fetchIn = .in() a few hundred ids at a time (one huge id list makes
    // the URL too long), each chunk paged past 1000 rows.
    const [clientsResult, placesResult, quotesResult, itinerariesResult] = await Promise.all([
      fetchIn<{ client_id: number; client_name: string }>(clientIds, (chunk, from, to) =>
        supabase.from('clients').select('client_id, client_name').in('client_id', chunk).range(from, to),
      ),
      fetchIn<{ place_id: number; place_name: string; city: string | null; barangay: string | null }>(
        placeIds,
        (chunk, from, to) =>
          supabase
            .from('places')
            .select('place_id, place_name, city, barangay')
            .in('place_id', chunk)
            .range(from, to),
      ),
      fetchIn<{ quote_request_id: number; reference_code: string | null }>(quoteIds, (chunk, from, to) =>
        supabase
          .from('quote_requests')
          .select('quote_request_id, reference_code')
          .in('quote_request_id', chunk)
          .range(from, to),
      ),
      fetchIn<{ booking_id: number; itinerary_id: number; itinerary_status: string | null }>(bookingIds, (chunk, from, to) =>
        supabase
          .from('itineraries')
          .select('booking_id, itinerary_id, itinerary_status')
          .in('booking_id', chunk)
          .range(from, to),
      ),
    ])

    const firstError =
      clientsResult.error ?? placesResult.error ?? quotesResult.error ?? itinerariesResult.error
    if (firstError) {
      setError(firstError)
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

    const clientNameById = new Map(clientsResult.rows.map((c) => [c.client_id, c.client_name]))
    const placeById = new Map(placesResult.rows.map((p) => [p.place_id, p]))
    const referenceByQuote = new Map(
      quotesResult.rows.map((q) => [q.quote_request_id, q.reference_code]),
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
    const itineraryRows = itinerariesResult.rows
    const cancelledTripsByBooking = new Map<number, number>()
    const tripIdsByBooking = new Map<number, number[]>()
    itineraryRows.forEach((itinerary) => {
      tripIdsByBooking.set(itinerary.booking_id, [...(tripIdsByBooking.get(itinerary.booking_id) ?? []), itinerary.itinerary_id])
      // Cancelled trips aren't part of the contract any more (counted separately).
      if (itinerary.itinerary_status === 'Cancelled') {
        cancelledTripsByBooking.set(itinerary.booking_id, (cancelledTripsByBooking.get(itinerary.booking_id) ?? 0) + 1)
        return
      }
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
        const billableAmount =
          deliveryAmountFor({
            amountToPay: b.amount_to_pay,
            computedBillable: computedBillableAmount,
            hadCancellation: b.booking_status === 'Cancelled' || b.cancelled_at != null,
          }) + damageCharges
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
          invoice_number: b.invoice_number,
          cancelled_trips: cancelledTripsByBooking.get(b.booking_id) ?? 0,
          cancelled_at: b.cancelled_at,
          trip_ids: tripIdsByBooking.get(b.booking_id) ?? [],
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  const query = search.trim().toLowerCase()
  // A number (with or without "#") also finds the booking a trip # is on.
  const queryNumber = /^#?\d+$/.test(query) ? Number(query.replace('#', '')) : null
  const visibleBookings = bookings.filter(
    (booking) =>
      matchesStatus(booking.status, statusFilter) &&
      (!query ||
        (queryNumber !== null && (booking.trip_ids ?? []).includes(queryNumber)) ||
        [
          `#${booking.booking_id}`,
          String(booking.booking_id),
          booking.client_name,
          booking.pickup_location,
          booking.delivery_location,
          booking.reference_code ?? '',
          booking.invoice_number ?? '',
        ].some((text) => text.toLowerCase().includes(query))),
  )
  const counts = loading
    ? null
    : Object.fromEntries(
        STATUS_FILTERS.map((f) => [f.value, bookings.filter((b) => matchesStatus(b.status, f.value)).length]),
      )

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(visibleBookings, `${statusFilter}|${search}`)

  // Right pane: a ?booking= link (Dispatch Board, Quotations) wins, else
  // the clicked row, else the first booking on this page.
  const paneBooking =
    linkedBooking ?? paged.rows.find((b) => b.booking_id === paneId) ?? paged.rows[0] ?? null
  // Trip to highlight in it: from the link, or a trip # typed in search.
  const paneHighlightTrip =
    linkedBooking && linkedTripId
      ? linkedTripId
      : queryNumber !== null && paneBooking?.trip_ids?.includes(queryNumber)
        ? queryNumber
        : null

  function openBooking(booking: Booking) {
    if (split) {
      setPaneId(booking.booking_id)
      if (linkedBookingId) setSearchParams({}, { replace: true })
    } else {
      setSelectedBooking(booking)
    }
  }

  const switcher = (
    <PageViewSwitch
      view={pageView}
      onChange={(v) => setSearchParams(v === 'trips' ? { view: 'trips' } : {})}
    />
  )
  const filterWord = statusFilter === 'All' ? '' : `${statusFilter.toLowerCase()} `

  return (
    <div>
      <PageHeader title="Bookings & Trips" subtitle="Every client booking and its trips." />

      {pageView === 'trips' ? (
        <TripsView
          switcher={switcher}
          focusTripId={linkedTripId}
          // Back to the Bookings tab with that booking open.
          onOpenBooking={(bookingId) => setSearchParams({ booking: String(bookingId) })}
        />
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {switcher}
            <FilterButtons
              label="Filter by status"
              options={STATUS_FILTERS}
              value={statusFilter}
              onChange={setStatusFilter}
              counts={counts}
            />
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Client, place, booking #, trip # or Q- reference"
            />
          </div>

          {/* A ?booking= link pointing at a booking that isn't there -- say
              so instead of silently opening nothing. */}
          {!loading && !error && linkedBookingId && !linkedBooking && !selectedBooking && (
            <p className="mb-4 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Booking #{linkedBookingId} was not found.{' '}
              <button
                type="button"
                onClick={() => setSearchParams({}, { replace: true })}
                className="font-medium underline"
              >
                Dismiss
              </button>
            </p>
          )}

          {loading ? (
            <p className="text-slate-500">Loading bookings…</p>
          ) : error ? (
            <p className="text-red-700">{error}</p>
          ) : bookings.length === 0 ? (
            <EmptyState message="No bookings yet." hint="Bookings are created when a client accepts a quote offer." />
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
            <div className="grid gap-4 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start">
              <ListBox
                pager={paged.pager}
                summary={`${visibleBookings.length} ${filterWord}${visibleBookings.length === 1 ? 'booking' : 'bookings'}`}
              >
                <ul>
                  {paged.rows.map((booking) => {
                    const active = split && paneBooking?.booking_id === booking.booking_id
                    return (
                      <li key={booking.booking_id} className="border-b border-slate-200">
                        <button
                          type="button"
                          onClick={() => openBooking(booking)}
                          aria-current={active || undefined}
                          className={`block w-full px-4 py-3 text-left text-sm ${
                            active ? 'bg-slate-100' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="truncate">
                              <span className="font-semibold text-slate-900">
                                #{booking.booking_id} {booking.client_name}
                              </span>
                              {booking.date && <span className="text-primary"> · {formatDate(booking.date)}</span>}
                            </span>
                            <StatusBadge status={booking.status} />
                          </span>
                          <span className="mt-0.5 block truncate text-slate-800" title={booking.pickup_location}>
                            {booking.pickup_location}
                          </span>
                          <span className="block truncate text-slate-500" title={booking.delivery_location}>
                            → {booking.delivery_location}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </ListBox>
              {split && paneBooking && (
                <DetailPane>
                  {/* key = a fresh card per booking */}
                  <BookingDetailModal
                    key={paneBooking.booking_id}
                    booking={paneBooking}
                    inline
                    onChanged={loadBookings}
                    highlightTripId={paneHighlightTrip}
                  />
                </DetailPane>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pop-up on phones; wide screens use the pane. */}
      {shownBooking && !split && (
        <BookingDetailModal
          booking={shownBooking}
          // Only when opened from a ?trip= link, not a row click.
          highlightTripId={selectedBooking ? null : linkedTripId}
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
