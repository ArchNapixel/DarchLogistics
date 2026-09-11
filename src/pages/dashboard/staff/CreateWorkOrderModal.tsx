// CreateWorkOrderModal: staff creates a work order for a truck OR a
// trailer (exactly one, enforced by a DB check constraint) and assigns
// a mechanic. work_order_number is generated automatically so staff
// doesn't have to invent a unique one. work_order_status defaults to
// 'Created' at the database level.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

const MAINTENANCE_TYPES = ['Routine', 'Preventive', 'Predictive', 'Corrective'] as const

type VehicleOption = {
  key: string
  label: string
  plateNumber: string | null
  trailerId: number | null
}

export type PreselectedVehicle =
  | { type: 'truck'; plateNumber: string }
  | { type: 'trailer'; trailerId: number }

type Mechanic = {
  employee_id: number
  full_name: string
}

function CreateWorkOrderModal({
  vehicle,
  onClose,
  onCreated,
}: {
  vehicle?: PreselectedVehicle
  onClose: () => void
  onCreated: () => void
}) {
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>([])
  const [selectedVehicleKey, setSelectedVehicleKey] = useState('')
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [mechanicId, setMechanicId] = useState('')
  const [maintenanceType, setMaintenanceType] =
    useState<(typeof MAINTENANCE_TYPES)[number]>('Routine')
  const [description, setDescription] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadOptions()
  }, [])

  async function loadOptions() {
    setLoadingOptions(true)

    const { data: trucks, error: truckError } = await supabase
      .from('truck_profiles')
      .select('plate_number, model')
      .order('plate_number', { ascending: true })

    if (truckError) {
      setError(truckError.message)
      setLoadingOptions(false)
      return
    }

    const { data: trailers, error: trailerError } = await supabase
      .from('trailers')
      .select('trailer_id, plate_number, trailer_type')
      .order('trailer_id', { ascending: true })

    if (trailerError) {
      setError(trailerError.message)
      setLoadingOptions(false)
      return
    }

    const { data: mechanicRows, error: mechanicError } = await supabase
      .from('employees')
      .select('employee_id, full_name')
      .eq('position', 'Mechanic')
      .order('full_name', { ascending: true })

    if (mechanicError) {
      setError(mechanicError.message)
      setLoadingOptions(false)
      return
    }

    const options: VehicleOption[] = [
      ...trucks.map((t) => ({
        key: `truck-${t.plate_number}`,
        label: `Truck: ${t.plate_number}${t.model ? ` (${t.model})` : ''}`,
        plateNumber: t.plate_number,
        trailerId: null,
      })),
      ...trailers.map((t) => ({
        key: `trailer-${t.trailer_id}`,
        label: `Trailer: ${t.plate_number ?? `#${t.trailer_id}`} (${t.trailer_type})`,
        plateNumber: null,
        trailerId: t.trailer_id,
      })),
    ]

    setVehicleOptions(options)
    setMechanics(mechanicRows)
    if (mechanicRows.length > 0) setMechanicId(String(mechanicRows[0].employee_id))

    const preselectedKey = vehicle
      ? vehicle.type === 'truck'
        ? `truck-${vehicle.plateNumber}`
        : `trailer-${vehicle.trailerId}`
      : options[0]?.key

    setSelectedVehicleKey(preselectedKey ?? '')
    setLoadingOptions(false)
  }

  async function handleSubmit() {
    const selectedVehicle = vehicleOptions.find((v) => v.key === selectedVehicleKey)

    if (!selectedVehicle) {
      setError('Select a truck or trailer.')
      return
    }
    if (!mechanicId) {
      setError('Select a mechanic to assign.')
      return
    }

    setSubmitting(true)
    setError(null)

    const identifier = selectedVehicle.plateNumber ?? `TR${selectedVehicle.trailerId}`
    const workOrderNumber = `WO-${identifier}-${Date.now()}`

    const { error: insertError } = await supabase.from('work_orders').insert({
      work_order_number: workOrderNumber,
      plate_number: selectedVehicle.plateNumber,
      trailer_id: selectedVehicle.trailerId,
      assigned_mechanic_id: Number(mechanicId),
      maintenance_type: maintenanceType,
      work_description: description.trim() || null,
      scheduled_start_date: scheduledDate || null,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Create Work Order
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

        {loadingOptions ? (
          <p className="mt-4 text-slate-500">Loading...</p>
        ) : vehicleOptions.length === 0 ? (
          <p className="mt-4 text-slate-500">
            No trucks or trailers found. Add one under Fleet first.
          </p>
        ) : mechanics.length === 0 ? (
          <p className="mt-4 text-slate-500">
            No mechanics found. Add one under Employees first.
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
              Assign mechanic
              <select
                value={mechanicId}
                onChange={(e) => setMechanicId(e.target.value)}
                className={fieldClasses}
              >
                {mechanics.map((m) => (
                  <option key={m.employee_id} value={m.employee_id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClasses}>
              Type of maintenance
              <select
                value={maintenanceType}
                onChange={(e) =>
                  setMaintenanceType(e.target.value as (typeof MAINTENANCE_TYPES)[number])
                }
                className={fieldClasses}
              >
                {MAINTENANCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClasses}>
              Scheduled start date
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className={fieldClasses}
              />
            </label>

            <label className={labelClasses}>
              What's this work order about? (optional)
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
            disabled={submitting || vehicleOptions.length === 0 || mechanics.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Work Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CreateWorkOrderModal
