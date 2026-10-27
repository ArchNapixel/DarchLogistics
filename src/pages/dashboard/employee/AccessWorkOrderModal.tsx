// AccessWorkOrderModal (the canvas's "Open Work Order" board, a panel on
// the right): opened from "Open Work Order" on a mechanic's
// task list -- one place to see the full job (vehicle, maintenance
// type, description, schedule), change its status (same free-choice
// ALL_STATUSES dropdown, minus "Completed" -- that's the separate "Mark
// Complete" button, which hands off to CompleteWorkOrderModal), and add
// progress notes while actually working it (workOrderNotes.ts) --
// separate from the final description/parts breakdown recorded at
// Completion. Status changes and the eventual Completed hand-off are
// still driven by the parent (MechanicTasks.tsx), which owns the
// orders list -- this modal only calls back into it.
import { useEffect, useEffectEvent, useState } from 'react'
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
import { ALL_STATUSES, type WorkOrder } from '../../../lib/mechanicWorkOrders'
import StatusBadge from '../../../components/StatusBadge'
import { formatDateTime, formatDate } from '../../../lib/format'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'

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

  // Load when this opens and whenever order.work_order_id changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    loadNotes()
    loadParts()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [order.work_order_id])

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

  const heading = 'mb-2.5 flex justify-between gap-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink'
  const partButton =
    'grid min-h-[52px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-line bg-white px-3.5 text-left text-sm hover:border-primary hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:hover:border-line'

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wo-title"
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 right-0 flex w-full max-w-[1040px] flex-col border-l-2 border-line-card bg-white"
      >
        <header className="flex min-h-[76px] shrink-0 items-center justify-between gap-4 border-b border-line px-7">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 id="wo-title" className="text-xl leading-7 font-bold text-ink">
              Work Order {order.work_order_number} · {order.vehicle_label}
            </h2>
            <StatusBadge status={order.work_order_status} icon />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close work order"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-7 py-5">
          <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
              <div>
                <dt className="text-[13px] font-medium text-ink-muted">Maintenance type</dt>
                <dd className="m-0 text-[15px] font-medium text-ink">{order.maintenance_type}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-medium text-ink-muted">Scheduled</dt>
                <dd className="m-0 text-[15px] font-medium text-ink">
                  {order.scheduled_start_date ? formatDate(order.scheduled_start_date) : '—'}
                </dd>
              </div>
              <div className="col-span-full">
                <dt className="text-[13px] font-medium text-ink-muted">Problem</dt>
                <dd className="m-0 text-[15px] font-medium whitespace-pre-line text-ink">{order.work_description || '—'}</dd>
              </div>
            </dl>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink">Status</span>
              <select
                value={order.work_order_status}
                disabled={updating}
                onChange={(e) => onStatusChange(order, e.target.value)}
                className={fieldClasses}
              >
                {ALL_STATUSES.filter((status) => status !== 'Completed').map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <span className="text-[13px] text-ink-muted">Each change is logged. Cancelled frees the vehicle.</span>
            </label>
          </div>

          {partsError && <p className="bg-red-50 px-3 py-2 text-sm text-red-700">{partsError}</p>}

          <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-3">
            <section aria-labelledby="wo-inv" className="flex min-h-0 flex-col">
              <h3 id="wo-inv" className={heading}>
                <span>Inventory</span>
                <span className="text-[13px] font-medium text-ink-muted">Select to log 1 used</span>
              </h3>
              <input
                type="search"
                value={partSearch}
                placeholder="Search parts"
                aria-label="Search parts"
                onChange={(e) => setPartSearch(e.target.value)}
                className={`${fieldClasses} mb-2.5`}
              />
              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {partsLoading ? (
                  <p className="text-sm text-ink-muted">Loading...</p>
                ) : visibleStockItems.length === 0 ? (
                  <p className="text-sm text-ink-muted">No matching parts.</p>
                ) : (
                  visibleStockItems.map((item) => {
                    const out = item.quantity <= 0
                    return (
                      <button key={item.item_id} type="button" disabled={out || busy} onClick={() => handleUsePart(item)} className={partButton}>
                        <span>
                          <strong className="text-ink">{item.name}</strong>
                          <span className={`block text-[13px] ${out ? 'text-red-800' : 'text-ink-muted'}`}>
                            {out ? 'Out of stock' : `${item.quantity} in stock`}
                          </span>
                        </span>
                        <span className={`text-[13px] font-semibold whitespace-nowrap ${out ? 'text-ink-muted' : 'text-primary'}`}>
                          {out ? "Can't log" : '+ Log 1'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
              <p className="mt-2.5 text-[13px] text-ink-muted">
                Comes out of stock right away. Stock is checked first, so it never goes below zero.
              </p>
            </section>

            <section aria-labelledby="wo-used" className="flex min-h-0 flex-col">
              <h3 id="wo-used" className={heading}>
                <span>Used</span>
                <span className="text-[13px] font-medium text-ink-muted">Select to return 1</span>
              </h3>
              <div className="flex max-h-[24rem] flex-col gap-2 overflow-y-auto">
                {partsLoading ? (
                  <p className="text-sm text-ink-muted">Loading...</p>
                ) : loggedParts.length === 0 ? (
                  <p className="text-sm text-ink-muted">No parts logged yet.</p>
                ) : (
                  loggedParts.map((part) => (
                    <button key={part.log_id} type="button" disabled={busy} onClick={() => handleReturnPart(part)} className={partButton}>
                      <span>
                        <strong className="text-ink">{part.item_name_text}</strong> × {part.quantity}
                        <span className="block text-[13px] text-ink-muted">{formatDateTime(part.used_at)}</span>
                      </span>
                      <span className="text-[13px] font-semibold whitespace-nowrap text-primary">↩ Return 1</span>
                    </button>
                  ))
                )}
              </div>
              <p className="mt-2.5 text-[13px] text-ink-muted">Returning a part puts it back in stock.</p>
            </section>

            <section aria-labelledby="wo-notes" className="flex min-h-0 flex-col">
              <h3 id="wo-notes" className={heading}>
                <span>Notes</span>
                <span className="text-[13px] font-medium text-ink-muted">Admin can read these</span>
              </h3>
              {notesError && <p className="mb-2 bg-red-50 px-3 py-2 text-sm text-red-700">{notesError}</p>}
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Type a progress note"
                aria-label="Progress note"
                className={`${fieldClasses} resize-none py-2.5`}
              />
              <button type="button" onClick={handleAddNote} disabled={submittingNote} className="btn-secondary mt-2 mb-3 self-end px-4 text-sm font-medium">
                {submittingNote ? 'Adding...' : 'Add Note'}
              </button>
              {notesLoading ? (
                <p className="text-sm text-ink-muted">Loading...</p>
              ) : (
                <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                  {notes.map((note) => (
                    <div key={note.note_id} className="border-l-[3px] border-line bg-slate-50 px-3 py-2.5 text-sm text-ink-secondary">
                      {note.note}
                      <span className="block text-[13px] text-ink-muted">
                        {note.employee_name} · {formatDateTime(note.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="flex min-h-[84px] shrink-0 items-center justify-end gap-3 border-t border-line px-7">
          <button type="button" onClick={onClose} className="btn-secondary px-5 text-sm font-medium">
            Close
          </button>
          <button type="button" onClick={onMarkComplete} disabled={updating} className="btn-primary flex items-center gap-2 px-6 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
            Mark Complete
          </button>
        </footer>
      </div>
    </div>
  )
}

export default AccessWorkOrderModal
