// AddTruckModal: form for adding OR editing a truck in the real
// truck_profiles table. Pass a `truck` prop to edit that row (fields
// pre-filled, submit does an UPDATE); omit it to add a new one (submit
// does an INSERT). plate_number is the table's primary key (and is
// referenced by work_orders), so it's locked/read-only while editing --
// only model/year can change.
//
// Odometer: a new truck can be given its starting reading (a DB trigger
// logs it as the truck's "Starting reading"). After that the odometer only
// changes through trips and real readings on Truck Monitoring, so it's
// read-only here. "Last PMS at" is where the PMS counter starts (blank =
// not set yet: the counter runs from the starting reading).
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { filterAmountInput } from '../../../lib/amountInput'

const fieldClasses =
  'border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'
const disabledFieldClasses =
  'border border-slate-200 bg-slate-100 px-3 py-2 text-slate-500'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

export type EditableTruck = {
  plate_number: string
  model: string | null
  year: number | null
  current_odometer: number | null
  last_pms_odometer: number | null
}

function AddTruckModal({
  truck,
  onClose,
  onSaved,
  onDelete,
}: {
  truck?: EditableTruck
  onClose: () => void
  onSaved: () => void
  onDelete?: () => void
}) {
  const isEditing = !!truck

  const [plateNumber, setPlateNumber] = useState(truck?.plate_number ?? '')
  const [model, setModel] = useState(truck?.model ?? '')
  const [year, setYear] = useState(truck?.year != null ? String(truck.year) : '')
  const [odometer, setOdometer] = useState(truck?.current_odometer != null ? String(truck.current_odometer) : '')
  const [lastPms, setLastPms] = useState(truck?.last_pms_odometer != null ? String(truck.last_pms_odometer) : '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    // One spelling per plate: "abc  123" and "ABC 123" are the same truck.
    const plate = plateNumber.trim().toUpperCase().replace(/\s+/g, ' ')
    if (!plate) {
      setError('Enter a plate number.')
      return
    }
    const thisYear = new Date().getFullYear()
    if (year && (!Number.isInteger(Number(year)) || Number(year) < 1950 || Number(year) > thisYear + 1)) {
      setError(`Enter a year between 1950 and ${thisYear + 1}.`)
      return
    }

    const odometerValue = odometer.trim() === '' ? 0 : Number(odometer)
    if (!Number.isFinite(odometerValue) || odometerValue < 0) {
      setError('Enter a valid odometer reading.')
      return
    }
    const lastPmsValue = lastPms.trim() === '' ? null : Number(lastPms)
    if (lastPmsValue !== null && !Number.isFinite(lastPmsValue)) {
      setError('Enter a valid "Last PMS at" reading.')
      return
    }
    if (lastPmsValue !== null && lastPmsValue > odometerValue) {
      setError(`"Last PMS at" can't be past the odometer (${odometerValue.toLocaleString()} km).`)
      return
    }

    setSubmitting(true)
    setError(null)

    // Plates already saved in other spellings (lowercase, extra spaces)
    // count as the same plate.
    if (!isEditing) {
      const { data: existing } = await supabase.from('truck_profiles').select('plate_number')
      if ((existing ?? []).some((t) => t.plate_number.toUpperCase().replace(/\s+/g, ' ') === plate)) {
        setSubmitting(false)
        setError(`A truck with plate ${plate} already exists.`)
        return
      }
    }

    const values = {
      model: model.trim() || null,
      year: year ? Number(year) : null,
      last_pms_odometer: lastPmsValue,
    }

    const { error: saveError } = isEditing
      ? await supabase
          .from('truck_profiles')
          .update(values)
          .eq('plate_number', truck.plate_number)
      : await supabase
          .from('truck_profiles')
          .insert({ ...values, plate_number: plate, current_odometer: odometerValue })

    setSubmitting(false)

    if (saveError) {
      // 23505 = unique violation: someone added the same plate meanwhile.
      setError(saveError.code === '23505' ? `A truck with plate ${plate} already exists.` : saveError.message)
      return
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
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
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
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

          <label className={labelClasses}>
            Odometer (km)
            <input
              inputMode="decimal"
              value={odometer}
              onChange={(e) => setOdometer(filterAmountInput(e.target.value))}
              disabled={isEditing}
              placeholder={isEditing ? '' : '0'}
              className={isEditing ? disabledFieldClasses : fieldClasses}
            />
            {isEditing && (
              <span className="text-[13px] font-normal text-slate-500">Change it with a real reading on Truck Monitoring.</span>
            )}
          </label>

          <label className={labelClasses}>
            <span>
              Last PMS at (km) <span className="font-normal text-slate-500">(optional)</span>
            </span>
            <input
              inputMode="decimal"
              value={lastPms}
              onChange={(e) => setLastPms(filterAmountInput(e.target.value))}
              className={fieldClasses}
            />
            <span className="text-[13px] font-normal text-slate-500">
              The odometer reading at this truck's last PMS. Blank = the PMS count starts from the odometer when it was added.
            </span>
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
                : 'Add Truck'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddTruckModal
