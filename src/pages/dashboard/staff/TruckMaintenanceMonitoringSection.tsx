import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { fetchDrivingDistanceKm, geocodePlace } from '../../../lib/geocoding'
import {
  createMaintenanceSchedule,
  MAINTENANCE_INTERVALS,
  SCHEDULE_TYPES,
  type MaintenanceInterval,
} from '../../../lib/maintenanceSchedules'
import MaintenanceSchedulesSection from './MaintenanceSchedulesSection'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type Truck = {
  plate_number: string
  model: string | null
}

type OdometerSuggestion = {
  itinerary_id: number
  plate_number: string
  trip_date: string
  // Base -> pickup. 0 (and flagged) when it couldn't be routed.
  out_km: number
  out_is_fallback: boolean
  trip_km: number
  return_km: number
  // True when the drive back to base couldn't be routed and the trip
  // distance was used for it instead (same road back).
  return_is_fallback: boolean
  current_odometer: number
  suggested_odometer: number
}

// Every truck leaves from and heads back to here, so the odometer moves
// by base -> pickup + the delivery trip + delivery -> base. Only this
// odometer feature uses the two base legs -- the quote's profitability
// estimate stays one-way (bookings.estimated_distance_km) on purpose.
const BASE = { city: 'Panabo City', barangay: 'J.P. Laurel' }

// One end of a booking: its places row plus the exact pin, if any.
type Stop = {
  placeId: number | null
  place: { city: string | null; barangay: string | null } | undefined
  lat: number | null
  lng: number | null
}

// Driving km between a booking's stop (pickup or delivery) and BASE:
// a distance already cached in route_cache for that barangay pair if
// there is one, else routed from the stop's pin (or its barangay's
// centre when there's no pin) to the base barangay's centre. Road
// distance is treated as the same both ways, same as route_cache.
// Null when nothing works (no place, geocode/routing failure).
async function baseLegKm(
  stop: Stop,
  basePlaceId: number | null,
  basePoint: { lat: number; lon: number } | null,
): Promise<number | null> {
  if (stop.placeId !== null && basePlaceId !== null) {
    const [low, high] = [stop.placeId, basePlaceId].sort((a, b) => a - b)
    const { data: cached } = await supabase
      .from('route_cache')
      .select('distance_km')
      .eq('place_id_a', low)
      .eq('place_id_b', high)
      .maybeSingle()
    if (cached?.distance_km !== undefined && cached?.distance_km !== null) {
      return Number(cached.distance_km)
    }
  }

  if (!basePoint) return null
  try {
    const from =
      typeof stop.lat === 'number' && typeof stop.lng === 'number'
        ? { lat: stop.lat, lon: stop.lng }
        : stop.place?.city && stop.place?.barangay
          ? await geocodePlace(`Barangay ${stop.place.barangay}, ${stop.place.city}, Philippines`)
          : null
    if (!from) return null
    return await fetchDrivingDistanceKm(from, basePoint)
  } catch {
    return null
  }
}

type Tab = 'Schedules' | 'Odometer Updates'

