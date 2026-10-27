// WorkOrderCompletionsSection: admin read-only view of finished work
// (src/lib/workOrderCompletions.ts) -- description, parts
// used, and any odometer/next-service info recorded at completion.
import { useEffect, useEffectEvent, useState } from 'react'
import { LoadMore, LOG_PAGE_SIZE } from '../../../components/LoadMore'
import {
  loadWorkOrderCompletions,
  type WorkOrderCompletion,
} from '../../../lib/workOrderCompletions'
import { formatDateTime, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

function WorkOrderCompletionsSection() {
  const [completions, setCompletions] = useState<WorkOrderCompletion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [limit, setLimit] = useState(LOG_PAGE_SIZE)

  // No setLoading(true) here: "Show more" keeps the table on screen.
  async function load(rowLimit: number) {
    const { completions: loaded, error: loadError } = await loadWorkOrderCompletions(rowLimit)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setCompletions(loaded)
    setError(null)
    setLoading(false)
  }

  // Load when this opens and whenever limit changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    load(limit)
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [limit])

  if (loading) {
    return <p className="text-slate-500">Loading completed work orders...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (completions.length === 0) {
    return <EmptyState message="No completed work orders yet." />
  }

  return (
    <div>
      <div className="grid gap-3">
        {completions.map((completion) => (
          <div
            key={completion.completion_id}
            className="border-2 border-line-card bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">
                {completion.work_order_number} — {completion.vehicle_label}
              </p>
              <span className="text-xs text-slate-500">
                {formatDateTime(completion.completed_at)}
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
                <p>Next service: {formatDate(completion.next_service_date)}</p>
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
      <LoadMore shown={completions.length} limit={limit} onMore={() => setLimit((n) => n + LOG_PAGE_SIZE)} />
    </div>
  )
}

export default WorkOrderCompletionsSection
