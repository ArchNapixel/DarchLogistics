// AccessWorkOrderModal: opened from "Access Work Order" on a mechanic's
// task list -- one place to see the full job (vehicle, maintenance
// type, description, schedule), change its status (same free-choice
// ALL_STATUSES dropdown, minus "Completed" -- that's the separate "Mark
// Complete" button, which hands off to CompleteWorkOrderModal), and add
// progress notes while actually working it (workOrderNotes.ts) --
// separate from the final description/parts breakdown recorded at
// Completion. Status changes and the eventual Completed hand-off are
// still driven by the parent (MechanicTasks.tsx), which owns the
// orders list -- this modal only calls back into it.
import { useEffect, useState } from 'react'
import {
  loadWorkOrderNotes,
  addWorkOrderNote,
  type WorkOrderNote,
} from '../../../lib/workOrderNotes'
import {
  loadWorkOrderPartsLog,
  loadInventoryItems,
  logPartUsed,
  returnPart,
  type LoggedPart,
  type InventoryItemOption,
} from '../../../lib/workOrderPartsLog'
import { ALL_STATUSES, StatusBadge, type WorkOrder } from './MechanicTasks'
import { formatDate } from '../../../lib/quoteRequest'

const fieldClasses =
  'rounded-lg border border-slate-400 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'

function AccessWorkOrderModal({
  order,
  employeeId,
  updating,
  onStatusChange,
  onMarkComplete,
  onClose,
}: {
  order: WorkOrder
  employeeId: number
  updating: boolean
  onStatusChange: (order: WorkOrder, newStatus: string) => void
  onMarkComplete: () => void
  onClose: () => void
}) {
  const [notes, setNotes] = useState<WorkOrderNote[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [newNote, setNewNote] = useState('')
  const [submittingNote, setSubmittingNote] = useState(false)

  const [loggedParts, setLoggedParts] = useState<LoggedPart[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([])
  const [partsLoading, setPartsLoading] = useState(true)
  const [partsError, setPartsError] = useState<string | null>(null)
  const [partSearch, setPartSearch] = useState('')
  // true while a use/return is saving -- blocks double clicks
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadNotes()
    loadParts()
  }, [order.work_order_id])

  // quiet = refresh after a click without flashing "Loading..."
  async function loadParts(quiet = false) {
    if (!quiet) setPartsLoading(true)

    const [logResult, inventoryResult] = await Promise.all([
      loadWorkOrderPartsLog(order.work_order_id),
      loadInventoryItems(),
    ])

    if (logResult.error) {
      setPartsError(logResult.error)
      setPartsLoading(false)
      return
    }
    if (inventoryResult.error) {
      setPartsError(inventoryResult.error)
      setPartsLoading(false)
      return
    }

    setLoggedParts(logResult.parts)
    setInventoryItems(inventoryResult.items)
    setPartsError(null)
    setPartsLoading(false)
  }

  // Clicking a stock item = use 1 piece of it
  async function handleUsePart(item: InventoryItemOption) {
    setBusy(true)
    setPartsError(null)

    const { error } = await logPartUsed({
      workOrderId: order.work_order_id,
      itemId: item.item_id,
      itemName: item.name,
      quantity: 1,
      employeeId,
    })

    if (error) setPartsError(error)
    await loadParts(true)
    setBusy(false)
  }

  // Clicking a used part = give it back to inventory
  async function handleReturnPart(part: LoggedPart) {
    setBusy(true)
    setPartsError(null)

    const { error } = await returnPart(part)

    if (error) setPartsError(error)
    await loadParts(true)
    setBusy(false)
  }

  async function loadNotes() {
    setNotesLoading(true)
    const { notes: loaded, error } = await loadWorkOrderNotes(order.work_order_id)

    if (error) {
      setNotesError(error)
      setNotesLoading(false)
      return
    }

    setNotes(loaded)
    setNotesError(null)
    setNotesLoading(false)
  }

  async function handleAddNote() {
    if (!newNote.trim()) {
      setNotesError('Enter a note before adding it.')
      return
    }

    setSubmittingNote(true)
    setNotesError(null)

    const { error } = await addWorkOrderNote({
      workOrderId: order.work_order_id,
      employeeId,
      note: newNote.trim(),
    })

    setSubmittingNote(false)

    if (error) {
      setNotesError(error)
      return
    }

    setNewNote('')
    loadNotes()
  }

  const visibleStockItems = partSearch.trim()
    ? inventoryItems.filter((item) =>
        item.name.toLowerCase().includes(partSearch.trim().toLowerCase()),
      )
    : inventoryItems

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-900">{order.vehicle_label}</h3>
            <p className="mt-0.5 text-sm font-medium text-slate-600">{order.work_order_number}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mt-3 text-sm">
          <p className="font-medium text-slate-700">
            {order.maintenance_type}
            {order.scheduled_start_date &&
              ` · ${formatDate(order.scheduled_start_date)}`}
          </p>
          {order.work_description && (
            <p className="mt-1 text-base text-slate-900">{order.work_description}</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <StatusBadge status={order.work_order_status} />
            <select
              value={order.work_order_status}
              disabled={updating}
              onChange={(e) => onStatusChange(order, e.target.value)}
              className="rounded-lg border border-slate-400 px-2 py-1.5 text-xs text-slate-900"
            >
              {ALL_STATUSES.filter((status) => status !== 'Completed').map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={onMarkComplete}
            disabled={updating}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Mark Complete
          </button>
        </div>

        <div className="mt-4 border-t border-slate-300 pt-4">
          {partsError && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {partsError}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-700">Inventory</h4>
              <input
                type="text"
                value={partSearch}
                placeholder="Search"
                onChange={(e) => setPartSearch(e.target.value)}
                className={`mt-2 w-full ${fieldClasses}`}
              />
              <div className="mt-2 h-52 overflow-y-auto rounded-lg border border-slate-400">
                {partsLoading ? (
                  <p className="p-3 text-sm text-slate-500">Loading...</p>
                ) : visibleStockItems.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">No items</p>
                ) : (
                  visibleStockItems.map((item) => (
                    <button
                      key={item.item_id}
                      type="button"
                      disabled={item.quantity <= 0 || busy}
                      onClick={() => handleUsePart(item)}
                      className="flex w-full items-center justify-between border-b border-slate-300 px-3 py-2 text-left last:border-0 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <span className="text-sm text-slate-900">{item.name}</span>
                      <span className="text-xs font-medium text-slate-600">
                        {item.quantity > 0 ? item.quantity : 'Out'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-slate-700">Used</h4>
              <div className="mt-2 h-[calc(2.5rem+0.5rem+13rem)] overflow-y-auto rounded-lg border border-slate-400">
                {partsLoading ? (
                  <p className="p-3 text-sm text-slate-500">Loading...</p>
                ) : loggedParts.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">None</p>
                ) : (
                  loggedParts.map((part) => (
                    <button
                      key={part.log_id}
                      type="button"
                      disabled={busy}
                      onClick={() => handleReturnPart(part)}
                      className="flex w-full items-center justify-between border-b border-slate-300 px-3 py-2 text-left last:border-0 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <span className="text-sm text-slate-900">
                        {part.item_name_text} × {part.quantity}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(part.used_at).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-300 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Notes</h4>

          {notesError && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {notesError}
            </p>
          )}

          <div className="mt-2 flex items-start gap-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={2}
              className={`flex-1 ${fieldClasses}`}
            />
            <button
              onClick={handleAddNote}
              disabled={submittingNote}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {submittingNote ? 'Adding...' : 'Add'}
            </button>
          </div>

          {notesLoading ? (
            <p className="mt-3 text-sm text-slate-500">Loading...</p>
          ) : (
            notes.length > 0 && (
              <div className="mt-3 grid max-h-40 gap-2 overflow-y-auto">
                {notes.map((note) => (
                  <div key={note.note_id} className="rounded-lg border border-slate-400 px-3 py-2">
                    <p className="text-sm text-slate-700">{note.note}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {note.employee_name} · {new Date(note.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

export default AccessWorkOrderModal