function AssignTruckScheduleModal({
  trucks,
  employeeId,
  onClose,
  onSaved,
}: {
  trucks: Truck[]
  employeeId: number
  onClose: () => void
  onSaved: () => void
}) {
  const [plateNumber, setPlateNumber] = useState(trucks[0]?.plate_number ?? '')
  const [maintenanceType, setMaintenanceType] = useState<string>(SCHEDULE_TYPES[0])
  const [interval, setInterval] = useState<MaintenanceInterval>(MAINTENANCE_INTERVALS[0])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!plateNumber) {
      setError('Select a truck.')
      return
    }
    if (!maintenanceType.trim()) {
      setError('Enter the maintenance type.')
      return
    }

    setSaving(true)
    setError(null)
    const { error: saveError } = await createMaintenanceSchedule({
      plateNumber,
      trailerId: null,
      reportedByEmployeeId: employeeId,
      maintenanceType: maintenanceType.trim(),
      notes,
      interval,
    })
    setSaving(false)

    if (saveError) {
      setError(saveError)
      return
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Assign Maintenance Schedule</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="mt-4 grid gap-4">
          <label className={labelClasses}>
            Truck
            <select value={plateNumber} onChange={(event) => setPlateNumber(event.target.value)} className={fieldClasses}>
              {trucks.map((truck) => (
                <option key={truck.plate_number} value={truck.plate_number}>
                  {truck.plate_number}{truck.model ? ` (${truck.model})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClasses}>
            Maintenance type
            <select value={maintenanceType} onChange={(event) => setMaintenanceType(event.target.value)} className={fieldClasses}>
              {SCHEDULE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className={labelClasses}>
            Due in
            <select value={interval} onChange={(event) => setInterval(event.target.value as MaintenanceInterval)} className={fieldClasses}>
              {MAINTENANCE_INTERVALS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className={labelClasses}>
            Notes (optional)
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className={fieldClasses} />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || trucks.length === 0} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Assign Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

function OdometerUpdatesSection() {
  const [suggestions, setSuggestions] = useState<OdometerSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)

  async function loadSuggestions() {
    setLoading(true)
    setError(null)

    const [trucksResult, itinerariesResult, logsResult] = await Promise.all([
      supabase.from('truck_profiles').select('plate_number, current_odometer, updated_at'),
      supabase.from('itineraries').select('itinerary_id, booking_id, trip_date_from, plate_number').eq('itinerary_status', 'Delivered').not('plate_number', 'is', null),
      supabase.from('dispatch_status_logs').select('itinerary_id, status_changed_at').eq('new_status', 'Delivered').order('status_changed_at', { ascending: false }),
    ])

    const firstError = trucksResult.error ?? itinerariesResult.error ?? logsResult.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const deliveredItineraries = itinerariesResult.data ?? []
    const bookingIds = Array.from(new Set(deliveredItineraries.map((row) => row.booking_id)))
    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select(
        'booking_id, estimated_distance_km, place_of_pickup_id, pickup_lat, pickup_lng, place_of_delivery_id, delivery_lat, delivery_lng',
      )
      .in('booking_id', bookingIds)

    if (bookingsError) {
      setError(bookingsError.message)
      setLoading(false)
      return
    }

    const truckByPlate = new Map((trucksResult.data ?? []).map((truck) => [truck.plate_number, truck]))
    const bookingById = new Map((bookingRows ?? []).map((booking) => [booking.booking_id, booking]))
    const deliveredAtByItinerary = new Map((logsResult.data ?? []).map((log) => [log.itinerary_id, log.status_changed_at]))
    const latestByTruck = new Map<string, (typeof deliveredItineraries)[number]>()

    deliveredItineraries.forEach((itinerary) => {
      if (!itinerary.plate_number || !deliveredAtByItinerary.get(itinerary.itinerary_id)) return
      const existing = latestByTruck.get(itinerary.plate_number)
      if (!existing || itinerary.trip_date_from > existing.trip_date_from) {
        latestByTruck.set(itinerary.plate_number, itinerary)
      }
    })

    const candidates = Array.from(latestByTruck.values()).flatMap((itinerary) => {
      const truck = truckByPlate.get(itinerary.plate_number)
      const booking = bookingById.get(itinerary.booking_id)
      const tripKm = Number(booking?.estimated_distance_km ?? 0)
      const deliveredAt = deliveredAtByItinerary.get(itinerary.itinerary_id)
      if (!truck || !booking || !tripKm || !deliveredAt || deliveredAt <= truck.updated_at) return []
      return [{ itinerary, truck, booking, tripKm }]
    })

    // Base leg lookups (base -> pickup, delivery -> base), only for the
    // trucks that actually have a pending suggestion (at most one per truck).
    const stopPlaceIds = Array.from(
      new Set(
        candidates
          .flatMap((c) => [c.booking.place_of_pickup_id, c.booking.place_of_delivery_id])
          .filter((id): id is number => id !== null),
      ),
    )
    const [placesResult, baseResult, basePoint] = await Promise.all([
      stopPlaceIds.length > 0
        ? supabase.from('places').select('place_id, city, barangay').in('place_id', stopPlaceIds)
        : Promise.resolve({ data: [] as { place_id: number; city: string | null; barangay: string | null }[] }),
      supabase
        .from('places')
        .select('place_id')
        .ilike('city', BASE.city)
        .ilike('barangay', BASE.barangay)
        .maybeSingle(),
      candidates.length > 0
        ? geocodePlace(`Barangay ${BASE.barangay}, ${BASE.city}, Philippines`)
        : Promise.resolve(null),
    ])
    const placeById = new Map((placesResult.data ?? []).map((place) => [place.place_id, place]))
    const basePlaceId = baseResult.data?.place_id ?? null
    const stop = (placeId: number | null, lat: number | null, lng: number | null): Stop => ({
      placeId,
      place: placeId !== null ? placeById.get(placeId) : undefined,
      lat,
      lng,
    })
    const round = (km: number) => Math.round(km * 100) / 100

    const nextSuggestions: OdometerSuggestion[] = []
    for (const { itinerary, truck, booking, tripKm } of candidates) {
      const routedOutKm = await baseLegKm(
        stop(booking.place_of_pickup_id, booking.pickup_lat, booking.pickup_lng),
        basePlaceId,
        basePoint,
      )
      const routedReturnKm = await baseLegKm(
        stop(booking.place_of_delivery_id, booking.delivery_lat, booking.delivery_lng),
        basePlaceId,
        basePoint,
      )
      // Can't route the drive out -> leave it out (flagged) rather than
      // guess. Can't route the drive back -> assume the same road back.
      const outKm = routedOutKm ?? 0
      const returnKm = routedReturnKm ?? tripKm
      const current = Number(truck.current_odometer ?? 0)
      nextSuggestions.push({
        itinerary_id: itinerary.itinerary_id,
        plate_number: itinerary.plate_number,
        trip_date: itinerary.trip_date_from,
        out_km: round(outKm),
        out_is_fallback: routedOutKm === null,
        trip_km: tripKm,
        return_km: round(returnKm),
        return_is_fallback: routedReturnKm === null,
        current_odometer: current,
        suggested_odometer: round(current + outKm + tripKm + returnKm),
      })
    }

    setSuggestions(nextSuggestions)
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSuggestions()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function confirmSuggestion(suggestion: OdometerSuggestion) {
    setSavingId(suggestion.itinerary_id)
    setError(null)
    const { data: updated, error: updateError } = await supabase
      .from('truck_profiles')
      .update({ current_odometer: suggestion.suggested_odometer, updated_at: new Date().toISOString() })
      .eq('plate_number', suggestion.plate_number)
      .eq('current_odometer', suggestion.current_odometer)
      .select('plate_number')
      .maybeSingle()

    setSavingId(null)
    if (updateError) {
      setError(`Could not confirm ${suggestion.plate_number}: ${updateError.message}`)
      return
    }
    if (!updated) {
      // The .eq('current_odometer', ...) guard matched 0 rows -- someone
      // else already updated this truck's odometer since the page loaded.
      setError(`${suggestion.plate_number}'s odometer was already updated by someone else. Refresh to see the latest value.`)
      return
    }

    setSuggestions((current) => current.filter((item) => item.itinerary_id !== suggestion.itinerary_id))
  }

  if (loading) return <p className="text-slate-500">Loading odometer suggestions...</p>
  if (error) return <p className="text-red-700">{error}</p>
  if (suggestions.length === 0) return <p className="text-slate-500">No odometer updates are waiting for confirmation.</p>

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Truck</th>
            <th className="px-4 py-3 font-medium">Trip date</th>
            <th className="px-4 py-3 font-medium">J.P. Laurel to pickup</th>
            <th className="px-4 py-3 font-medium">Delivery trip</th>
            <th className="px-4 py-3 font-medium">Return to J.P. Laurel</th>
            <th className="px-4 py-3 font-medium">Current</th>
            <th className="px-4 py-3 font-medium">Suggested</th>
            <th className="px-4 py-3 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((suggestion) => (
            <tr key={suggestion.itinerary_id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-3 font-medium text-slate-900">{suggestion.plate_number}</td>
              <td className="px-4 py-3 text-slate-600">{suggestion.trip_date}</td>
              <td className="px-4 py-3 text-slate-600">
                {suggestion.out_km.toLocaleString()} km
                {suggestion.out_is_fallback && (
                  <span className="block text-xs text-amber-700">Couldn't route it, not counted</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{suggestion.trip_km.toLocaleString()} km</td>
              <td className="px-4 py-3 text-slate-600">
                {suggestion.return_km.toLocaleString()} km
                {suggestion.return_is_fallback && (
                  <span className="block text-xs text-amber-700">Couldn't route it, assumed same as trip</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{suggestion.current_odometer.toLocaleString()}</td>
              <td className="px-4 py-3 font-medium text-slate-900">{suggestion.suggested_odometer.toLocaleString()}</td>
              <td className="px-4 py-3">
                <button onClick={() => confirmSuggestion(suggestion)} disabled={savingId === suggestion.itinerary_id} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                  {savingId === suggestion.itinerary_id ? 'Saving...' : 'Confirm update'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TruckMaintenanceMonitoringSection() {
  const { employeeId } = useAuth()
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('Schedules')
  const [showAssign, setShowAssign] = useState(false)
  const [schedulesVersion, setSchedulesVersion] = useState(0)
  const [loadingTrucks, setLoadingTrucks] = useState(true)
  const [truckError, setTruckError] = useState<string | null>(null)

  useEffect(() => {
    async function loadTrucks() {
      const { data, error } = await supabase
        .from('truck_profiles')
        .select('plate_number, model')
        .order('plate_number')
      if (error) setTruckError(error.message)
      setTrucks(data ?? [])
      setLoadingTrucks(false)
    }
    loadTrucks()
  }, [])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Truck Maintenance Monitoring</h2>
          <p className="mt-1 text-sm text-slate-500">Assign schedules, review upcoming maintenance, and confirm truck mileage updates.</p>
        </div>
        {activeTab === 'Schedules' && (
          <button onClick={() => setShowAssign(true)} disabled={loadingTrucks || trucks.length === 0 || !employeeId} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            Assign schedule
          </button>
        )}
      </div>

      {truckError && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{truckError}</p>}
      <div className="mt-6 flex gap-2 border-b border-slate-200">
        {(['Schedules', 'Odometer Updates'] as Tab[]).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium ${activeTab === tab ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {/* key bump remounts the list so a just-assigned schedule shows up */}
        {activeTab === 'Schedules' ? <MaintenanceSchedulesSection key={schedulesVersion} /> : <OdometerUpdatesSection />}
      </div>

      {showAssign && employeeId && (
        <AssignTruckScheduleModal
          trucks={trucks}
          employeeId={employeeId}
          onClose={() => setShowAssign(false)}
          onSaved={() => {
            setShowAssign(false)
            setSchedulesVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}

export default TruckMaintenanceMonitoringSection