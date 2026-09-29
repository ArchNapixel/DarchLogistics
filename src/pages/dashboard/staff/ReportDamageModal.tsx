// ReportDamageModal: "Report damage" on the Damage Charges page -- for
// damage found or reported AFTER a trip was marked Delivered (e.g. the
// client calls the next day). Pick a delivered trip, describe the damage,
// and it's saved as a delivery_damage_records row, same as reporting it
// from MarkDeliveredModal on the Dispatch Board.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { formatDate } from '../../../lib/quoteRequest'
import { damageInputError, insertDamageRecord, type DamageInput } from '../../../lib/damageCharges'
import DamageFields from './DamageFields'

type DeliveredTrip = {
  itinerary_id: number
  label: string // short, for the dropdown
  route: string // full place names, shown under it once picked
}

// "Brgy. San Pedro, Panabo City" -> "San Pedro" -- keeps dropdown options
// short (the browser draws the open list as wide as the longest option).
function shortPlace(name: string | undefined) {
  if (!name) return '—'
  return name.split(',')[0].replace(/^Brgy\.?\s*/i, '')
}

const fieldClasses =
  'w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex min-w-0 flex-col gap-1 text-sm font-medium text-slate-700'

function ReportDamageModal({
  onClose,
  onReported,
}: {
  onClose: () => void
  onReported: () => void
}) {
  const [trips, setTrips] = useState<DeliveredTrip[] | null>(null)
  const [itineraryId, setItineraryId] = useState('')
  const [damage, setDamage] = useState<DamageInput>({
    condition: 'Damaged',
    description: '',
    cost: '',
    chargeTo: 'Client',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadTrips() {
      // ponytail: most recent 200 delivered trips only; add a search if
      // damage on older trips ever needs reporting.
      const { data: tripRows, error: tripsError } = await supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, trip_date_from, place_of_pickup_id, place_of_delivery_id')
        .eq('itinerary_status', 'Delivered')
        .order('trip_date_from', { ascending: false })
        .limit(200)

      if (tripsError) {
        setError(tripsError.message)
        setTrips([])
        return
      }

      const placeIds = Array.from(
        new Set(tripRows.flatMap((t) => [t.place_of_pickup_id, t.place_of_delivery_id])),
      )
      const { data: places, error: placesError } =
        placeIds.length > 0
          ? await supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
          : { data: [], error: null }

      if (placesError) {
        setError(placesError.message)
        setTrips([])
        return
      }

      const placeName = new Map((places ?? []).map((p) => [p.place_id, p.place_name]))
      setTrips(
        tripRows.map((t) => {
          const pickup = placeName.get(t.place_of_pickup_id)
          const delivery = placeName.get(t.place_of_delivery_id)
          return {
            itinerary_id: t.itinerary_id,
            label:
              `Booking #${t.booking_id} · ${formatDate(t.trip_date_from)} · ` +
              `${shortPlace(pickup)} → ${shortPlace(delivery)}`,
            route: `${pickup ?? '—'} → ${delivery ?? '—'}`,
          }
        }),
      )
    }

    void loadTrips()
  }, [])

  async function handleSubmit() {
    if (!itineraryId) {
      setError('Pick the delivered trip the damage belongs to.')
      return
    }
    const inputError = damageInputError(damage)
    if (inputError) {
      setError(inputError)
      return
    }

    setSubmitting(true)
    setError(null)
    const saveError = await insertDamageRecord(Number(itineraryId), damage)
    setSubmitting(false)

    if (saveError) {
      setError(saveError)
      return
    }
    onReported()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Report Damage</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          For damage found after a trip was delivered. To report it while
          delivering, use Mark delivered on the Dispatch Board.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4 grid gap-4">
          <label className={labelClasses}>
            Delivered trip
            <select
              value={itineraryId}
              onChange={(e) => setItineraryId(e.target.value)}
              disabled={trips === null}
              className={fieldClasses}
            >
              <option value="">
                {trips === null
                  ? 'Loading trips...'
                  : trips.length === 0
                    ? 'No delivered trips yet'
                    : 'Select a trip'}
              </option>
              {(trips ?? []).map((trip) => (
                <option key={trip.itinerary_id} value={trip.itinerary_id}>
                  {trip.label}
                </option>
              ))}
            </select>
            {itineraryId && (
              <span className="text-xs font-normal text-slate-500">
                {trips?.find((t) => String(t.itinerary_id) === itineraryId)?.route}
              </span>
            )}
          </label>

          <DamageFields value={damage} onChange={setDamage} allowGood={false} />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Report Damage'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReportDamageModal
