// AddTrailerModal: form for adding a trailer, inserting into the real
// trailers table. current_status defaults to 'Available' at the
// database level, so it's not asked for here.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function AddTrailerModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [trailerType, setTrailerType] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!trailerType.trim()) {
      setError('Enter a trailer type.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('trailers').insert({
      trailer_type: trailerType.trim(),
      plate_number: plateNumber.trim() || null,
      registration_number: registrationNumber.trim() || null,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Add Trailer</h3>
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
            <input
              type="text"
              value={trailerType}
              onChange={(e) => setTrailerType(e.target.value)}
              placeholder="e.g. Flatbed, Van, 40ft Container"
              className={fieldClasses}
            />
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

          <label className={labelClasses}>
            Registration number
            <input
              type="text"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
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
            {submitting ? 'Adding...' : 'Add Trailer'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddTrailerModal
