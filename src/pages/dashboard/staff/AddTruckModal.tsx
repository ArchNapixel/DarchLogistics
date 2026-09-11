// AddTruckModal: form for adding OR editing a truck in the real
// truck_profiles table. Pass a `truck` prop to edit that row (fields
// pre-filled, submit does an UPDATE); omit it to add a new one (submit
// does an INSERT). plate_number is the table's primary key (and is
// referenced by work_orders), so it's locked/read-only while editing --
// only model/year can change.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const disabledFieldClasses =
  'rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-slate-500'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

export type EditableTruck = {
  plate_number: string
  model: string | null
  year: number | null
}

function AddTruckModal({
  truck,
  onClose,
  onSaved,
}: {
  truck?: EditableTruck
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = !!truck

  const [plateNumber, setPlateNumber] = useState(truck?.plate_number ?? '')
  const [model, setModel] = useState(truck?.model ?? '')
  const [year, setYear] = useState(truck?.year != null ? String(truck.year) : '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!plateNumber.trim()) {
      setError('Enter a plate number.')
      return
    }

    setSubmitting(true)
    setError(null)

    const values = {
      model: model.trim() || null,
      year: year ? Number(year) : null,
    }

    const { error: saveError } = isEditing
      ? await supabase
          .from('truck_profiles')
          .update(values)
          .eq('plate_number', truck.plate_number)
      : await supabase
          .from('truck_profiles')
          .insert({ ...values, plate_number: plateNumber.trim() })

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
            {isEditing ? 'Edit Truck' : 'Add Truck'}
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
            Plate number
            <input
              type="text"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              disabled={isEditing}
              className={isEditing ? disabledFieldClasses : fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Model
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Year
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
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
                : 'Add Truck'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddTruckModal
