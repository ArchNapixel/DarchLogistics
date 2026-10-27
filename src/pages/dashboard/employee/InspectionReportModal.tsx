// InspectionReportModal: a Driver's, Helper's or Mechanic's issue report into
// issue_reports (the canvas's "Report Issue" board) -- either about a
// specific truck/trailer (saved as real plate_number/trailer_id columns so
// staff's "Convert to Work Order" can pre-select it) or a general issue with
// no vehicle. This replaced the Driver's separate ReportIssueModal, which
// saved no vehicle at all.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const labelClasses = 'flex justify-between gap-2 text-sm font-semibold text-ink'

type Severity = 'Minor' | 'Major'

type VehicleOption = {
  key: string
  label: string
  plateNumber: string | null
  trailerId: number | null
}

function Required() {
  return <span className="text-xs text-amber-800">Required</span>
}

// One of two big radio buttons ("A vehicle" / "A general issue", "Minor" / "Major").
function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-center gap-2.5 px-3.5 text-sm font-semibold text-ink ${
        checked ? 'border-2 border-primary bg-primary-soft' : 'border border-line-control'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="h-[18px] w-[18px] accent-primary" />
      {children}
    </label>
  )
}

function InspectionReportModal({ onClose }: { onClose: () => void }) {
  const { employeeId, role } = useAuth()
  const [trucks, setTrucks] = useState<VehicleOption[]>([])
  const [trailers, setTrailers] = useState<VehicleOption[]>([])
  const [aboutVehicle, setAboutVehicle] = useState(true)
  const [vehicleKey, setVehicleKey] = useState('')
  const [findings, setFindings] = useState('')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [notes, setNotes] = useState('')
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadVehicles() {
      const [trucksResult, trailersResult] = await Promise.all([
        supabase.from('truck_profiles').select('plate_number, model').order('plate_number'),
        supabase.from('trailers').select('trailer_id, plate_number, trailer_type').order('trailer_id'),
      ])

      if (trucksResult.error || trailersResult.error) {
        setError((trucksResult.error ?? trailersResult.error)!.message)
        setLoadingVehicles(false)
        return
      }

      setTrucks(
        trucksResult.data.map((truck) => ({
          key: `truck-${truck.plate_number}`,
          label: `${truck.plate_number}${truck.model ? ` (${truck.model})` : ''}`,
          plateNumber: truck.plate_number,
          trailerId: null,
        })),
      )
      setTrailers(
        trailersResult.data.map((trailer) => ({
          key: `trailer-${trailer.trailer_id}`,
          label: `${trailer.plate_number ?? `#${trailer.trailer_id}`} (${trailer.trailer_type})`,
          plateNumber: null,
          trailerId: trailer.trailer_id,
        })),
      )
      setLoadingVehicles(false)
    }

    void loadVehicles()
  }, [])

  async function handleSubmit() {
    const vehicle = [...trucks, ...trailers].find((option) => option.key === vehicleKey)

    if (!employeeId) {
      setError('Your account is not linked to an employee record.')
      return
    }
    if (aboutVehicle && !vehicle) {
      setError('Choose the truck or trailer this is about.')
      return
    }
    if (!findings.trim()) {
      setError('Describe what you found.')
      return
    }
    if (!severity) {
      setError('Pick how serious it is.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('issue_reports').insert({
      employee_id: employeeId,
      // Stored as real columns too, so "Convert to Work Order" can
      // pre-select the vehicle (ConvertIssueToWorkOrderModal.tsx).
      plate_number: aboutVehicle ? vehicle!.plateNumber : null,
      trailer_id: aboutVehicle ? vehicle!.trailerId : null,
      description: aboutVehicle
        ? `Inspection report for ${vehicle!.plateNumber ? 'Truck' : 'Trailer'}: ${vehicle!.label}: ${findings.trim()}`
        : findings.trim(),
      severity,
      notes: notes.trim() || null,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    showToast('Report sent. Staff can now review it.')
    onClose()
  }

  const title = role === 'Mechanic' ? 'Submit Inspection Report' : 'Report Issue'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="report-title" className="card w-full max-w-[600px]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="report-title" className="text-xl leading-7 font-bold text-ink">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">
              {role === 'Mechanic' ? 'Something you found during an inspection.' : 'About a vehicle or a general issue you noticed.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
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

          <fieldset className="flex flex-col gap-1.5">
            <legend className={`${labelClasses} w-full pb-1.5`}>About</legend>
            <div className="grid grid-cols-2 gap-2">
              <Choice name="report-about" checked={aboutVehicle} onChange={() => setAboutVehicle(true)}>
                A vehicle
              </Choice>
              <Choice name="report-about" checked={!aboutVehicle} onChange={() => setAboutVehicle(false)}>
                A general issue
              </Choice>
            </div>
          </fieldset>

          {aboutVehicle && (
            <label className="flex flex-col gap-1.5">
              <span className={labelClasses}>
                <span>Vehicle</span>
                <Required />
              </span>
              <select value={vehicleKey} onChange={(e) => setVehicleKey(e.target.value)} disabled={loadingVehicles} className={fieldClasses}>
                <option value="">{loadingVehicles ? 'Loading vehicles…' : 'Choose a truck or trailer'}</option>
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
          )}

          <label className="flex flex-col gap-1.5">
            <span className={labelClasses}>
              <span>What did you find?</span>
              <Required />
            </span>
            <textarea
              value={findings}
              onChange={(e) => setFindings(e.target.value)}
              rows={3}
              maxLength={1000}
              className={`${fieldClasses} resize-none py-2.5`}
            />
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className={`${labelClasses} w-full pb-1.5`}>
              <span>Severity</span>
              <Required />
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <Choice name="report-severity" checked={severity === 'Minor'} onChange={() => setSeverity('Minor')}>
                Minor
              </Choice>
              <Choice name="report-severity" checked={severity === 'Major'} onChange={() => setSeverity('Major')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l10 18H2z M12 10v5 M12 18h.01" />
                </svg>
                Major
              </Choice>
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className={labelClasses}>
              <span>
                Notes <span className="font-normal text-ink-muted">(optional)</span>
              </span>
            </span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className={fieldClasses} />
          </label>

          <p className="border border-line bg-slate-50 px-3.5 py-3 text-[13px] leading-[18px] text-ink-secondary">
            Staff see it under Reports → Issue Reports and can turn it into a work order.
          </p>
        </form>

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="btn-primary px-6 text-sm">
            {submitting ? 'Sending...' : 'Submit Report'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default InspectionReportModal
