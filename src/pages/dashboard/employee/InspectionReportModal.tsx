import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type Severity = 'Minor' | 'Major'

type VehicleOption = {
  key: string
  label: string
  plateNumber: string | null
  trailerId: number | null
}

function InspectionReportModal({ onClose }: { onClose: () => void }) {
  const { employeeId } = useAuth()
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [vehicleKey, setVehicleKey] = useState('')
  const [findings, setFindings] = useState('')
  const [severity, setSeverity] = useState<Severity>('Minor')
  const [notes, setNotes] = useState('')
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    async function loadVehicles() {
      const [trucksResult, trailersResult] = await Promise.all([
        supabase.from('truck_profiles').select('plate_number, model').order('plate_number'),
        supabase.from('trailers').select('trailer_id, plate_number, trailer_type').order('trailer_id'),
      ])

      if (trucksResult.error) {
        setError(trucksResult.error.message)
        setLoadingVehicles(false)
        return
      }
      if (trailersResult.error) {
        setError(trailersResult.error.message)
        setLoadingVehicles(false)
        return
      }

      const options = [
        ...trucksResult.data.map((truck) => ({
          key: `truck-${truck.plate_number}`,
          label: `Truck: ${truck.plate_number}${truck.model ? ` (${truck.model})` : ''}`,
          plateNumber: truck.plate_number,
          trailerId: null,
        })),
        ...trailersResult.data.map((trailer) => ({
          key: `trailer-${trailer.trailer_id}`,
          label: `Trailer: ${trailer.plate_number ?? `#${trailer.trailer_id}`} (${trailer.trailer_type})`,
          plateNumber: null,
          trailerId: trailer.trailer_id,
        })),
      ]

      setVehicles(options)
      setVehicleKey(options[0]?.key ?? '')
      setLoadingVehicles(false)
    }

    void loadVehicles()
  }, [])

  async function handleSubmit() {
    const vehicle = vehicles.find((option) => option.key === vehicleKey)

    if (!employeeId) {
      setError('Your account is not linked to an employee record.')
      return
    }
    if (!vehicle) {
      setError('Select the vehicle that was inspected.')
      return
    }
    if (!findings.trim()) {
      setError('Describe the inspection findings.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('issue_reports').insert({
      employee_id: employeeId,
      // Stored as real columns too, so "Convert to Work Order" can
      // pre-select the vehicle (ConvertIssueToWorkOrderModal.tsx).
      plate_number: vehicle.plateNumber,
      trailer_id: vehicle.trailerId,
      description: `Inspection report for ${vehicle.label}: ${findings.trim()}`,
      severity,
      notes: notes.trim() || null,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        {done ? (
          <>
            <h3 className="text-lg font-bold text-slate-900">Inspection report submitted</h3>
            <p className="mt-3 text-sm text-slate-600">Staff can now review the vehicle findings.</p>
            <div className="mt-6 flex justify-end">
              <button onClick={onClose} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Submit Inspection Report</h3>
              <button onClick={onClose} disabled={submitting} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>

            {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

            {loadingVehicles ? (
              <p className="mt-4 text-slate-500">Loading vehicles...</p>
            ) : vehicles.length === 0 ? (
              <p className="mt-4 text-slate-500">No trucks or trailers are available to inspect.</p>
            ) : (
              <div className="mt-4 grid gap-4">
                <label className={labelClasses}>
                  Vehicle inspected
                  <select value={vehicleKey} onChange={(event) => setVehicleKey(event.target.value)} className={fieldClasses}>
                    {vehicles.map((vehicle) => <option key={vehicle.key} value={vehicle.key}>{vehicle.label}</option>)}
                  </select>
                </label>
                <label className={labelClasses}>
                  Findings
                  <textarea value={findings} onChange={(event) => setFindings(event.target.value)} rows={3} className={fieldClasses} placeholder="Describe what you found" />
                </label>
                <label className={labelClasses}>
                  Severity
                  <select value={severity} onChange={(event) => setSeverity(event.target.value as Severity)} className={fieldClasses}>
                    <option value="Minor">Minor</option>
                    <option value="Major">Major</option>
                  </select>
                </label>
                <label className={labelClasses}>
                  Notes (optional)
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={fieldClasses} />
                </label>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={onClose} disabled={submitting} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={handleSubmit} disabled={submitting || loadingVehicles || vehicles.length === 0} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default InspectionReportModal
