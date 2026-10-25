// WorkOrderDetailModal: admin's view of one work order, opened by
// clicking a row on the Maintenance page (MaintenanceSection.tsx). Shows
// what the mechanic has done so far -- progress notes (workOrderNotes.ts)
// and parts logged mid-job (workOrderPartsLog.ts) -- and lets admin:
//   - reassign it to another mechanic, or unassign it (back onto the
//     Task Board for any mechanic to accept)
//   - change its status, including Cancelled -- through the same
//     changeWorkOrderStatus() the mechanic uses, so cancelling frees the
//     truck/trailer and reopening puts it back "Under Maintenance".
//   - finish it: "Complete work order..." opens the same completion form
//     the mechanic uses (CompleteWorkOrderModal.tsx -- description, parts,
//     odometer), so nothing is skipped; admin is recorded as who completed
//     it. "Completed" isn't in the status dropdown for the same reason.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { changeWorkOrderStatus } from '../../../lib/workOrderStatusLog'
import { loadWorkOrderNotes, type WorkOrderNote } from '../../../lib/workOrderNotes'
import { loadWorkOrderPartsLog, type LoggedPart } from '../../../lib/workOrderPartsLog'
import { ALL_STATUSES } from '../employee/MechanicTasks'
import CompleteWorkOrderModal from '../employee/CompleteWorkOrderModal'
import StatusBadge from '../../../components/StatusBadge'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { showToast } from '../../../components/Toast'
import { formatDateTime, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

export type WorkOrderDetail = {
  work_order_id: number
  work_order_number: string
  plate_number: string | null
  trailer_id: number | null
  vehicle_label: string
  assigned_mechanic_id: number | null
  maintenance_type: string
  work_description: string | null
  work_order_status: string
  scheduled_start_date: string | null
}

function WorkOrderDetailModal({
  order,
  mechanics,
  onClose,
  onChanged,
}: {
  order: WorkOrderDetail
  mechanics: { employee_id: number; full_name: string }[]
  onClose: () => void
  onChanged: () => void
}) {
  const { employeeId } = useAuth()
  const [status, setStatus] = useState(order.work_order_status)
  const [mechanicId, setMechanicId] = useState(order.assigned_mechanic_id)
  const [notes, setNotes] = useState<WorkOrderNote[]>([])
  const [parts, setParts] = useState<LoggedPart[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [notesResult, partsResult] = await Promise.all([
        loadWorkOrderNotes(order.work_order_id),
        loadWorkOrderPartsLog(order.work_order_id),
      ])
      if (notesResult.error || partsResult.error) {
        setError(notesResult.error ?? partsResult.error)
      }
      setNotes(notesResult.notes)
      setParts(partsResult.parts)
      setLoading(false)
    }
    void load()
  }, [order.work_order_id])

  async function handleStatusChange(newStatus: string) {
    if (
      newStatus === 'Cancelled' &&
      !(await confirmDialog({
        message: `Cancel ${order.work_order_number}? The ${order.vehicle_label.toLowerCase()} will be set back to Available.`,
        confirmLabel: 'Cancel order',
        danger: true,
      }))
    ) {
      return
    }

    setSaving(true)
    setError(null)

    const { error: changeError, statusChanged } = await changeWorkOrderStatus({
      workOrderId: order.work_order_id,
      plateNumber: order.plate_number,
      trailerId: order.trailer_id,
      previousStatus: status,
      newStatus,
      changedByEmployeeId: employeeId ?? null,
    })

    setSaving(false)
    if (changeError) setError(changeError)
    if (statusChanged) {
      setStatus(newStatus)
      if (!changeError) showToast(`Status changed to ${newStatus}.`)
      onChanged()
    }
  }

  async function handleReassign(value: string) {
    const newMechanicId = value ? Number(value) : null

    setSaving(true)
    setError(null)

    // .select() so an RLS silent no-op shows as an error, not success.
    const { data: updated, error: updateError } = await supabase
      .from('work_orders')
      .update({ assigned_mechanic_id: newMechanicId })
      .eq('work_order_id', order.work_order_id)
      .select('work_order_id')
      .maybeSingle()

    setSaving(false)

    if (updateError || !updated) {
      setError(updateError?.message ?? 'The work order could not be updated.')
      return
    }

    setMechanicId(newMechanicId)
    showToast(newMechanicId
        ? `Assigned to ${mechanics.find((m) => m.employee_id === newMechanicId)?.full_name}.`
        : 'Unassigned -- it is back on the Task Board.',)
    onChanged()
  }

  const isClosed = status === 'Completed' || status === 'Cancelled'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">
            {order.work_order_number} — {order.vehicle_label}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4 grid gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Maintenance type</span>
            <span className="text-slate-900">{order.maintenance_type}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Scheduled</span>
            <span className="text-slate-900">
              {order.scheduled_start_date ? formatDate(order.scheduled_start_date) : 'N/A'}
            </span>
          </div>
          {order.work_description && (
            <div>
              <p className="text-slate-500">Description</p>
              <p className="mt-0.5 text-slate-700">{order.work_description}</p>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Mechanic
            <select
              value={mechanicId ?? ''}
              disabled={saving || isClosed}
              onChange={(e) => handleReassign(e.target.value)}
              className="border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11"
            >
              <option value="">Unassigned -- open on the Task Board</option>
              {mechanics.map((m) => (
                <option key={m.employee_id} value={m.employee_id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            <span className="flex items-center gap-2">
              Status <StatusBadge status={status} />
            </span>
            {status === 'Completed' ? (
              <span className="text-xs font-normal text-slate-500">
                Completed by the mechanic. To reopen it, the mechanic sends a correction request.
              </span>
            ) : (
              <select
                value={status}
                disabled={saving}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11"
              >
                {ALL_STATUSES.filter((s) => s !== 'Completed').map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Parts logged during the job</h4>
          {loading ? (
            <p className="mt-2 text-sm text-slate-500">Loading...</p>
          ) : parts.length === 0 ? (
            <EmptyState message="No parts logged yet." className="mt-2" />
          ) : (
            <div className="mt-2 grid gap-2">
              {parts.map((part) => (
                <div key={part.log_id} className="border border-slate-200 p-3">
                  <p className="text-sm text-slate-900">
                    {part.item_name_text} × {part.quantity}
                  </p>
                  <p className="text-[13px] text-ink-muted">
                    {part.employee_name} · {formatDateTime(part.used_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Progress notes</h4>
          {loading ? (
            <p className="mt-2 text-sm text-slate-500">Loading...</p>
          ) : notes.length === 0 ? (
            <EmptyState message="No progress notes yet." className="mt-2" />
          ) : (
            <div className="mt-2 grid gap-2">
              {notes.map((note) => (
                <div key={note.note_id} className="border border-slate-200 p-3">
                  <p className="text-sm text-slate-700">{note.note}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {note.employee_name} · {formatDateTime(note.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
          {!isClosed && (
            <button
              onClick={() => setCompleting(true)}
              disabled={saving}
              className="btn-primary px-4 py-2 text-sm font-medium"
            >
              Complete work order...
            </button>
          )}
        </div>
      </div>

      {completing && (
        <CompleteWorkOrderModal
          workOrderId={order.work_order_id}
          workOrderNumber={order.work_order_number}
          plateNumber={order.plate_number}
          trailerId={order.trailer_id}
          previousStatus={status}
          onClose={() => setCompleting(false)}
          onCompleted={() => {
            setCompleting(false)
            showToast(`${order.work_order_number} completed.`)
            onChanged()
            onClose()
          }}
        />
      )}
    </div>
  )
}

export default WorkOrderDetailModal
