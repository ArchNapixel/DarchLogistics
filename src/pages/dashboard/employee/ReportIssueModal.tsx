// ReportIssueModal: lets a driver report an issue that isn't tied to any
// specific trip (itinerary_id is left out of the insert, so it stays null).
// Same modal shell/style as the other modals in the app (e.g.
// SetUpClientAccountModal) -- form first, then a "done" confirmation state.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type Severity = 'Minor' | 'Major'

function ReportIssueModal({ onClose }: { onClose: () => void }) {
  const { employeeId } = useAuth()
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('Minor')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit() {
    if (!description.trim()) {
      setError('Enter a description of the issue.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('issue_reports').insert({
      employee_id: employeeId,
      description,
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
            <h3 className="text-lg font-bold text-slate-900">
              Issue reported
            </h3>
            <p className="mt-3 text-sm text-slate-600">
              Thanks -- your report has been sent to staff.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-slate-900">Report Issue</h3>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-4 grid gap-4">
              <label className={labelClasses}>
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Severity
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as Severity)}
                  className={fieldClasses}
                >
                  <option value="Minor">Minor</option>
                  <option value="Major">Major</option>
                </select>
              </label>

              <label className={labelClasses}>
                Notes (optional)
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className={fieldClasses}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default ReportIssueModal
