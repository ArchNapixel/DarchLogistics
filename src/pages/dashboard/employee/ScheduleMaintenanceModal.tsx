// ScheduleMaintenanceModal: lets a mechanic flag a truck or trailer as
// needing maintenance sometime in the future (e.g. "oil change due in
// 3 months"; the canvas's "Schedule Maintenance" board), so admin/dispatch
// can plan ahead instead of only finding out once something actually
// breaks. No approval needed -- it shows for staff on Maintenance ->
// Schedules (and Reports), and in Truck Monitoring's alerts when it's close.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  createMaintenanceSchedule,
  MAINTENANCE_INTERVALS,
  SCHEDULE_TYPES,
  type MaintenanceInterval,
} from '../../../lib/maintenanceSchedules'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const labelClasses = 'flex justify-between gap-2 text-sm font-semibold text-ink'

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
  const [trucks, setTrucks] = useState<VehicleOption[]>([])
  const [trailers, setTrailers] = useState<VehicleOption[]>([])
  const [selectedVehicleKey, setSelectedVehicleKey] = useState('')
  const [maintenanceType, setMaintenanceType] = useState('')
  const [dueInterval, setDueInterval] = useState<MaintenanceInterval>(MAINTENANCE_INTERVALS[1] ?? MAINTENANCE_INTERVALS[0])
  const [notes, setNotes] = useState('')
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadOptions() {
      const [trucksResult, trailersResult] = await Promise.all([
        supabase.from('truck_profiles').select('plate_number, model').eq('is_active', true).order('plate_number'),
        supabase.from('trailers').select('trailer_id, plate_number, trailer_type').eq('is_active', true).order('trailer_id'),
      ])

      if (trucksResult.error || trailersResult.error) {
        setError((trucksResult.error ?? trailersResult.error)!.message)
        setLoadingOptions(false)
        return
      }

      setTrucks(
        trucksResult.data.map((t) => ({
          key: `truck-${t.plate_number}`,
          label: `${t.plate_number}${t.model ? ` (${t.model})` : ''}`,
          plateNumber: t.plate_number,
          trailerId: null,
        })),
      )
      setTrailers(
        trailersResult.data.map((t) => ({
          key: `trailer-${t.trailer_id}`,
          label: `${t.plate_number ?? `#${t.trailer_id}`} (${t.trailer_type})`,
          plateNumber: null,
          trailerId: t.trailer_id,
        })),
      )
      setLoadingOptions(false)
    }
    void loadOptions()
  }, [])

  async function handleSubmit() {
    const selectedVehicle = [...trucks, ...trailers].find((v) => v.key === selectedVehicleKey)

    if (!selectedVehicle) {
      setError('Choose a truck or trailer.')
      return
    }
    if (!maintenanceType) {
      setError("Choose what's needed (e.g. Oil Change).")
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: createError } = await createMaintenanceSchedule({
      plateNumber: selectedVehicle.plateNumber,
      trailerId: selectedVehicle.trailerId,
      reportedByEmployeeId: employeeId,
      maintenanceType,
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="schedule-title" className="card w-full max-w-[560px]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="schedule-title" className="text-xl leading-7 font-bold text-ink">
              Schedule Maintenance
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">A reminder for later, such as an oil change in 3 months.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>

        <form
          className="flex flex-col gap-4 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
        >
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <label className="flex flex-col gap-1.5">
            <span className={labelClasses}>
              <span>Vehicle</span>
              <span className="text-xs text-amber-800">Required</span>
            </span>
            <select
              value={selectedVehicleKey}
              onChange={(e) => setSelectedVehicleKey(e.target.value)}
              disabled={loadingOptions}
              className={fieldClasses}
            >
              <option value="">{loadingOptions ? 'Loading vehicles…' : 'Choose a truck or trailer'}</option>
              {trucks.length > 0 && (
                <optgroup label="Trucks">
                  {trucks.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {trailers.length > 0 && (
                <optgroup label="Trailers">
                  {trailers.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelClasses}>
              <span>What's needed?</span>
              <span className="text-xs text-amber-800">Required</span>
            </span>
            <select value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)} className={fieldClasses}>
              <option value="">Choose one</option>
              {SCHEDULE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className={`${labelClasses} w-full pb-1.5`}>Due in</legend>
            <div className="grid grid-cols-3 gap-2">
              {MAINTENANCE_INTERVALS.map((option) => (
                <label
                  key={option}
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 px-2.5 text-sm font-semibold text-ink ${
                    dueInterval === option ? 'border-2 border-primary bg-primary-soft' : 'border border-line-control'
                  }`}
                >
                  <input
                    type="radio"
                    name="schedule-due"
                    checked={dueInterval === option}
                    onChange={() => setDueInterval(option)}
                    className="h-[18px] w-[18px] accent-primary"
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className={labelClasses}>
              <span>
                Notes <span className="font-normal text-ink-muted">(optional)</span>
              </span>
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              className={`${fieldClasses} resize-none py-2.5`}
            />
          </label>

          <p className="border border-line bg-slate-50 px-3.5 py-3 text-[13px] leading-[18px] text-ink-secondary">
            No approval needed. It shows on Maintenance → Schedules, and in Truck Monitoring alerts when it's close.
          </p>
        </form>

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || loadingOptions || trucks.length + trailers.length === 0}
            className="btn-primary px-6 text-sm"
          >
            {submitting ? 'Saving...' : 'Save Schedule'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default ScheduleMaintenanceModal
