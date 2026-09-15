// ConvertIssueToWorkOrderModal: staff turns a vehicle-related issue
// report into a real work order. issue_reports doesn't link to a
// specific truck/trailer, so staff must pick one here -- everything
// else is pre-filled from the report but fully editable before
// confirming (a review/edit step, not a one-click auto-convert).
//
// work_orders has no severity/priority column (confirmed via the REST
// API before this was built), so the report's severity is shown as
// read-only context only -- it doesn't get merged into the editable
// description text.
//
// Same vehicle-loading and work-order-insert shape as
// CreateWorkOrderModal.tsx, including flipping the vehicle's
// current_status to 'Under Maintenance' on success (kept for
// consistency -- skipping it would leave a work order open on a
// vehicle the Fleet page still shows as "Available").
//
// Steps on confirm (not a DB transaction -- same known limitation as
// every other multi-step flow in this app):
//   1. Insert the work_orders row
//   2. Update the vehicle's current_status to 'Under Maintenance'
//      (best-effort -- if this fails, the work order still exists and
//      is still the mechanic's real task, so this does NOT block step 3)
//   3. Mark the issue_reports row worked_on = true
// If step 1 fails, nothing else happens and the report stays exactly
// as it was. If step 3 fails after step 1 succeeded, the work order
// already exists -- the error says so explicitly so staff don't
// convert the same report twice.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

const MAINTENANCE_TYPES = ['Routine', 'Preventive', 'Predictive', 'Corrective'] as const

const SEVERITY_STYLES: Record<string, string> = {
  Minor: 'bg-yellow-100 text-yellow-700',
  Major: 'bg-red-100 text-red-700',
}

type VehicleOption = {
  key: string
  label: string
  plateNumber: string | null
  trailerId: number | null
}

type Mechanic = {
  employee_id: number
  full_name: string
}

export type ConvertibleIssueReport = {
  issue_report_id: number
  employee_name: string
  description: string
  severity: string
  notes: string | null
  reported_at: string
}

function ConvertIssueToWorkOrderModal({
  report,
  onClose,
  onConverted,
}: {
  report: ConvertibleIssueReport
  onClose: () => void
  onConverted: () => void
}) {
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>([])
  const [selectedVehicleKey, setSelectedVehicleKey] = useState('')
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [mechanicId, setMechanicId] = useState('')
  const [maintenanceType, setMaintenanceType] =
    useState<(typeof MAINTENANCE_TYPES)[number]>('Corrective')
  const [description, setDescription] = useState(report.description)
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

    setVehicleOptions([
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
    ])
    setMechanics(mechanicRows)
    setLoadingOptions(false)
  }

  async function handleSubmit() {
    const selectedVehicle = vehicleOptions.find((v) => v.key === selectedVehicleKey)

    if (!selectedVehicle) {
      setError('Select a truck or trailer this work order is for.')
      return
    }
    if (!description.trim()) {
      setError('Enter a description for the work order.')
      return
    }

    setSubmitting(true)
    setError(null)

    const identifier = selectedVehicle.plateNumber ?? `TR${selectedVehicle.trailerId}`
    const workOrderNumber = `WO-${identifier}-${Date.now()}`

    // 1. Create the work order.
    const { error: insertError } = await supabase.from('work_orders').insert({
      work_order_number: workOrderNumber,
      plate_number: selectedVehicle.plateNumber,
      trailer_id: selectedVehicle.trailerId,
      assigned_mechanic_id: mechanicId ? Number(mechanicId) : null,
      maintenance_type: maintenanceType,
      work_description: description.trim(),
      scheduled_start_date: scheduledDate || null,
    })

    if (insertError) {
      setSubmitting(false)
      setError(`Could not create the work order (${insertError.message}). Nothing was changed.`)
      return
    }

    // 2. Reflect the open work order on the Fleet page -- best-effort,
    // doesn't block marking the report handled since the work order
    // itself (the actual thing the mechanic needs) already exists.
    const { error: statusError } = selectedVehicle.plateNumber
      ? await supabase
          .from('truck_profiles')
          .update({ current_status: 'Under Maintenance' })
          .eq('plate_number', selectedVehicle.plateNumber)
      : await supabase
          .from('trailers')
          .update({ current_status: 'Under Maintenance' })
          .eq('trailer_id', selectedVehicle.trailerId)

    // 3. Mark the issue report handled.
    // .select().maybeSingle() so a blocked UPDATE (no matching RLS
    // policy -- succeeds with 0 rows touched, no error) is caught here
    // instead of silently reporting success.
    const { data: workedOnRow, error: workedOnError } = await supabase
      .from('issue_reports')
      .update({ worked_on: true })
      .eq('issue_report_id', report.issue_report_id)
      .select('issue_report_id')
      .maybeSingle()

    setSubmitting(false)

    if (workedOnError || !workedOnRow) {
      setError(
        `Work order ${workOrderNumber} was created, but this issue report could not be marked handled ` +
          `(${workedOnError?.message ?? '0 rows affected -- likely a missing database permission'}). ` +
          `Do NOT convert this report again -- it already has a work order. This needs manual review.`,
      )
      return
    }

    if (statusError) {
      // Still a success from the report's point of view -- surface the
      // vehicle-status gap but close out normally.
      window.alert(
        `Work order ${workOrderNumber} was created, but the vehicle's status could not be updated to "Under Maintenance" (${statusError.message}). This needs manual review.`,
      )
    }

    onConverted()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Convert to Work Order
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span
            className={`rounded-full px-2.5 py-1 font-semibold ${SEVERITY_STYLES[report.severity] ?? 'bg-gray-100 text-gray-700'}`}
          >
            {report.severity}
          </span>
          <span>
            Reported by {report.employee_name} on{' '}
            {new Date(report.reported_at).toLocaleDateString()}
          </span>
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
        ) : (
          <div className="mt-4 grid gap-4">
            <label className={labelClasses}>
              Truck or trailer
              <select
                value={selectedVehicleKey}
                onChange={(e) => setSelectedVehicleKey(e.target.value)}
                className={fieldClasses}
              >
                <option value="">Select one...</option>
                {vehicleOptions.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClasses}>
              Assign mechanic (optional)
              <select
                value={mechanicId}
                onChange={(e) => setMechanicId(e.target.value)}
                className={fieldClasses}
              >
                <option value="">Unassigned -- open on the Task Board</option>
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
              Scheduled start date (optional)
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className={fieldClasses}
              />
            </label>

            <label className={labelClasses}>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className={fieldClasses}
              />
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || vehicleOptions.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Confirm and Create Work Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConvertIssueToWorkOrderModal
