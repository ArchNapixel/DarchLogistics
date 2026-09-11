// AddInventoryItemModal: form for adding OR editing an inventory item.
// Pass an `item` prop to edit that row (fields pre-filled, submit does
// an UPDATE); omit it to add a new one (submit does an INSERT).
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

export const ITEM_TYPES = ['Tools', 'Parts', 'Supplies', 'Equipment', 'Other'] as const

export type EditableInventoryItem = {
  item_id: number
  name: string
  item_type: (typeof ITEM_TYPES)[number]
  quantity: number
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

  const [name, setName] = useState(item?.name ?? '')
  const [itemType, setItemType] = useState<(typeof ITEM_TYPES)[number]>(
    item?.item_type ?? 'Tools',
  )
  const [quantity, setQuantity] = useState(
    item?.quantity != null ? String(item.quantity) : '0',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim()) {
      setError('Enter an item name.')
      return
    }

    const quantityValue = Number(quantity)
    if (quantity === '' || Number.isNaN(quantityValue) || quantityValue < 0) {
      setError('Enter a valid quantity (0 or more).')
      return
    }

    setSubmitting(true)
    setError(null)

    const values = {
      name: name.trim(),
      item_type: itemType,
      quantity: quantityValue,
    }

    const { error: saveError } = isEditing
      ? await supabase
          .from('inventory_items')
          .update(values)
          .eq('item_id', item.item_id)
      : await supabase.from('inventory_items').insert(values)

    setSubmitting(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
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
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4">
          <label className={labelClasses}>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClasses}
            />
          </label>

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
            Quantity
            <input
              type="number"
              min="0"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={fieldClasses}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
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
