// ReportDamageForm: the "Report Damage" panel beside the Damage Charges
// table -- for damage found or reported AFTER a trip was marked Delivered
// (e.g. the client calls the next day). Pick one of the last 200 delivered
// trips, describe the damage, and it's saved as a delivery_damage_records
// row. This is the only place damage is reported (Mark Delivered stopped
// asking 2026-11-13). An Admin can also pick who pays here (WhoPaysFields)
// so it's saved already decided; a Dispatcher's report stays "Not decided
// yet" until an Admin decides it from the table.
// Once a trip is picked, photos / documents can be attached to it
// (TripDocuments -- they upload on their own, straight away).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  UNDECIDED,
  damageInputError,
  decideDamage,
  insertDamageRecord,
  type DamageInput,
  type WhoPaysInput,
} from '../../../lib/damageCharges'
import type { InsuranceCompany } from '../../../lib/insuranceCompanies'
import type { ClaimRow } from '../../../lib/insuranceRules'
import { useAuth } from '../../../context/AuthContext'
import DamageFields from './DamageFields'
import WhoPaysFields from './WhoPaysFields'
import TripDocuments from './TripDocuments'
import { formatDate, splitManila } from '../../../lib/format'
import { showToast } from '../../../components/Toast'
import { DELIVERED_STATUSES } from '../../../lib/tripStatusFlow'

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

const EMPTY: DamageInput = { condition: 'Damaged', description: '', cost: '' }

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric focus:border-primary'

function ReportDamageForm({
  companies,
  claims,
  insuranceUnavailable,
  onReported,
}: {
  companies: InsuranceCompany[]
  claims: ClaimRow[]
  insuranceUnavailable: boolean
  onReported: () => void
}) {
  const { role, employeeId } = useAuth()
  const isAdmin = role === 'Admin'
  const [whoPays, setWhoPays] = useState<WhoPaysInput>(UNDECIDED)
  const [trips, setTrips] = useState<DeliveredTrip[] | null>(null)
  const [itineraryId, setItineraryId] = useState('')
  const [damage, setDamage] = useState<DamageInput>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadTrips() {
      // ponytail: most recent 200 delivered trips only; add a search if
      // damage on older trips ever needs reporting.
      const { data: tripRows, error: tripsError } = await supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, trip_date_from, place_of_pickup_id, place_of_delivery_id')
        .in('itinerary_status', DELIVERED_STATUSES)
        .order('trip_date_from', { ascending: false })
        .limit(200)

      if (tripsError) {
        setError(tripsError.message)
        setTrips([])
        return
      }

      const placeIds = Array.from(new Set(tripRows.flatMap((t) => [t.place_of_pickup_id, t.place_of_delivery_id])))
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
            label: `Trip #${t.itinerary_id} · Booking #${t.booking_id} · ${formatDate(t.trip_date_from)} · ${shortPlace(pickup)} → ${shortPlace(delivery)}`,
            route: `${pickup ?? '—'} → ${delivery ?? '—'}`,
          }
        }),
      )
    }

    void loadTrips()
  }, [])

  function clear() {
    setItineraryId('')
    setDamage(EMPTY)
    setWhoPays(UNDECIDED)
    setError(null)
  }

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

    // Admin may decide who pays now; leaving it unpicked saves it undecided.
    let decision
    if (isAdmin && whoPays.chargeTo) {
      const decided = decideDamage(whoPays, {
        cost: Number(damage.cost),
        date: splitManila(new Date()).date,
        companies,
        claims,
        employeeId,
      })
      if ('error' in decided) {
        setError(decided.error)
        return
      }
      decision = decided.columns
    }

    setSubmitting(true)
    setError(null)
    const saveError = await insertDamageRecord(Number(itineraryId), damage, decision)
    setSubmitting(false)

    if (saveError) {
      setError(saveError)
      return
    }
    showToast(
      decision
        ? `Damage reported, charged to ${decision.charge_to}.`
        : isAdmin
          ? 'Damage reported. Click it in the table to choose who pays.'
          : 'Damage reported. An Admin will decide who pays.',
    )
    clear()
    onReported()
  }

  const picked = trips?.find((t) => String(t.itinerary_id) === itineraryId)

  return (
    <section aria-labelledby="rd-h" className="card flex flex-col">
      <div className="border-b border-line px-5 py-4">
        <h2 id="rd-h" className="text-lg leading-[26px] font-bold text-ink">
          Report Damage
        </h2>
      </div>

      <form
        className="flex flex-col gap-3.5 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
      >
        {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Delivered trip</span>
          <select value={itineraryId} onChange={(e) => setItineraryId(e.target.value)} disabled={trips === null} className={fieldClasses}>
            <option value="">{trips === null ? 'Loading trips...' : trips.length === 0 ? 'No delivered trips yet' : 'Choose a trip'}</option>
            {(trips ?? []).map((trip) => (
              <option key={trip.itinerary_id} value={trip.itinerary_id}>
                {trip.label}
              </option>
            ))}
          </select>
          {picked && <span className="text-[13px] text-ink-muted">{picked.route}</span>}
        </label>

        <DamageFields value={damage} onChange={setDamage} />

        {isAdmin && (
          <div className="flex flex-col gap-1">
            <WhoPaysFields
              value={whoPays}
              onChange={setWhoPays}
              cost={Number(damage.cost) || 0}
              date={splitManila(new Date()).date}
              companies={companies}
              claims={claims}
              insuranceUnavailable={insuranceUnavailable}
            />
            {!whoPays.chargeTo && <span className="text-[13px] text-ink-muted">Leave it unpicked to decide later.</span>}
          </div>
        )}

        {picked && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-ink">
              Photos or documents <span className="font-normal text-ink-muted">(optional)</span>
            </p>
            <TripDocuments itineraryId={picked.itinerary_id} canEdit />
          </div>
        )}
      </form>

      <div className="flex justify-end gap-3 border-t border-line px-5 py-4">
        <button type="button" onClick={clear} disabled={submitting} className="btn-secondary px-4 text-sm font-medium">
          Clear
        </button>
        <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="btn-primary px-5 text-sm">
          {submitting ? 'Saving...' : 'Report Damage'}
        </button>
      </div>
    </section>
  )
}

export default ReportDamageForm
