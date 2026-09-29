// WorkOrderCompletionsSection: admin read-only view of finished work
// (src/lib/workOrderCompletions.ts) -- description, parts
// used, and any odometer/next-service info recorded at completion.
import { useEffect, useState } from 'react'
import {
  loadWorkOrderCompletions,
  type WorkOrderCompletion,
} from '../../../lib/workOrderCompletions'

function WorkOrderCompletionsSection() {
  const [completions, setCompletions] = useState<WorkOrderCompletion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { completions: loaded, error: loadError } = await loadWorkOrderCompletions()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setCompletions(loaded)
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading completed work orders...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (completions.length === 0) {
    return <p className="text-slate-500">No completed work orders yet.</p>
  }

  return (
    <div className="grid gap-3">
      {completions.map((completion) => (
        <div
          key={completion.completion_id}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-slate-900">
              {completion.work_order_number} — {completion.vehicle_label}
            </p>
            <span className="text-xs text-slate-500">
              {new Date(completion.completed_at).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Completed by {completion.employee_name}
          </p>
          <p className="mt-2 text-sm text-slate-700">{completion.description}</p>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600 sm:grid-cols-3">
            {completion.odometer_reading !== null && (
              <p>Odometer: {completion.odometer_reading.toLocaleString()}</p>
            )}
            {completion.next_service_date && (
              <p>Next service: {completion.next_service_date}</p>
            )}
          </div>

          {completion.parts_used.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Parts used
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 text-sm text-slate-600">
                {completion.parts_used.map((part, index) => (
                  <li key={index}>
                    {part.item_name_text} × {part.quantity}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {completion.notes && (
            <p className="mt-2 text-sm text-slate-500">Notes: {completion.notes}</p>
          )}
        </div>
      ))}
    </div>
  )
}

export default WorkOrderCompletionsSection
