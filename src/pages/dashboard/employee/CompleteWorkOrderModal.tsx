// CompleteWorkOrderModal (the canvas's "Mark Complete" board): shown when
// a mechanic clicks "Mark Complete" in MechanicTasks.tsx / the Open Work
// Order panel (or Admin on WorkOrderDetailModal). Marking a work order
// complete isn't allowed to happen silently -- the mechanic must first
// describe what was done and list any parts used, so every part used is
// traceable back to a real inventory_items row (no free-text parts).
//
// Parts already logged mid-job via AccessWorkOrderModal's "Log 1"
// (workOrderPartsLog.ts) show up here read-only -- they're already out of
// stock and get copied onto the completion without being taken out again.
// On a reopened job only the parts not yet on a completion are shown.
//
// Saving is ONE call to the complete_work_order database function, so it
// either all saves or nothing does: the completion record, the logged
// parts, the parts entered here (the same item on several rows is added
// together, oldest batch used first, each charged its batch's real
// price), any brand-new items, status Completed, and the truck's odometer
// / service dates (the reading must be higher than the current one).
// A brand-new item gets no price and no extra stock -- it's recorded as
// received and used in the same amount and flagged "Needs price" for
// Admin.
//
// After that the app logs the status change (best effort) and frees the
// vehicle (releaseVehicleFromShop). If freeing fails, clicking Mark
// Complete again only retries that step -- `savedCompletionId` remembers
// the completion is already saved.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { logWorkOrderStatusChange } from '../../../lib/workOrderStatusLog'
import { releaseVehicleFromShop } from '../../../lib/fleetStatus'
import {
  loadInventoryItems,
  loadWorkOrderPartsLog,
  type InventoryItemOption,
  type LoggedPart,
} from '../../../lib/workOrderPartsLog'
import { ITEM_UNITS, WHOLE_UNITS, filterQuantity } from '../../../lib/inventoryItemTypes'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary disabled:bg-slate-50 disabled:text-ink-muted'
const labelClasses = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'
const SECTION_TITLE = 'mb-2 text-sm font-semibold text-ink'

type PartRow = {
  key: number
  itemId: number | null
  search: string
  dropdownOpen: boolean
  addingNew: boolean
  newItemConfirmed: boolean
  newItemType: string
  newItemUnit: string
  quantityUsed: string
  error: string | null
}

// A new item used up on a job is a consumable -- never a tool or
// equipment (the DB refuses those). Defaults to Parts.
const NEW_ITEM_TYPES = ['Parts', 'Supplies', 'Other'] as const

let nextRowKey = 1
function makeEmptyRow(): PartRow {
  return {
    key: nextRowKey++,
    itemId: null,
    search: '',
    dropdownOpen: false,
    addingNew: false,
    newItemConfirmed: false,
    newItemType: 'Parts',
    newItemUnit: 'pcs',
    quantityUsed: '',
    error: null,
  }
}

