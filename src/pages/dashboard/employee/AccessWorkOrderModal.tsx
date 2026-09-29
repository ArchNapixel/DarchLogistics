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
  type LoggedPart,
  type InventoryItemOption,
} from '../../../lib/workOrderPartsLog'
import { ALL_STATUSES, StatusBadge, type WorkOrder } from './MechanicTasks'
import { formatDate } from '../../../lib/quoteRequest'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'

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
  const [selectedItem, setSelectedItem] = useState<InventoryItemOption | null>(null)
  const [partQuantity, setPartQuantity] = useState('')
  const [loggingPart, setLoggingPart] = useState(false)

  useEffect(() => {
    loadNotes()
    loadParts()
  }, [order.work_order_id])

  async function loadParts() {
    setPartsLoading(true)

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

  async function handleLogPart() {
    if (!selectedItem) {
      setPartsError('Select an inventory item first.')
      return
    }

    const quantity = Number(partQuantity)
    if (!partQuantity || Number.isNaN(quantity) || quantity <= 0) {
      setPartsError('Enter a quantity greater than 0.')
      return
    }

    setLoggingPart(true)
    setPartsError(null)

    const { error } = await logPartUsed({
      workOrderId: order.work_order_id,
      itemId: selectedItem.item_id,
      itemName: selectedItem.name,
      quantity,
      employeeId,
    })

    setLoggingPart(false)

    if (error) {
      setPartsError(error)
      return
    }

    setSelectedItem(null)
    setPartSearch('')
    setPartQuantity('')
    loadParts()
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
          <h3 className="text-lg font-bold text-slate-900">
            {order.work_order_number} — {order.vehicle_label}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Maintenance type</span>
            <span className="text-slate-900">{order.maintenance_type}</span>
          </div>
          {order.scheduled_start_date && (
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Scheduled</span>
              <span className="text-slate-900">{formatDate(order.scheduled_start_date)}</span>
            </div>
          )}
          {order.work_description && (
            <div>
              <p className="text-slate-500">Description</p>
              <p className="mt-0.5 text-slate-700">{order.work_description}</p>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Status:
            <StatusBadge status={order.work_order_status} />
            <select
              value={order.work_order_status}
              disabled={updating}
              onChange={(e) => onStatusChange(order, e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900"
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

        <div className="mt-6 border-t border-slate-200 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Parts Used</h4>

          {partsError && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {partsError}
            </p>
          )}

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Current stock
              </p>
              <input
                type="text"
                value={partSearch}
                placeholder="Search inventory..."
                onChange={(e) => {
                  setPartSearch(e.target.value)
                  setSelectedItem(null)
                }}
                className={`mt-1 w-full ${fieldClasses}`}
              />
              <div className="mt-2 h-64 overflow-y-auto rounded-lg border border-slate-200">
                {partsLoading ? (
                  <p className="p-3 text-sm text-slate-500">Loading inventory...</p>
                ) : visibleStockItems.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">No matching items.</p>
                ) : (
                  visibleStockItems.map((item) => (
                    <button
                      key={item.item_id}
                      type="button"
                      disabled={item.quantity <= 0}
                      onClick={() => {
                        setSelectedItem(item)
                        setPartSearch(item.name)
                      }}
                      className={`flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                        selectedItem?.item_id === item.item_id ? 'bg-slate-100' : ''
                      }`}
                    >
                      <span className="text-sm text-slate-900">
                        {item.name}{' '}
                        <span className="text-xs text-slate-400">({item.item_type})</span>
                      </span>
                      <span className="text-xs font-medium text-slate-600">
                        {item.quantity > 0 ? `${item.quantity} in stock` : 'Out of stock'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Log a part used
              </p>
              <div className="mt-1 flex items-center gap-2">
                <div className={`flex-1 ${fieldClasses} bg-slate-50 text-slate-600`}>
                  {selectedItem ? selectedItem.name : 'Select from the list...'}
                </div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={partQuantity}
                  onChange={(e) => setPartQuantity(e.target.value)}
                  placeholder="Qty"
                  className={`w-20 ${fieldClasses}`}
                />
              </div>
              <button
                onClick={handleLogPart}
                disabled={loggingPart}
                className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {loggingPart ? 'Logging...' : 'Log Part Used'}
              </button>
              <p className="mt-1 text-xs text-slate-400">
                Logging a part immediately deducts it from inventory.
              </p>

              <div className="mt-4 h-40 overflow-y-auto">
                {partsLoading ? (
                  <p className="text-sm text-slate-500">Loading parts...</p>
                ) : loggedParts.length === 0 ? (
                  <p className="text-sm text-slate-500">No parts logged yet.</p>
                ) : (
                  <div className="grid gap-2">
                    {loggedParts.map((part) => (
                      <div
                        key={part.log_id}
                        className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
                      >
                        <div>
                          <p className="text-sm text-slate-900">
                            {part.item_name_text} × {part.quantity}
                          </p>
                          <p className="text-xs text-slate-400">
                            {part.employee_name} · {new Date(part.used_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <h4 className="text-sm font-semibold text-slate-700">Progress Notes</h4>

          {notesError && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {notesError}
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={2}
              placeholder="What's happening on this job right now?"
              className={`flex-1 ${fieldClasses}`}
            />
          </div>
          <button
            onClick={handleAddNote}
            disabled={submittingNote}
            className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submittingNote ? 'Adding...' : 'Add Note'}
          </button>

          <div className="mt-4 max-h-48 overflow-y-auto">
            {notesLoading ? (
              <p className="text-sm text-slate-500">Loading notes...</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-slate-500">No progress notes yet.</p>
            ) : (
              <div className="grid gap-2">
                {notes.map((note) => (
                  <div key={note.note_id} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-sm text-slate-700">{note.note}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {note.employee_name} · {new Date(note.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default AccessWorkOrderModal
