// EditTripCargo: staff (Admin/Dispatcher, from Bookings & Trips) change ONE
// trip's cargo after approval -- type, trailer size, trailer type, weight,
// details (itineraries.cargo_*). Shown under the trips table in
// BookingDetailModal, like the documents panel.
//
// Rules (same as the quote form, lib/quoteRequest.ts): loose cargo always
// goes on a Flatbed, weight > 0 and at most MAX_WEIGHT_TONS, details
// required. Only while the trip is not Delivered/Cancelled. If the trip
// already has a trailer of a different type than the new one, the save is
// refused -- unassign the trailer on the Dispatch Board first -- so a trip
// never ends up on the wrong kind of trailer. The trip and its trailer are
// re-read at save time (the modal can be minutes old).
// Rate, cost and downpayment don't depend on cargo, so nothing else changes.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { MAX_WEIGHT_TONS, type TripCargo } from '../../../lib/quoteRequest'

// Not Delivered and not Cancelled (null status counts as Awaiting).
const ACTIVE_TRIP_FILTER = 'itinerary_status.is.null,itinerary_status.not.in.(Delivered,Cancelled)'

const inputClasses =
  'border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500'

function EditTripCargo({
  itineraryId,
  cargo,
  onSaved,
  onCancel,
}: {
  itineraryId: number
  cargo: TripCargo
  onSaved: () => void
  onCancel: () => void
}) {
  const [cargoType, setCargoType] = useState(cargo.cargo_type === 'Loose' ? 'Loose' : 'Container')
  const [containerType, setContainerType] = useState(cargo.container_type === '40ft' ? '40ft' : '20ft')
  const [trailerType, setTrailerType] = useState(
    cargo.cargo_type === 'Loose' ? 'Flatbed' : (cargo.trailer_type ?? ''),
  )
  const [weight, setWeight] = useState(cargo.weight != null ? String(cargo.weight) : '')
  const [description, setDescription] = useState(cargo.cargo_description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const weightValue = Number(weight)
    if (!trailerType) return setError('Select a trailer type.')
    if (!weight || !(weightValue > 0)) return setError('Enter a weight.')
    if (weightValue > MAX_WEIGHT_TONS) return setError(`Max ${MAX_WEIGHT_TONS} tons.`)
    if (!/^\d+(\.\d{1,2})?$/.test(weight)) return setError('Weight: max 2 decimals.')
    if (!description.trim()) return setError('Enter the cargo details.')

    setSaving(true)
    setError(null)

    // The trailer on the trip RIGHT NOW must fit the new trailer type.
    const { data: trip, error: tripError } = await supabase
      .from('itineraries')
      .select('trailer_id')
      .eq('itinerary_id', itineraryId)
      .maybeSingle()
    if (tripError || !trip) {
      setSaving(false)
      return setError(tripError?.message ?? 'Trip not found.')
    }
    if (trip.trailer_id !== null) {
      const { data: trailer, error: trailerError } = await supabase
        .from('trailers')
        .select('plate_number, trailer_type')
        .eq('trailer_id', trip.trailer_id)
        .maybeSingle()
      if (trailerError) {
        setSaving(false)
        return setError(trailerError.message)
      }
      if (trailer?.trailer_type && trailer.trailer_type !== trailerType) {
        setSaving(false)
        return setError(
          `This trip has a ${trailer.trailer_type} trailer assigned (${trailer.plate_number ?? `#${trip.trailer_id}`}). ` +
            'Unassign it on the Dispatch Board first, then change the cargo.',
        )
      }
    }

    // Only while still active, and check a row really changed (a blocked
    // update reports no error).
    const { data: updated, error: updateError } = await supabase
      .from('itineraries')
      .update({
        cargo_type: cargoType,
        container_type: containerType,
        trailer_type: trailerType,
        weight: weightValue,
        cargo_description: description.trim(),
      })
      .eq('itinerary_id', itineraryId)
      .or(ACTIVE_TRIP_FILTER)
      .select('itinerary_id')
      .maybeSingle()
    setSaving(false)

    if (updateError) return setError(updateError.message)
    if (!updated) return setError('Not saved -- this trip was delivered or cancelled in the meantime.')
    onSaved()
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Cargo type
        <select
          value={cargoType}
          onChange={(e) => {
            setCargoType(e.target.value)
            // Loose cargo can't ride a skeletal trailer.
            if (e.target.value === 'Loose') setTrailerType('Flatbed')
          }}
          className={inputClasses}
        >
          <option value="Container">Container</option>
          <option value="Loose">Loose cargo</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Trailer size
        <select value={containerType} onChange={(e) => setContainerType(e.target.value)} className={inputClasses}>
          <option value="20ft">20 ft</option>
          <option value="40ft">40 ft</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Trailer type{cargoType === 'Loose' && <span className="font-normal text-slate-400">(loose cargo goes on a flatbed)</span>}
        <select
          value={trailerType}
          onChange={(e) => setTrailerType(e.target.value)}
          disabled={cargoType === 'Loose'}
          className={inputClasses}
        >
          <option value="">Select</option>
          <option value="Flatbed">Flatbed</option>
          <option value="Skeletal">Skeletal</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
        Weight (tons)
        <input
          type="text"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ''))}
          aria-invalid={Number(weight) > MAX_WEIGHT_TONS || undefined}
          className={`${inputClasses} ${Number(weight) > MAX_WEIGHT_TONS ? 'border-red-400' : ''}`}
        />
        {Number(weight) > MAX_WEIGHT_TONS && (
          <span className="font-normal text-red-600">Max {MAX_WEIGHT_TONS} tons.</span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
        Cargo details
        <input
          type="text"
          value={description}
          maxLength={300}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClasses}
        />
      </label>
      {error && (
        <p className="text-sm text-red-700 sm:col-span-2" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save cargo'}
        </button>
      </div>
    </div>
  )
}

export default EditTripCargo
