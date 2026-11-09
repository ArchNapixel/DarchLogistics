// AddInventoryItemModal: form for adding OR editing an inventory item.
// Pass an `item` prop to edit that row (fields pre-filled); omit it to add
// a new one.
// Adding goes through the create_inventory_item database function: it
// refuses a duplicate name and saves the starting stock as the item's
// first batch (with its price) in the stock history.
// Editing changes name / type / unit / price only. The quantity is
// read-only here -- stock only changes through stock movements (parts used
// on work orders, Receive / Adjust Stock on the Inventory page), so nobody
// can type over the count and lose the record of why it changed. The price
// is the item's LISTED (latest) price; each batch keeps what it really cost.
// Unit price is required -- every use of the item on a work order is
// charged at a price in the maintenance cost report.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { ITEM_TYPES, ITEM_UNITS, WHOLE_UNITS, type ItemUnit } from '../../../lib/inventoryItemTypes'

const fieldClasses =
  'border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

export type EditableInventoryItem = {
  item_id: number
  name: string
  item_type: (typeof ITEM_TYPES)[number]
  unit: ItemUnit
  quantity: number
  unit_cost: number | null
  // added by a mechanic on a job -- priced through Set Price, not here
  needs_price: boolean
}

function AddInventoryItemModal({
  item,
  onClose,
  onSaved,
}: {
  item?: EditableInventoryItem
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = !!item
  const priceViaSetPrice = !!item?.needs_price

  const [name, setName] = useState(item?.name ?? '')
  const [itemType, setItemType] = useState<(typeof ITEM_TYPES)[number]>(
    item?.item_type ?? 'Tools',
  )
  const [unit, setUnit] = useState<ItemUnit>(item?.unit ?? 'pcs')
  const [quantity, setQuantity] = useState('0')
  const [unitCost, setUnitCost] = useState(
    item?.unit_cost != null ? String(item.unit_cost) : '',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim()) {
      setError('Enter an item name.')
      return
    }

    const unitCostValue = Number(unitCost)
    if (!priceViaSetPrice && (unitCost === '' || Number.isNaN(unitCostValue) || unitCostValue < 0)) {
      setError('Enter the unit price (0 or more).')
      return
    }

    const quantityValue = Number(quantity)
    if (!isEditing) {
      if (quantity === '' || Number.isNaN(quantityValue) || quantityValue < 0) {
        setError('Enter a valid quantity (0 or more).')
        return
      }
      if (WHOLE_UNITS.includes(unit) && !Number.isInteger(quantityValue)) {
        setError(`Quantity in ${unit} must be a whole number.`)
        return
      }
    }

    setSubmitting(true)
    setError(null)

    if (isEditing) {
      // No quantity here on purpose (see the top of this file).
      // .select() so an RLS silent no-op shows up as an error.
      const { data: updated, error: saveError } = await supabase
        .from('inventory_items')
        .update(
          priceViaSetPrice
            ? { name: name.trim(), item_type: itemType, unit }
            : { name: name.trim(), item_type: itemType, unit, unit_cost: unitCostValue },
        )
        .eq('item_id', item.item_id)
        .select('item_id')
        .maybeSingle()

      setSubmitting(false)
      if (saveError) {
        // '23505' = unique violation: another item already has this name.
        setError(
          saveError.code === '23505'
            ? `An item called "${name.trim()}" already exists.`
            : saveError.message,
        )
        return
      }
      if (!updated) {
        setError('The item was not updated (no permission, or it was deleted).')
        return
      }
    } else {
      const { error: saveError } = await supabase.rpc('create_inventory_item', {
        p_name: name.trim(),
        p_item_type: itemType,
        p_unit: unit,
        p_quantity: quantityValue,
        p_unit_cost: unitCostValue,
      })
      setSubmitting(false)
      if (saveError) {
        setError(saveError.message)
        return
      }
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            {isEditing ? 'Edit Inventory Item' : 'Add Inventory Item'}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4">
          <label className={labelClasses}>
            Name
            <input
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className={labelClasses}>
              Type
              <select
                value={itemType}
                onChange={(e) =>
                  setItemType(e.target.value as (typeof ITEM_TYPES)[number])
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
              Unit
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as ItemUnit)}
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

          {isEditing ? (
            <div className={labelClasses}>
              Quantity on hand
              <p className="text-base font-semibold text-slate-900 tabular-nums">
                {item.quantity} {item.unit}
              </p>
              <p className="text-xs font-normal text-slate-500">
                Stock changes only through parts used on work orders, and Receive / Adjust Stock.
              </p>
            </div>
          ) : (
            <label className={labelClasses}>
              Starting quantity
              <input
                type="number"
                min="0"
                step={WHOLE_UNITS.includes(unit) ? '1' : '0.01'}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className={fieldClasses}
              />
            </label>
          )}

          {priceViaSetPrice ? (
            <div className={labelClasses}>
              Unit price
              <p className="text-sm font-normal text-amber-800">
                Needs a price -- use Set Price on the item, so the uses already recorded get it too.
              </p>
            </div>
          ) : (
            <label className={labelClasses}>
              Unit price (₱)
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className={fieldClasses}
              />
            </label>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            {submitting
              ? isEditing
                ? 'Saving...'
                : 'Adding...'
              : isEditing
                ? 'Save Changes'
                : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddInventoryItemModal
