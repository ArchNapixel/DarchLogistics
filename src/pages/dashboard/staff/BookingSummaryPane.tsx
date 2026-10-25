// BookingSummaryPane: the right-hand panel on Bookings & Trips (the canvas's
// booking card): summary, payment, and one small card per trip with its slot,
// driver, truck and trailer. Read-only -- "Full Details" opens the whole
// booking card (BookingDetailModal: cancel, downpayment waiver, hours per
// trip, cargo, documents) and "Record Payment" goes to Bills Receivable.
// Loads this booking's trips itself (same lookup-by-id pattern as the rest
// of the page: itineraries -> active crew -> employee names, trailer plates).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate, formatMoney, formatSlot } from '../../../lib/format'
import type { Booking } from './BookingsSection'

type PaneTrip = {
  itinerary_id: number
  status: string
  slot: string
  driver: string | null
  helper: string | null
  truck: string | null
  trailer: string | null
}

const STATUS_LABELS: Record<string, string> = { PickedUp: 'Picked Up', InTransit: 'In Transit' }

async function loadPaneTrips(bookingId: number): Promise<{ trips: PaneTrip[]; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('itineraries')
    .select('itinerary_id, itinerary_status, trip_start_at, trip_end_at, trip_date_from, plate_number, trailer_id')
    .eq('booking_id', bookingId)
    .order('itinerary_id')
  if (error) return { trips: [], error: error.message }
  if (rows.length === 0) return { trips: [], error: null }

  const ids = rows.map((r) => r.itinerary_id)
  const trailerIds = rows.map((r) => r.trailer_id).filter((id): id is number => id !== null)
  const [crewResult, trailersResult] = await Promise.all([
    supabase
      .from('itinerary_crews')
      .select('itinerary_id, employee_id, crew_role')
      .in('itinerary_id', ids)
      .in('crew_role', ['Driver', 'Helper'])
      .eq('is_active', true),
    trailerIds.length > 0
      ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : Promise.resolve({ data: [] as { trailer_id: number; plate_number: string | null }[], error: null }),
  ])
  if (crewResult.error) return { trips: [], error: crewResult.error.message }
  if (trailersResult.error) return { trips: [], error: trailersResult.error.message }

  const employeeIds = [...new Set(crewResult.data.map((c) => c.employee_id as number))]
  const { data: employees, error: employeesError } = employeeIds.length
    ? await supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds)
    : { data: [] as { employee_id: number; full_name: string }[], error: null }
  if (employeesError) return { trips: [], error: employeesError.message }

  const nameById = new Map(employees.map((e) => [e.employee_id, e.full_name]))
  const crewName = (itineraryId: number, role: string) => {
    const c = crewResult.data.find((x) => x.itinerary_id === itineraryId && x.crew_role === role)
    return c ? (nameById.get(c.employee_id) ?? '—') : null
  }
  const trailerById = new Map(trailersResult.data.map((t) => [t.trailer_id, t.plate_number]))

  return {
    trips: rows.map((r) => ({
      itinerary_id: r.itinerary_id,
      status: r.itinerary_status ?? 'Awaiting',
      slot: r.trip_start_at ? formatSlot(r.trip_start_at, r.trip_end_at) : `${formatDate(r.trip_date_from)} · no time set`,
      driver: crewName(r.itinerary_id, 'Driver'),
      helper: crewName(r.itinerary_id, 'Helper'),
      truck: r.plate_number,
      trailer: r.trailer_id !== null ? (trailerById.get(r.trailer_id) ?? `#${r.trailer_id}`) : null,
    })),
    error: null,
  }
}

const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'text-[15px] leading-[22px] font-medium text-ink'

function BookingSummaryPane({
  booking,
  highlightTripId,
  canRecordPayment,
  onOpenFull,
}: {
  booking: Booking
  highlightTripId: number | null
  // Admin: Bills Receivable is in their routes only.
  canRecordPayment: boolean
  onOpenFull: () => void
}) {
  const [trips, setTrips] = useState<PaneTrip[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPaneTrips(booking.booking_id).then((result) => {
      if (cancelled) return
      setTrips(result.trips)
      setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [booking.booking_id])

  const delivered = booking.completed_trips
  const balance = booking.balance_due
  const tripsToCome = booking.status !== 'Delivered' && booking.status !== 'Cancelled'

  return (
    <aside aria-labelledby="bk-title" className="card flex flex-col lg:sticky lg:top-0 lg:max-h-[calc(100dvh-7rem)]">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
        <h2 id="bk-title" className="text-lg leading-[26px] font-bold text-ink">
          Booking #{booking.booking_id}
        </h2>
        {booking.reference_code && (
          <span className="font-mono text-[13px] font-semibold tracking-[0.02em] text-ink-secondary">{booking.reference_code}</span>
        )}
        <StatusBadge status={booking.status} icon />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-4">
        <section>
          <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink">Summary</h3>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
            <div>
              <dt className={LABEL}>Client</dt>
              <dd className={`${VALUE} font-semibold`}>{booking.client_name}</dd>
            </div>
            <div>
              <dt className={LABEL}>Booked</dt>
              <dd className={VALUE}>{booking.date ? formatDate(booking.date) : '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className={LABEL}>Route</dt>
              <dd className={VALUE}>
                {booking.pickup_location} → {booking.delivery_location}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Rate</dt>
              <dd className={`${VALUE} tabular-nums`}>
                {booking.rate !== null ? formatMoney(booking.rate) : '—'}{' '}
                <span className="text-[13px] text-ink-muted">per trip</span>
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Invoice no.</dt>
              <dd className={booking.invoice_number ? VALUE : `${VALUE} text-ink-muted`}>{booking.invoice_number || 'Not entered'}</dd>
            </div>
          </dl>
        </section>

        <section className="border border-line bg-slate-50 px-4 py-3.5">
          <h3 className="mb-2 text-sm font-semibold text-ink">Payment</h3>
          <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <span className="text-ink-secondary">
              Contract value{' '}
              <span className="text-[13px] text-ink-muted">
                {booking.total_trips} {booking.total_trips === 1 ? 'trip' : 'trips'} × {booking.rate !== null ? formatMoney(booking.rate) : '—'}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(booking.total_contract_value)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <span className="text-ink-secondary">
              Billed so far{' '}
              <span className="text-[13px] text-ink-muted">
                {delivered} of {booking.total_trips} delivered
              </span>
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(booking.billable_amount)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <span className="text-ink-secondary">Paid</span>
            <span className="font-semibold tabular-nums">{formatMoney(booking.amount_paid)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 py-1 pt-2 text-sm">
            <span className="font-semibold text-ink">Balance due</span>
            <span className="flex items-center gap-2 font-bold tabular-nums">
              {formatMoney(Math.max(balance, 0))}
              {balance <= 0 && booking.billable_amount > 0 && <StatusBadge status="Paid" icon />}
              {balance < 0 && tripsToCome && <span className="text-[13px] font-medium text-ink-muted">paid ahead</span>}
            </span>
          </div>
        </section>

        <section>
          <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink">
            Trips ({booking.total_trips}
            {booking.cancelled_trips ? ` · ${booking.cancelled_trips} cancelled` : ''})
          </h3>
          {error && <p className="text-sm text-red-700">{error}</p>}
          {!trips && !error && <p className="text-sm text-ink-muted">Loading trips…</p>}
          {trips && trips.length === 0 && <p className="text-sm text-ink-muted">No trips on this booking.</p>}
          <div className="flex flex-col gap-2.5">
            {trips?.map((t) => (
              <div
                key={t.itinerary_id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border px-3.5 py-3 ${
                  t.itinerary_id === highlightTripId ? 'border-2 border-primary bg-primary-soft' : 'border-line'
                }`}
              >
                <div className="text-sm font-bold text-ink">
                  Trip #{t.itinerary_id} <span className="font-medium text-ink-secondary">· {t.slot}</span>
                </div>
                <StatusBadge status={t.status} label={STATUS_LABELS[t.status]} icon />
                <div className="col-span-2 text-[13px] leading-[18px] text-ink-secondary">
                  Driver <strong className="text-ink">{t.driver ?? '—'}</strong>
                  {t.helper && (
                    <>
                      {' '}
                      · Helper <strong className="text-ink">{t.helper}</strong>
                    </>
                  )}{' '}
                  · Truck <strong className="text-ink">{t.truck ?? '—'}</strong> · Trailer{' '}
                  <strong className="text-ink">{t.trailer ?? '—'}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="flex shrink-0 gap-3 border-t border-line px-5 py-4">
        <button type="button" onClick={onOpenFull} className="btn-secondary flex-1 px-4 text-sm font-medium">
          Full Details
        </button>
        {canRecordPayment && (
          <Link
            to={`/dashboard/financial-records?pay=${booking.booking_id}`}
            className="btn-primary flex flex-1 items-center justify-center px-4 text-sm"
          >
            Record Payment
          </Link>
        )}
      </div>
    </aside>
  )
}

export default BookingSummaryPane
