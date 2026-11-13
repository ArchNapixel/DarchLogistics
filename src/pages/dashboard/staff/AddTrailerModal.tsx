// AddTrailerModal: form for adding OR editing a trailer in the real
// trailers table. Pass a `trailer` prop to edit that row (fields
// pre-filled, submit does an UPDATE); omit it to add a new one (submit
// does an INSERT). trailer_id (not shown here) is the actual primary
// key, so plate_number is freely editable, unlike plate_number on
// trucks. Size (trailer_size, '20ft' / '40ft') is required: trips are matched
// on it (lib/trailerRules.ts -- a 40ft trailer may take a 20ft trip). Older
// trailers have none until it's set here.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

const TRAILER_TYPES = ['Flatbed', 'Lowbed', 'Skeletal'] as const
const TRAILER_SIZES = ['20ft', '40ft'] as const

export type EditableTrailer = {
  trailer_id: number
  trailer_type: (typeof TRAILER_TYPES)[number]
  trailer_size: string | null
  plate_number: string | null
}

function AddTrailerModal({
  trailer,
  onClose,
  onSaved,
  onDelete,
}: {
  trailer?: EditableTrailer
  onClose: () => void
  onSaved: () => void
  onDelete?: () => void
}) {
  const isEditing = !!trailer

  const [trailerType, setTrailerType] = useState<(typeof TRAILER_TYPES)[number]>(
    trailer?.trailer_type ?? 'Flatbed',
  )
  const [trailerSize, setTrailerSize] = useState(trailer?.trailer_size ?? '')
  const [plateNumber, setPlateNumber] = useState(trailer?.plate_number ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    // One spelling per plate (uppercase, single spaces); blank = no plate.
    const plate = plateNumber.trim().toUpperCase().replace(/\s+/g, ' ') || null
    if (!trailerSize) {
      setError('Choose the trailer size.')
      return
    }
    setSubmitting(true)
    setError(null)

    // Made 20ft while booked on a 40ft trip that hasn't finished: refuse
    // (the trip would no longer fit -- reassign it first).
    if (isEditing && trailerSize === '20ft' && trailer.trailer_size !== '20ft') {
      const { data: open, error: openError } = await supabase
        .from('itineraries')
        .select('itinerary_id')
        .eq('trailer_id', trailer.trailer_id)
        .eq('container_type', '40ft')
        .not('itinerary_status', 'in', '(Delivered,Cancelled)')
        .limit(1)
      if (openError) {
        setSubmitting(false)
        setError(openError.message)
        return
      }
      if (open.length > 0) {
        setSubmitting(false)
        setError(`This trailer is on 40ft trip #${open[0].itinerary_id}. Give that trip another trailer first.`)
        return
      }
    }

    // Same plate on another trailer (any spelling) = duplicate.
    if (plate) {
      const { data: existing } = await supabase.from('trailers').select('trailer_id, plate_number')
      const clash = (existing ?? []).find(
        (t) =>
          t.trailer_id !== trailer?.trailer_id &&
          (t.plate_number ?? '').toUpperCase().replace(/\s+/g, ' ') === plate,
      )
      if (clash) {
        setSubmitting(false)
        setError(`Trailer #${clash.trailer_id} already has plate ${plate}.`)
        return
      }
    }

    const values = {
      trailer_type: trailerType,
      trailer_size: trailerSize,
      plate_number: plate,
    }

    const { error: saveError } = isEditing
      ? await supabase
          .from('trailers')
          .update(values)
          .eq('trailer_id', trailer.trailer_id)
      : await supabase.from('trailers').insert(values)

    setSubmitting(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            {isEditing ? 'Edit Trailer' : 'Add Trailer'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4">
          <label className={labelClasses}>
            Trailer type
            <select
              value={trailerType}
              onChange={(e) =>
                setTrailerType(e.target.value as (typeof TRAILER_TYPES)[number])
              }
              className={fieldClasses}
            >
              {TRAILER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClasses}>
            Trailer size
            <select value={trailerSize} onChange={(e) => setTrailerSize(e.target.value)} className={fieldClasses}>
              {!trailerSize && <option value="">Choose size</option>}
              {TRAILER_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size === '20ft' ? '20 ft' : '40 ft'}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-slate-500">A 40 ft trailer can also take 20 ft trips.</span>
          </label>

          <label className={labelClasses}>
            Plate number
            <input
              type="text"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              className={fieldClasses}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          {/* Delete only shows when editing (parent passes onDelete) */}
          {onDelete && (
            <button
              onClick={onDelete}
              className="mr-auto px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            {submitting
              ? isEditing
                ? 'Saving...'
                : 'Adding...'
              : isEditing
                ? 'Save Changes'
                : 'Add Trailer'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddTrailerModal
