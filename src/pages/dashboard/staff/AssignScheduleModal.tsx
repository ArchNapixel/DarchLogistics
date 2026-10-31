// AssignScheduleModal: staff's "Assign Schedule" -- a maintenance reminder
// for a truck (maintenance_schedules via createMaintenanceSchedule, the same
// table mechanics' ScheduleMaintenanceModal writes to). Opened from the
// Maintenance page's Schedules tab and from a truck on the Fleet page
// (`plateNumber` picks that truck first). Used to live inside Truck
// Monitoring. Trucks only, as before.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  createMaintenanceSchedule,
  MAINTENANCE_INTERVALS,
  SCHEDULE_TYPES,
  type MaintenanceInterval,
} from '../../../lib/maintenanceSchedules'

const fieldClasses =
  'border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type Truck = { plate_number: string; model: string | null }

function AssignScheduleModal({
  employeeId,
  plateNumber: initialPlate,
  onClose,
  onSaved,
}: {
  employeeId: number
  plateNumber?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [plateNumber, setPlateNumber] = useState(initialPlate ?? '')
  const [maintenanceType, setMaintenanceType] = useState<string>(SCHEDULE_TYPES[0])
  const [interval, setInterval] = useState<MaintenanceInterval>(MAINTENANCE_INTERVALS[0])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('truck_profiles')
      .select('plate_number, model')
      .eq('is_active', true)
      .order('plate_number')
      .then(({ data, error: loadError }) => {
        if (loadError) setError(loadError.message)
        setTrucks(data ?? [])
        setPlateNumber((current) => current || data?.[0]?.plate_number || '')
      })
  }, [])

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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Assign Maintenance Schedule</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        {error && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

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
          <button onClick={onClose} disabled={saving} className="btn-secondary px-4 text-sm font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || trucks.length === 0} className="btn-primary px-4 text-sm font-medium">
            {saving ? 'Saving...' : 'Assign Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AssignScheduleModal