function CompleteWorkOrderModal({
  workOrderId,
  workOrderNumber,
  plateNumber,
  trailerId,
  previousStatus,
  subtitle,
  onClose,
  onCompleted,
}: {
  workOrderId: number
  workOrderNumber: string
  plateNumber: string | null
  trailerId: number | null
  previousStatus: string
  // "Truck ABC 123 · Routine", shown under the title.
  subtitle?: string
  onClose: () => void
  onCompleted: () => void
}) {
  const { employeeId } = useAuth()

  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([])
  const [loadingInventory, setLoadingInventory] = useState(true)
  const [alreadyLoggedParts, setAlreadyLoggedParts] = useState<LoggedPart[]>([])

  const [description, setDescription] = useState('')
  const [parts, setParts] = useState<PartRow[]>([])
  const [odometerReading, setOdometerReading] = useState('')
  const [nextServiceDate, setNextServiceDate] = useState('')
  const [notes, setNotes] = useState('')

  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  // Set once complete_work_order succeeded (see the top of this file).
  const savedCompletionId = useRef<number | null>(null)

  async function loadAlreadyLoggedParts() {
    const { parts: logged, error } = await loadWorkOrderPartsLog(workOrderId)
    if (error) return
    // Parts not on a completion yet (on a reopened job, older ones are).
    setAlreadyLoggedParts(logged.filter((p) => p.completion_id === null))
  }

  async function loadInventory() {
    setLoadingInventory(true)
    const { items, error } = await loadInventoryItems()
    if (!error) {
      setInventoryItems(items)
    }
    setLoadingInventory(false)
  }

  function unitOf(row: PartRow): string {
    if (row.addingNew) return row.newItemUnit
    return inventoryItems.find((i) => i.item_id === row.itemId)?.unit ?? 'pcs'
  }

  // Load when this opens and whenever workOrderId changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    loadInventory()
    loadAlreadyLoggedParts()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [workOrderId])

  function updateRow(key: number, patch: Partial<PartRow>) {
    setParts((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    )
  }

  function removeRow(key: number) {
    setParts((prev) => prev.filter((row) => row.key !== key))
  }

  function selectItem(key: number, item: InventoryItemOption) {
    updateRow(key, {
      itemId: item.item_id,
      search: item.name,
      dropdownOpen: false,
      addingNew: false,
      error: null,
    })
  }

  function startAddingNew(key: number, typedName: string) {
    updateRow(key, {
      addingNew: true,
      newItemConfirmed: false,
      newItemType: 'Parts',
      newItemUnit: 'pcs',
      quantityUsed: '',
      dropdownOpen: false,
      itemId: null,
      search: typedName,
      error: null,
    })
  }

  function confirmNewItem(row: PartRow) {
    if (!row.search.trim()) {
      updateRow(row.key, { error: 'Enter a name for the new item.' })
      return
    }
    updateRow(row.key, { newItemConfirmed: true, error: null })
  }

  function matchesFor(row: PartRow) {
    const term = row.search.trim().toLowerCase()
    if (!term) return []
    return inventoryItems
      .filter((item) => item.name.toLowerCase().includes(term))
      .slice(0, 6)
  }

  // Form checks before saving. The DB checks all of this again; these just
  // give the mechanic the error next to the right row.
  function validateRows(): boolean {
    // Total asked per existing item across all rows (the same item can be
    // on two rows -- the DB adds them together too).
    const totalByItem = new Map<number, number>()
    for (const row of parts) {
      if (!row.addingNew && row.itemId) {
        totalByItem.set(row.itemId, (totalByItem.get(row.itemId) ?? 0) + Number(row.quantityUsed || 0))
      }
    }

    let allValid = true
    const validated = parts.map((row) => {
      let error: string | null = null

      const used = Number(row.quantityUsed)
      const unit = unitOf(row)

      if (row.addingNew && !row.newItemConfirmed) {
        error = 'Finish adding this new item (or cancel it) before submitting.'
      } else if (!row.addingNew && !row.itemId) {
        error = 'Select an inventory item, or add it as a new one.'
      } else if (row.quantityUsed === '' || Number.isNaN(used) || used <= 0) {
        error = 'Enter a quantity greater than 0.'
      } else if (WHOLE_UNITS.includes(unit) && !Number.isInteger(used)) {
        error = `Quantity in ${unit} must be a whole number.`
      } else if (!row.addingNew && row.itemId) {
        const known = inventoryItems.find((i) => i.item_id === row.itemId)
        const total = totalByItem.get(row.itemId) ?? used
        if (known && total > known.quantity) {
          error =
            total > used
              ? `Only ${known.quantity} ${known.unit} in stock (${total} asked across rows).`
              : `Only ${known.quantity} ${known.unit} in stock.`
        }
      }

      if (error) allValid = false
      return { ...row, error }
    })

    setParts(validated)
    return allValid
  }

  async function handleSubmit() {
    setFormError(null)

    if (savedCompletionId.current === null) {
      if (!description.trim()) {
        setFormError('Enter a description of the work done.')
        return
      }

      if (!validateRows()) {
        setFormError('Fix the errors in the parts list before submitting.')
        return
      }

      const odometerValue = plateNumber && odometerReading ? Number(odometerReading) : null
      if (odometerValue !== null && (Number.isNaN(odometerValue) || odometerValue < 0)) {
        setFormError('Enter a valid odometer reading.')
        return
      }

      setSubmitting(true)

      // One transaction in the DB: either everything below saves or nothing does.
      const { data: completionId, error } = await supabase.rpc('complete_work_order', {
        p_work_order_id: workOrderId,
        p_description: description.trim(),
        p_odometer: odometerValue,
        p_next_service_date: plateNumber && nextServiceDate ? nextServiceDate : null,
        p_notes: notes.trim() || null,
        p_parts: parts
          .filter((row) => !row.addingNew)
          .map((row) => ({ item_id: row.itemId, quantity: Number(row.quantityUsed) })),
        p_new_items: parts
          .filter((row) => row.addingNew)
          .map((row) => ({
            name: row.search.trim(),
            item_type: row.newItemType,
            unit: row.newItemUnit,
            quantity: Number(row.quantityUsed),
          })),
      })

      if (error) {
        setFormError(`${error.message} Nothing was saved.`)
        setSubmitting(false)
        // Stock may have changed under us -- show the current numbers.
        loadInventory()
        return
      }

      savedCompletionId.current = completionId as number

      // Best effort -- the work order is already Completed even if this fails.
      if (employeeId) {
        logWorkOrderStatusChange({
          workOrderId,
          previousStatus,
          newStatus: 'Completed',
          changedByEmployeeId: employeeId,
        })
      }
    }

    setSubmitting(true)

    // Fleet status back to Available -- only if the vehicle is still
    // "Under Maintenance" and no OTHER open work order keeps it in the
    // shop (an Out of Service vehicle stays Out of Service).
    if (plateNumber || trailerId !== null) {
      const releaseError = await releaseVehicleFromShop(plateNumber, trailerId, workOrderId)
      if (releaseError) {
        setFormError(
          `The work order was marked Completed and the parts were saved, but the vehicle's status could not be updated (${releaseError}). Click Mark Complete again to retry just that step.`,
        )
        setSubmitting(false)
        return
      }
    }

    setSubmitting(false)
    setSuccess(true)
  }

  const closeButton = (
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
  )

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
        <div role="dialog" aria-modal="true" aria-labelledby="wo-done-title" className="card w-full max-w-md px-6 py-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center bg-green-100 text-green-800">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
          <h2 id="wo-done-title" className="mt-3 text-lg font-bold text-ink">
            Work Order Completed
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">{workOrderNumber} has been marked complete and inventory was updated.</p>
          <button type="button" onClick={onCompleted} className="btn-primary mt-6 px-6 text-sm">
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="wo-complete-title" className="card flex max-h-[94vh] w-full max-w-[1000px] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="wo-complete-title" className="text-xl leading-7 font-bold text-ink">
              Mark Complete · Work Order {workOrderNumber}
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">
              {subtitle ? `${subtitle}. ` : ''}Required before the job counts as Completed.
            </p>
          </div>
          {closeButton}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {formError && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}

          <div className="grid gap-x-7 gap-y-5 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <label className={labelClasses}>
                <span className="flex justify-between gap-2">
                  <span>Description of work done</span>
                  <span className="text-xs text-amber-800">Required</span>
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="What you did"
                  className={`${fieldClasses} resize-none py-2.5`}
                />
              </label>

              <div className="border border-line bg-slate-50 px-4 py-3.5">
                <h3 className={SECTION_TITLE}>
                  Truck only <span className="font-normal text-ink-muted">· optional</span>
                </h3>
                {plateNumber ? (
                  <>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <label className={labelClasses}>
                        Odometer reading (km)
                        <input
                          inputMode="numeric"
                          value={odometerReading}
                          onChange={(e) => setOdometerReading(e.target.value.replace(/[^\d]/g, ''))}
                          className={`${fieldClasses} tabular-nums`}
                        />
                      </label>
                      <label className={labelClasses}>
                        Suggested next service
                        <input type="date" value={nextServiceDate} onChange={(e) => setNextServiceDate(e.target.value)} className={fieldClasses} />
                      </label>
                    </div>
                    <p className="mt-2 text-[13px] text-ink-muted">The reading must be higher than the truck's current one.</p>
                  </>
                ) : (
                  <p className="text-[13px] text-ink-muted">Not applicable -- this work order is for a trailer.</p>
                )}
              </div>

              <label className={labelClasses}>
                <span>
                  Additional notes <span className="font-normal text-ink-muted">(optional)</span>
                </span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className={fieldClasses} />
              </label>
            </div>

            <div className="flex flex-col gap-3.5">
              <section aria-labelledby="wo-logged">
                <h3 id="wo-logged" className={SECTION_TITLE}>
                  Parts already logged
                </h3>
                {alreadyLoggedParts.length === 0 ? (
                  <p className="text-sm text-ink-muted">None logged during the job.</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-1.5 text-sm text-ink-secondary">
                      {alreadyLoggedParts.map((p) => (
                        <li key={p.log_id} className="flex justify-between border border-slate-200 bg-slate-50 px-3 py-2">
                          <span>{p.item_name_text}</span>
                          <span className="tabular-nums">× {p.quantity}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[13px] text-ink-muted">Already taken out of stock. Don't enter them again.</p>
                  </>
                )}
              </section>

              <section aria-labelledby="wo-other" className="flex flex-col gap-2">
                <h3 id="wo-other" className="text-sm font-semibold text-ink">
                  Other parts used
                </h3>
                {loadingInventory && <p className="text-sm text-ink-muted">Loading inventory...</p>}
                {parts.length > 0 && (
                  <div className="grid grid-cols-[minmax(0,1fr)_110px_44px] gap-2 text-xs font-semibold tracking-[0.04em] text-ink-secondary uppercase">
                    <span>Part</span>
                    <span>Qty</span>
                    <span />
                  </div>
                )}
                {parts.map((row, index) => {
                  const matches = matchesFor(row)
                  const showAddNew =
                    !row.itemId && !row.addingNew && row.dropdownOpen && row.search.trim().length > 0 && matches.length === 0

                  return (
                    <div key={row.key} className="flex flex-col gap-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_110px_44px] items-center gap-2">
                        <div className="relative">
                          <input
                            type="search"
                            value={row.search}
                            placeholder="Search inventory"
                            aria-label={`Part ${index + 1}`}
                            disabled={row.addingNew}
                            onChange={(e) =>
                              updateRow(row.key, {
                                search: e.target.value,
                                itemId: null,
                                dropdownOpen: true,
                              })
                            }
                            onFocus={() => updateRow(row.key, { dropdownOpen: true })}
                            onBlur={() => setTimeout(() => updateRow(row.key, { dropdownOpen: false }), 120)}
                            className={fieldClasses}
                          />

                          {row.dropdownOpen && !row.addingNew && row.search.trim() && (
                            <div className="absolute z-10 mt-1 w-full border-2 border-line-card bg-white">
                              {matches.map((item) => (
                                <button
                                  key={item.item_id}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    selectItem(row.key, item)
                                  }}
                                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-50"
                                >
                                  <span className="text-sm font-medium text-ink">{item.name}</span>
                                  <span className="text-xs text-ink-muted">
                                    {item.item_type} — {item.quantity} {item.unit} in stock
                                  </span>
                                </button>
                              ))}
                              {showAddNew && (
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault()
                                    startAddingNew(row.key, row.search.trim())
                                  }}
                                  className="w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-slate-50"
                                >
                                  + Add "{row.search.trim()}" as a new inventory item
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <input
                          inputMode={WHOLE_UNITS.includes(unitOf(row)) ? 'numeric' : 'decimal'}
                          value={row.quantityUsed}
                          placeholder={unitOf(row)}
                          aria-label={`Quantity for part ${index + 1} (${unitOf(row)})`}
                          onChange={(e) => updateRow(row.key, { quantityUsed: filterQuantity(e.target.value, unitOf(row)) })}
                          className={`${fieldClasses} text-right tabular-nums`}
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(row.key)}
                          aria-label={`Remove part ${index + 1}`}
                          className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50 hover:text-red-700"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M6 6l12 12 M18 6L6 18" />
                          </svg>
                        </button>
                      </div>

                      {row.addingNew && !row.newItemConfirmed && (
                        <div className="flex flex-col gap-2 border border-dashed border-line-control px-3.5 py-3">
                          <span className="text-sm font-semibold text-primary">+ Add "{row.search}" as a new inventory item</span>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-secondary">
                              Item type
                              <select value={row.newItemType} onChange={(e) => updateRow(row.key, { newItemType: e.target.value })} className={fieldClasses}>
                                {NEW_ITEM_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {type}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-secondary">
                              Unit
                              <select
                                value={row.newItemUnit}
                                onChange={(e) =>
                                  updateRow(row.key, {
                                    newItemUnit: e.target.value,
                                    quantityUsed: filterQuantity(row.quantityUsed, e.target.value),
                                  })
                                }
                                className={fieldClasses}
                              >
                                {ITEM_UNITS.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <p className="text-[13px] text-ink-muted">
                            Enter how many you used in the Qty box. Admin sets the price later.
                          </p>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => confirmNewItem(row)} className="btn-secondary px-4 text-sm font-semibold text-primary">
                              Add "{row.search}" as new item
                            </button>
                            <button
                              type="button"
                              onClick={() => updateRow(row.key, { addingNew: false, search: '', error: null })}
                              className="btn-secondary px-4 text-sm font-medium"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {row.addingNew && row.newItemConfirmed && (
                        <p className="text-[13px] text-ink-muted">
                          New item — {row.newItemType}, in {row.newItemUnit}. Admin will set its price.{' '}
                          <button
                            type="button"
                            onClick={() => updateRow(row.key, { newItemConfirmed: false })}
                            className="font-semibold text-primary underline"
                          >
                            Change
                          </button>
                        </p>
                      )}

                      {row.error && <p className="text-[13px] text-red-700">{row.error}</p>}
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setParts((prev) => [...prev, makeEmptyRow()])}
                  className="btn-secondary self-start px-4 text-sm font-medium"
                >
                  + Add {parts.length > 0 ? 'Another ' : ''}Part
                </button>
              </section>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-6 py-4">
          <span className="mr-auto text-[13px] text-ink-muted">
            Saves the record, takes parts out of stock, frees the vehicle and updates the odometer.
          </span>
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary flex items-center gap-2 px-6 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
            {submitting ? 'Saving...' : 'Mark Complete'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default CompleteWorkOrderModal
