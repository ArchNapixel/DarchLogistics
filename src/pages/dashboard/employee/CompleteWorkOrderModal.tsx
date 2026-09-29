// CompleteWorkOrderModal: shown when a mechanic sets a work order's
// status to "Completed" in MechanicTasks.tsx. Marking a work order
// complete isn't allowed to happen silently -- the mechanic must first
// describe what was done and list any parts used, so every part used is
// traceable back to a real inventory_items row (no free-text parts).
//
// Parts already logged mid-job via AccessWorkOrderModal's "Log Part
// Used" (workOrderPartsLog.ts) show up here read-only -- their stock was
// already decremented the moment they were logged, so they're copied
// into work_order_parts_used at the end WITHOUT decrementing again.
// Only parts added fresh in this modal go through the stock-recheck/
// decrement steps below.
//
// Steps on submit (not wrapped in a real DB transaction -- same known
// limitation as QuoteReviewModal's Approve flow and payslip.ts's
// issuePayslip -- so a failure partway through is surfaced with a
// specific "needs manual review" message instead of a generic one,
// naming exactly what was saved and what wasn't):
//   1. Create any brand-new inventory items the mechanic added inline
//   2. Insert the work_order_completions row
//   3. Insert one work_order_parts_used row per part -- both the ones
//      entered fresh here AND the ones already logged mid-job. Each row
//      carries unit_cost, the item's price at the time it was used
//      (fresh-read for parts entered here, the logged price for mid-job
//      parts) -- the maintenance cost report sums quantity x unit_cost.
//   4. Re-check stock (someone else may have used the same part since
//      this modal opened) and decrement inventory_items for each
//      FRESHLY entered part only (already-logged ones were decremented
//      when they were logged)
//   5. Update work_orders.work_order_status to "Completed"
//   6. Reset the vehicle's fleet status back to "Available" (it was set
//      to "Under Maintenance" when the work order was created --
//      CreateWorkOrderModal.tsx). For a truck (plate_number set), also
//      sync truck_profiles.current_odometer / next_service_date /
//      last_service_date.
//
// Retry-safe: `progress` remembers which steps already succeeded, so if
// a later step fails and the mechanic clicks "Mark Complete" again, the
// completion row / parts rows aren't inserted twice and stock isn't
// deducted twice -- it picks up where it left off.
//
// Reopened jobs: if this work order was completed before (then reopened
// through a Status Relog Request), only parts logged AFTER that earlier
// completion are copied in -- the older ones are already on the earlier
// completion, and copying them again would double-count them in the
// maintenance cost report.
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { logWorkOrderStatusChange } from '../../../lib/workOrderStatusLog'
import {
  decrementStock,
  loadWorkOrderPartsLog,
  type LoggedPart,
} from '../../../lib/workOrderPartsLog'
import { ITEM_TYPES } from '../staff/AddInventoryItemModal'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type InventoryItemOption = {
  item_id: number
  name: string
  item_type: string
  quantity: number
  unit_cost: number | null
}

type PartRow = {
  key: number
  itemId: number | null
  search: string
  dropdownOpen: boolean
  addingNew: boolean
  newItemConfirmed: boolean
  newItemType: string
  newItemQuantity: string
  newItemUnitCost: string
  quantityUsed: string
  error: string | null
}

// New items added inline from this modal are almost always consumable
// spare parts (brake pads, filters, belts...), not hand tools or shop
// equipment -- default to "Parts" rather than the first entry in the
// list. The mechanic can still change it in the dropdown.
const DEFAULT_NEW_ITEM_TYPE = ITEM_TYPES.includes('Parts' as (typeof ITEM_TYPES)[number])
  ? 'Parts'
  : ITEM_TYPES[0]

let nextRowKey = 1
function makeEmptyRow(): PartRow {
  return {
    key: nextRowKey++,
    itemId: null,
    search: '',
    dropdownOpen: false,
    addingNew: false,
    newItemConfirmed: false,
    newItemType: DEFAULT_NEW_ITEM_TYPE,
    newItemQuantity: '',
    newItemUnitCost: '',
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
  onClose,
  onCompleted,
}: {
  workOrderId: number
  workOrderNumber: string
  plateNumber: string | null
  trailerId: number | null
  previousStatus: string
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

  // Which submit steps already succeeded (see "Retry-safe" above).
  const progress = useRef({
    completionId: null as number | null,
    decrementedRowKeys: new Set<number>(),
    statusDone: false,
  })

  useEffect(() => {
    loadInventory()
    loadAlreadyLoggedParts()
  }, [workOrderId])

  async function loadAlreadyLoggedParts() {
    const [{ parts: logged, error }, { data: lastCompletion }] = await Promise.all([
      loadWorkOrderPartsLog(workOrderId),
      supabase
        .from('work_order_completions')
        .select('completed_at')
        .eq('work_order_id', workOrderId)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (error) return

    // Only parts logged since the previous completion (if any).
    const since = lastCompletion ? new Date(lastCompletion.completed_at).getTime() : null
    setAlreadyLoggedParts(
      since ? logged.filter((p) => new Date(p.used_at).getTime() > since) : logged,
    )
  }

  async function loadInventory() {
    setLoadingInventory(true)
    const { data, error } = await supabase
      .from('inventory_items')
      .select('item_id, name, item_type, quantity, unit_cost')
      .order('name', { ascending: true })

    if (!error && data) {
      setInventoryItems(data)
    }
    setLoadingInventory(false)
  }

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
      newItemType: DEFAULT_NEW_ITEM_TYPE,
      newItemQuantity: '',
      newItemUnitCost: '',
      dropdownOpen: false,
      itemId: null,
      search: typedName,
      error: null,
    })
  }

  function confirmNewItem(row: PartRow) {
    const qty = Number(row.newItemQuantity)
    if (!row.search.trim()) {
      updateRow(row.key, { error: 'Enter a name for the new item.' })
      return
    }
    if (row.newItemQuantity === '' || Number.isNaN(qty) || qty < 0) {
      updateRow(row.key, { error: 'Enter a valid starting quantity (0 or more).' })
      return
    }
    // Every inventory item must have a price -- it's what the
    // maintenance cost report charges each use against.
    const price = Number(row.newItemUnitCost)
    if (row.newItemUnitCost === '' || Number.isNaN(price) || price < 0) {
      updateRow(row.key, { error: 'Enter the unit price (0 or more).' })
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

  function validateRows(): boolean {
    let allValid = true
    const validated = parts.map((row) => {
      let error: string | null = null

      const used = Number(row.quantityUsed)
      const usedInvalid =
        row.quantityUsed === '' || Number.isNaN(used) || used <= 0

      if (row.addingNew) {
        if (!row.newItemConfirmed) {
          error = 'Finish adding this new item (or cancel it) before submitting.'
        } else if (usedInvalid) {
          error = 'Enter a quantity greater than 0.'
        } else {
          const startingQty = Number(row.newItemQuantity)
          if (used > startingQty) {
            error = `Only ${startingQty} in stock.`
          }
        }
      } else if (!row.itemId) {
        error = 'Select an inventory item, or add it as a new one.'
      } else if (usedInvalid) {
        error = 'Enter a quantity greater than 0.'
      } else {
        const known = inventoryItems.find((i) => i.item_id === row.itemId)
        if (known && used > known.quantity) {
          error = `Only ${known.quantity} in stock.`
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

    if (!description.trim()) {
      setFormError('Enter a description of the work done.')
      return
    }

    if (!validateRows()) {
      setFormError('Fix the errors in the parts list before submitting.')
      return
    }

    const odometerValue = odometerReading ? Number(odometerReading) : null
    if (odometerReading && (Number.isNaN(odometerValue!) || odometerValue! < 0)) {
      setFormError('Enter a valid odometer reading.')
      return
    }

    setSubmitting(true)

    // If this work order is for a truck, re-fetch its current odometer
    // fresh (not the value from whenever this order list last loaded) so
    // the "must be higher" check is accurate.
    if (plateNumber && odometerValue !== null) {
      const { data: truck, error: truckReadError } = await supabase
        .from('truck_profiles')
        .select('current_odometer')
        .eq('plate_number', plateNumber)
        .single()

      if (truckReadError || !truck) {
        setFormError(
          `Could not read the truck's current odometer to validate this reading (${truckReadError?.message ?? 'no data returned'}). Nothing was saved.`,
        )
        setSubmitting(false)
        return
      }

      if (truck.current_odometer != null && odometerValue <= truck.current_odometer) {
        setFormError(
          `Odometer reading must be higher than the truck's current recorded value (${truck.current_odometer}).`,
        )
        setSubmitting(false)
        return
      }
    }

    // Re-check stock for existing (not brand-new) items right before we
    // touch anything -- someone else may have used the same part since
    // this modal's inventory list loaded.
    // (Rows already deducted on an earlier attempt are skipped -- their
    // stock is naturally lower now.)
    const existingRows = parts.filter(
      (row) => !row.addingNew && !progress.current.decrementedRowKeys.has(row.key),
    )
    const freshPriceById = new Map<number, number | null>()
    if (existingRows.length > 0) {
      const ids = existingRows.map((row) => row.itemId as number)
      const { data: freshItems, error: freshError } = await supabase
        .from('inventory_items')
        .select('item_id, quantity, unit_cost')
        .in('item_id', ids)

      if (freshError) {
        setFormError(`Could not re-check current stock (${freshError.message}). Nothing was saved.`)
        setSubmitting(false)
        return
      }

      const freshById = new Map(freshItems.map((i) => [i.item_id, i.quantity]))
      freshItems.forEach((i) => freshPriceById.set(i.item_id, i.unit_cost))
      for (const row of existingRows) {
        const current = freshById.get(row.itemId as number)
        if (current === undefined) {
          setFormError(
            `Could not verify current stock for "${row.search}" -- it may have been removed. Nothing was saved.`,
          )
          setSubmitting(false)
          return
        }
        const used = Number(row.quantityUsed)
        if (used > current) {
          setFormError(
            `"${row.search}" now has only ${current} in stock (someone else may have used it) -- not enough for the ${used} entered. Adjust the quantity and try again. Nothing was saved.`,
          )
          setSubmitting(false)
          return
        }
      }
    }

    // 1. Create any brand-new inventory items, capturing their new item_id.
    const resolvedParts: {
      rowKey: number
      itemId: number
      quantity: number
      label: string
      unitCost: number | null
    }[] = []
    const createdItemNames: string[] = []

    for (const row of parts) {
      if (row.addingNew) {
        const { data: newItem, error: createError } = await supabase
          .from('inventory_items')
          .insert({
            name: row.search.trim(),
            item_type: row.newItemType,
            quantity: Number(row.newItemQuantity),
            unit_cost: Number(row.newItemUnitCost),
          })
          .select('item_id')
          .single()

        if (createError || !newItem) {
          setFormError(
            `Could not create new inventory item "${row.search}" (${createError?.message ?? 'no data returned'}).` +
              (createdItemNames.length > 0
                ? ` Note: ${createdItemNames.join(', ')} were already created in Inventory before this failed -- check Inventory before retrying to avoid duplicates.`
                : ' Nothing was saved.'),
          )
          setSubmitting(false)
          return
        }

        createdItemNames.push(row.search.trim())
        resolvedParts.push({
          rowKey: row.key,
          itemId: newItem.item_id,
          quantity: Number(row.quantityUsed),
          label: row.search.trim(),
          unitCost: Number(row.newItemUnitCost),
        })

        // Flip this row from "staged new item" to "existing item" right
        // away. If a later step below fails and the mechanic retries
        // without touching this row, it must NOT insert into
        // inventory_items again -- that would create a duplicate. The
        // item now genuinely exists, so treat it like any other
        // already-selected item from here on.
        updateRow(row.key, {
          itemId: newItem.item_id,
          addingNew: false,
          newItemConfirmed: false,
        })
        setInventoryItems((prev) => [
          ...prev,
          {
            item_id: newItem.item_id,
            name: row.search.trim(),
            item_type: row.newItemType,
            quantity: Number(row.newItemQuantity),
            unit_cost: Number(row.newItemUnitCost),
          },
        ])
      } else {
        resolvedParts.push({
          rowKey: row.key,
          itemId: row.itemId as number,
          quantity: Number(row.quantityUsed),
          label: row.search,
          unitCost: freshPriceById.get(row.itemId as number) ?? null,
        })
      }
    }

    const newItemsNote =
      createdItemNames.length > 0
        ? ` New inventory item(s) already created: ${createdItemNames.join(', ')}.`
        : ''

    // 2 + 3 run only once -- on a retry after a later step failed, the
    // completion and its parts rows already exist (see "Retry-safe").
    if (progress.current.completionId === null) {
      // 2. Insert the completion record.
      const { data: completion, error: completionError } = await supabase
        .from('work_order_completions')
        .insert({
          work_order_id: workOrderId,
          employee_id: employeeId,
          description: description.trim(),
          odometer_reading: odometerValue,
          next_service_date: nextServiceDate || null,
          notes: notes.trim() || null,
          completed_at: new Date().toISOString(),
        })
        .select('completion_id')
        .single()

      if (completionError || !completion) {
        setFormError(
          `Could not save the completion record (${completionError?.message ?? 'no data returned'}).${newItemsNote} This needs manual review.`,
        )
        setSubmitting(false)
        return
      }

      // 3. Insert the parts-used rows, linked to that completion -- both
      // the ones entered fresh here AND the ones already logged mid-job
      // (their stock was decremented already, when they were logged --
      // this just carries them into the completion record for reporting).
      const allPartsForCompletion = [
        ...resolvedParts.map((p) => ({
          completion_id: completion.completion_id,
          item_id: p.itemId,
          item_name_text: p.label,
          quantity: p.quantity,
          unit_cost: p.unitCost,
        })),
        ...alreadyLoggedParts.map((p) => ({
          completion_id: completion.completion_id,
          item_id: p.item_id,
          item_name_text: p.item_name_text,
          quantity: p.quantity,
          unit_cost: p.unit_cost,
        })),
      ]

      if (allPartsForCompletion.length > 0) {
        const { error: partsError } = await supabase
          .from('work_order_parts_used')
          .insert(allPartsForCompletion)

        if (partsError) {
          setFormError(
            `Completion record #${completion.completion_id} was saved, but the parts used could not be recorded (${partsError.message}).${newItemsNote} This needs manual review -- inventory was not adjusted and the work order is still not marked Completed.`,
          )
          setSubmitting(false)
          return
        }
      }

      progress.current.completionId = completion.completion_id
    }

    const completionId = progress.current.completionId

    // 4. Decrement inventory for each freshly entered part (race-guarded
    // in decrementStock). Parts already deducted on an earlier attempt
    // are skipped.
    for (const part of resolvedParts) {
      if (progress.current.decrementedRowKeys.has(part.rowKey)) continue

      const { error: stockError } = await decrementStock(part.itemId, part.quantity)

      if (stockError) {
        setFormError(
          `Completion #${completionId} was saved, but stock for "${part.label}" could not be updated (${stockError}). Fix the quantity or restock it, then click Mark Complete again -- the completion won't be saved twice.`,
        )
        setSubmitting(false)
        return
      }

      progress.current.decrementedRowKeys.add(part.rowKey)
    }

    // 5. Mark the work order Completed. .select() so an RLS silent no-op
    // (0 rows updated, no error) is caught instead of showing success.
    if (!progress.current.statusDone) {
      const { data: statusRow, error: statusError } = await supabase
        .from('work_orders')
        .update({ work_order_status: 'Completed' })
        .eq('work_order_id', workOrderId)
        .select('work_order_id')
        .maybeSingle()

      if (statusError || !statusRow) {
        setFormError(
          `Completion #${completionId} and inventory were saved, but the work order status could not be updated to Completed (${statusError?.message ?? 'no row was updated'}). Click Mark Complete again to retry.`,
        )
        setSubmitting(false)
        return
      }

      progress.current.statusDone = true

      // Best effort -- the status change above already succeeded even if
      // this fails.
      if (employeeId) {
        logWorkOrderStatusChange({
          workOrderId,
          previousStatus,
          newStatus: 'Completed',
          changedByEmployeeId: employeeId,
        })
      }
    }

    // 6. Reset the vehicle's fleet status, and for a truck job also sync
    // odometer / service dates. .select() catches a silent no-op here too.
    if (plateNumber) {
      const truckUpdates: Record<string, string | number> = {
        current_status: 'Available',
      }
      if (odometerValue !== null) truckUpdates.current_odometer = odometerValue
      if (nextServiceDate) {
        truckUpdates.next_service_date = nextServiceDate
        truckUpdates.last_service_date = new Date().toISOString().slice(0, 10)
      }

      const { data: truckRow, error: truckError } = await supabase
        .from('truck_profiles')
        .update(truckUpdates)
        .eq('plate_number', plateNumber)
        .select('plate_number')
        .maybeSingle()

      if (truckError || !truckRow) {
        setFormError(
          `Work order was marked Completed, but the truck profile could not be updated (${truckError?.message ?? 'no row was updated'}). Click Mark Complete again to retry.`,
        )
        setSubmitting(false)
        return
      }
    } else if (trailerId !== null) {
      const { data: trailerRow, error: trailerError } = await supabase
        .from('trailers')
        .update({ current_status: 'Available' })
        .eq('trailer_id', trailerId)
        .select('trailer_id')
        .maybeSingle()

      if (trailerError || !trailerRow) {
        setFormError(
          `Work order was marked Completed, but the trailer's status could not be updated (${trailerError?.message ?? 'no row was updated'}). Click Mark Complete again to retry.`,
        )
        setSubmitting(false)
        return
      }
    }

    setSubmitting(false)
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-lg">
          <p className="text-3xl">✅</p>
          <h3 className="mt-2 text-lg font-bold text-slate-900">
            Work Order Completed
          </h3>
          <p className="mt-2 text-sm text-slate-600">
            {workOrderNumber} has been marked complete and inventory was updated.
          </p>
          <button
            onClick={onCompleted}
            className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Complete {workOrderNumber}
          </h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {formError && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </p>
        )}

        <div className="mt-4 grid gap-4">
          <label className={labelClasses}>
            Description of work done
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={fieldClasses}
            />
          </label>

          <div>
            <p className="text-sm font-medium text-slate-700">Parts / products used</p>

            {alreadyLoggedParts.length > 0 && (
              <div className="mt-2 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">
                  Already logged during the job -- no need to re-enter these:
                </p>
                <ul className="mt-1 grid gap-0.5 text-sm text-slate-700">
                  {alreadyLoggedParts.map((p) => (
                    <li key={p.log_id}>
                      {p.item_name_text} × {p.quantity}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {loadingInventory && (
              <p className="mt-2 text-sm text-slate-500">Loading inventory...</p>
            )}

            <div className="mt-2 grid gap-3">
              {parts.map((row) => {
                const matches = matchesFor(row)
                const showAddNew =
                  !row.itemId &&
                  !row.addingNew &&
                  row.dropdownOpen &&
                  row.search.trim().length > 0 &&
                  matches.length === 0

                return (
                  <div
                    key={row.key}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="relative flex-1">
                        <input
                          type="text"
                          value={row.search}
                          placeholder="Search inventory..."
                          disabled={row.addingNew}
                          onChange={(e) =>
                            updateRow(row.key, {
                              search: e.target.value,
                              itemId: null,
                              dropdownOpen: true,
                            })
                          }
                          onFocus={() => updateRow(row.key, { dropdownOpen: true })}
                          onBlur={() =>
                            setTimeout(
                              () => updateRow(row.key, { dropdownOpen: false }),
                              120,
                            )
                          }
                          className={`${fieldClasses} w-full ${row.addingNew ? 'bg-slate-100 text-slate-500' : ''}`}
                        />

                        {row.dropdownOpen && !row.addingNew && row.search.trim() && (
                          <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
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
                                <span className="text-sm font-medium text-slate-900">
                                  {item.name}
                                </span>
                                <span className="text-xs text-slate-500">
                                  {item.item_type} — {item.quantity} in stock
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
                                className="w-full border-t border-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                              >
                                + Add "{row.search.trim()}" as a new inventory item
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        className="mt-2 text-slate-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </div>

                    {row.addingNew && !row.newItemConfirmed && (
                      <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                        <label className={labelClasses}>
                          Item type
                          <select
                            value={row.newItemType}
                            onChange={(e) =>
                              updateRow(row.key, { newItemType: e.target.value })
                            }
                            className={fieldClasses}
                          >
                            {ITEM_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className={labelClasses}>
                          Starting quantity
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.newItemQuantity}
                            onChange={(e) =>
                              updateRow(row.key, { newItemQuantity: e.target.value })
                            }
                            className={fieldClasses}
                          />
                        </label>

                        <label className={labelClasses}>
                          Unit price (₱)
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.newItemUnitCost}
                            onChange={(e) =>
                              updateRow(row.key, { newItemUnitCost: e.target.value })
                            }
                            className={fieldClasses}
                          />
                        </label>

                        <div className="flex items-end gap-2 sm:col-span-2">
                          <button
                            type="button"
                            onClick={() => confirmNewItem(row)}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                          >
                            Add "{row.search}" as new item
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateRow(row.key, {
                                addingNew: false,
                                search: '',
                                error: null,
                              })
                            }
                            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {row.addingNew && row.newItemConfirmed && (
                      <p className="mt-2 text-xs text-slate-500">
                        New item — {row.newItemType}, starting stock{' '}
                        {row.newItemQuantity}, ₱{row.newItemUnitCost} each.{' '}
                        <button
                          type="button"
                          onClick={() =>
                            updateRow(row.key, { newItemConfirmed: false })
                          }
                          className="font-medium text-slate-700 underline"
                        >
                          Change
                        </button>
                      </p>
                    )}

                    <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                      Quantity used
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={row.quantityUsed}
                        onChange={(e) =>
                          updateRow(row.key, { quantityUsed: e.target.value })
                        }
                        className={`${fieldClasses} w-28`}
                      />
                    </label>

                    {row.error && (
                      <p className="mt-2 text-xs text-red-700">{row.error}</p>
                    )}
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => setParts((prev) => [...prev, makeEmptyRow()])}
              className="mt-3 text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              + Add another part
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClasses}>
              Odometer reading (optional)
              <input
                type="number"
                min="0"
                step="1"
                value={odometerReading}
                onChange={(e) => setOdometerReading(e.target.value)}
                className={fieldClasses}
                disabled={!plateNumber}
              />
              {!plateNumber && (
                <span className="text-xs text-slate-400">
                  Not applicable — this work order is for a trailer.
                </span>
              )}
            </label>

            <label className={labelClasses}>
              Suggested next service date (optional)
              <input
                type="date"
                value={nextServiceDate}
                onChange={(e) => setNextServiceDate(e.target.value)}
                className={fieldClasses}
                disabled={!plateNumber}
              />
              {!plateNumber && (
                <span className="text-xs text-slate-400">
                  Not applicable — this work order is for a trailer.
                </span>
              )}
            </label>
          </div>

          <label className={labelClasses}>
            Additional notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={fieldClasses}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Mark Complete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CompleteWorkOrderModal
