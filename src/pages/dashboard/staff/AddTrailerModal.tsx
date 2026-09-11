// AddTrailerModal: form for adding OR editing a trailer in the real
// trailers table. Pass a `trailer` prop to edit that row (fields
// pre-filled, submit does an UPDATE); omit it to add a new one (submit
// does an INSERT). trailer_id (not shown here) is the actual primary
// key, so plate_number is freely editable, unlike plate_number on
// trucks.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

const TRAILER_TYPES = ['Flatbed', 'Lowbed', 'Skeletal'] as const

export type EditableTrailer = {
  trailer_id: number
  trailer_type: (typeof TRAILER_TYPES)[number]
  plate_number: string | null
}

function AddTrailerModal({
  trailer,
  onClose,
  onSaved,
}: {
  trailer?: EditableTrailer
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = !!trailer

  const [trailerType, setTrailerType] = useState<(typeof TRAILER_TYPES)[number]>(
    trailer?.trailer_type ?? 'Flatbed',
  )
  const [plateNumber, setPlateNumber] = useState(trailer?.plate_number ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    const values = {
      trailer_type: trailerType,
      plate_number: plateNumber.trim() || null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
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
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
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
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
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
