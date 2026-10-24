// MarkAbsentModal: Dispatch Board -> "Mark absent today". Pick the driver or
// helper who didn't show up and say why. They count as on leave for today
// (unpaid), so their trips today show up in the board's At-risk notice with a
// one-click replacement. See lib/markAbsent.ts.
import { useState } from 'react'
import { markAbsentToday } from '../../../lib/markAbsent'

type Person = { employee_id: number; full_name: string; role: 'Driver' | 'Helper' }

function MarkAbsentModal({
  people,
  onClose,
  onDone,
}: {
  people: Person[]
  onClose: () => void
  onDone: (name: string) => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!employeeId) return setError('Pick who is absent.')
    if (!reason.trim()) return setError('Say why (for example: sick, no call).')
    setSaving(true)
    setError(null)
    const saveError = await markAbsentToday(Number(employeeId), reason)
    setSaving(false)
    if (saveError) return setError(saveError)
    onDone(people.find((p) => p.employee_id === Number(employeeId))?.full_name ?? 'They')
  }

  const fieldClass = 'border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md bg-white p-6 shadow-lg">
        <h3 className="text-lg font-bold text-slate-900">Mark absent today</h3>
        <p className="mt-1 text-sm text-slate-500">
          They're treated as on (unpaid) leave for today, and their trips today appear under At-risk trips so you can replace them.
        </p>

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
          Who
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={fieldClass}>
            <option value="">Choose a driver or helper…</option>
            {people.map((p) => (
              <option key={p.employee_id} value={p.employee_id}>
                {p.full_name} ({p.role})
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
          Reason
          <input
            type="text"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sick, did not report in"
            className={fieldClass}
          />
        </label>

        {error && <p className="mt-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="btn-primary px-4 py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Mark absent'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MarkAbsentModal
