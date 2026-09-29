// ScheduleMaintenanceModal: lets a mechanic flag a truck or trailer as
// needing maintenance sometime in the future (e.g. "oil change due in
// 3 months"), so admin/dispatch can plan ahead instead of only finding
// out once something actually breaks. Shows up for staff in
// MaintenanceSchedulesSection.tsx (Reports page and Maintenance page).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  createMaintenanceSchedule,
  MAINTENANCE_INTERVALS,
  type MaintenanceInterval,
} from '../../../lib/maintenanceSchedules'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type VehicleOption = {
  key: string
  label: string
  plateNumber: string | null
  trailerId: number | null
}

function ScheduleMaintenanceModal({
  employeeId,
  onClose,
  onScheduled,
}: {
  employeeId: number
  onClose: () => void
  onScheduled: () => void
}) {
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>([])
  const [selectedVehicleKey, setSelectedVehicleKey] = useState('')
  const [maintenanceType, setMaintenanceType] = useState('')
  const [dueInterval, setDueInterval] = useState<MaintenanceInterval>(MAINTENANCE_INTERVALS[0])
  const [notes, setNotes] = useState('')
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadOptions()
  }, [])

  async function loadOptions() {
    setLoadingOptions(true)

    const [trucksResult, trailersResult] = await Promise.all([
      supabase.from('truck_profiles').select('plate_number, model').order('plate_number'),
      supabase
        .from('trailers')
        .select('trailer_id, plate_number, trailer_type')
        .order('trailer_id'),
    ])

    if (trucksResult.error) {
      setError(trucksResult.error.message)
      setLoadingOptions(false)
      return
    }
    if (trailersResult.error) {
      setError(trailersResult.error.message)
      setLoadingOptions(false)
      return
    }

    const options: VehicleOption[] = [
      ...trucksResult.data.map((t) => ({
        key: `truck-${t.plate_number}`,
        label: `Truck: ${t.plate_number}${t.model ? ` (${t.model})` : ''}`,
        plateNumber: t.plate_number,
        trailerId: null,
      })),
      ...trailersResult.data.map((t) => ({
        key: `trailer-${t.trailer_id}`,
        label: `Trailer: ${t.plate_number ?? `#${t.trailer_id}`} (${t.trailer_type})`,
        plateNumber: null,
        trailerId: t.trailer_id,
      })),
    ]

    setVehicleOptions(options)
    setSelectedVehicleKey(options[0]?.key ?? '')
    setLoadingOptions(false)
  }

  async function handleSubmit() {
    const selectedVehicle = vehicleOptions.find((v) => v.key === selectedVehicleKey)

    if (!selectedVehicle) {
      setError('Select a truck or trailer.')
      return
    }
    if (!maintenanceType.trim()) {
      setError('Describe what maintenance is needed (e.g. Oil change).')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: createError } = await createMaintenanceSchedule({
      plateNumber: selectedVehicle.plateNumber,
      trailerId: selectedVehicle.trailerId,
      reportedByEmployeeId: employeeId,
      maintenanceType: maintenanceType.trim(),
      notes,
      interval: dueInterval,
    })

    setSubmitting(false)

    if (createError) {
      setError(createError)
      return
    }

    onScheduled()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Schedule Maintenance</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        {loadingOptions ? (
          <p className="mt-4 text-slate-500">Loading...</p>
        ) : vehicleOptions.length === 0 ? (
          <p className="mt-4 text-slate-500">
            No trucks or trailers found. Add one under Fleet first.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            <label className={labelClasses}>
              Truck or trailer
              <select
                value={selectedVehicleKey}
                onChange={(e) => setSelectedVehicleKey(e.target.value)}
                className={fieldClasses}
              >
                {vehicleOptions.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClasses}>
              What maintenance is needed?
              <input
                type="text"
                value={maintenanceType}
                onChange={(e) => setMaintenanceType(e.target.value)}
                placeholder="e.g. Oil change"
                className={fieldClasses}
              />
            </label>

            <label className={labelClasses}>
              Due in
              <select
                value={dueInterval}
                onChange={(e) => setDueInterval(e.target.value as MaintenanceInterval)}
                className={fieldClasses}
              >
                {MAINTENANCE_INTERVALS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClasses}>
              Notes (optional)
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className={fieldClasses}
              />
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || vehicleOptions.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Schedule Maintenance'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ScheduleMaintenanceModal
