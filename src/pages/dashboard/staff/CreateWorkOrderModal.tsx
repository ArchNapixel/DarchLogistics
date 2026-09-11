// CreateWorkOrderModal: staff creates a work order for a specific truck
// and assigns a mechanic. work_order_number is generated automatically
// (plate number + timestamp) so staff doesn't have to invent a unique
// one. work_order_status defaults to 'Created' at the database level.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type Mechanic = {
  employee_id: number
  full_name: string
}

function CreateWorkOrderModal({
  plateNumber,
  onClose,
  onCreated,
}: {
  plateNumber: string
  onClose: () => void
  onCreated: () => void
}) {
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [mechanicId, setMechanicId] = useState('')
  const [description, setDescription] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [loadingMechanics, setLoadingMechanics] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadMechanics()
  }, [])

  async function loadMechanics() {
    setLoadingMechanics(true)

    const { data, error: mechanicError } = await supabase
      .from('employees')
      .select('employee_id, full_name')
      .eq('position', 'Mechanic')
      .order('full_name', { ascending: true })

    if (mechanicError) {
      setError(mechanicError.message)
      setLoadingMechanics(false)
      return
    }

    setMechanics(data)
    if (data.length > 0) setMechanicId(String(data[0].employee_id))
    setLoadingMechanics(false)
  }

  async function handleSubmit() {
    if (!mechanicId) {
      setError('Select a mechanic to assign.')
      return
    }

    setSubmitting(true)
    setError(null)

    const workOrderNumber = `WO-${plateNumber}-${Date.now()}`

    const { error: insertError } = await supabase.from('work_orders').insert({
      work_order_number: workOrderNumber,
      plate_number: plateNumber,
      assigned_mechanic_id: Number(mechanicId),
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
            Create Work Order — {plateNumber}
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

        {loadingMechanics ? (
          <p className="mt-4 text-slate-500">Loading mechanics...</p>
        ) : mechanics.length === 0 ? (
          <p className="mt-4 text-slate-500">
            No mechanics found. Add one under Employees first.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
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
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={fieldClasses}
              />
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
            disabled={submitting || mechanics.length === 0}
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
