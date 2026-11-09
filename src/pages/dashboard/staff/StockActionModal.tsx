// StockActionModal: the Inventory page's three stock pop-ups (Admin only).
//   receive -- stock delivered: quantity + unit price -> receive_stock. Each
//              delivery becomes its own batch at its own price (used oldest
//              first), and the item's listed price becomes this latest one.
//   adjust  -- remove or add an amount, with a reason -> adjust_stock_by
//              (the DB works out the new total at save time, so a part used
//              meanwhile can't throw it off). Damaged / Lost are write-offs
//              (remove only), Found only adds; rules in
//              lib/inventoryItemTypes.ts (adjustError), same as the DB.
//   price   -- give a "Needs price" item (added by a mechanic on a job) its
//              price -> set_item_price, which also fills in the cost of
//              every use already recorded without one.
// The DB functions re-check everything; their message is shown as is.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { formatMoney } from '../../../lib/format'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import {
  ADJUST_REASONS,
  WHOLE_UNITS,
  adjustError,
  filterQuantity,
  type AdjustDirection,
} from '../../../lib/inventoryItemTypes'

export type StockAction = 'receive' | 'adjust' | 'price'

export type StockActionItem = {
  item_id: number
  name: string
  unit: string
  quantity: number
  unit_cost: number | null
}

const TITLES: Record<StockAction, string> = {
  receive: 'Receive Stock',
  adjust: 'Adjust Stock',
  price: 'Set Price',
}

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const labelClasses = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'

function StockActionModal({
  item,
  action,
  onClose,
  onSaved,
}: {
  item: StockActionItem
  action: StockAction
  onClose: () => void
  // toast text
  onSaved: (message: string) => void
}) {
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [direction, setDirection] = useState<AdjustDirection>('remove')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const qty = Number(quantity)
  // receive always adds; adjust adds or removes
  const change = quantity === '' || !(qty > 0) ? null : action === 'adjust' && direction === 'remove' ? -qty : qty
  // round away float leftovers (0.1 + 0.2)
  const stockAfter = change === null ? null : Math.round((item.quantity + change) * 100) / 100

  function pickDirection(next: AdjustDirection) {
    setDirection(next)
    if (!ADJUST_REASONS[next].includes(reason)) setReason('')
  }

  async function handleSave() {
    setError(null)
    let call: PromiseLike<{ error: { message: string } | null }>
    let message: string

    if (action === 'adjust') {
      const formError = adjustError(item.quantity, direction, quantity, reason, note, item.unit)
      if (formError) return setError(formError)
      call = supabase.rpc('adjust_stock_by', {
        p_item_id: item.item_id,
        p_change: direction === 'remove' ? -qty : qty,
        p_reason: reason,
        p_note: note.trim() || null,
      })
      message = `${item.name}: ${direction === 'remove' ? 'removed' : 'added'} ${qty} ${item.unit}.`
    } else {
      if (action === 'receive') {
        if (quantity === '' || !(qty > 0)) return setError('Enter how many were received.')
        if (WHOLE_UNITS.includes(item.unit) && !Number.isInteger(qty)) {
          return setError(`Quantity in ${item.unit} must be a whole number.`)
        }
      }
      const parsed = parseAmount(price)
      if (parsed.value === null) return setError(parsed.error ?? 'Enter the unit price.')

      if (action === 'receive') {
        call = supabase.rpc('receive_stock', {
          p_item_id: item.item_id,
          p_quantity: qty,
          p_unit_cost: parsed.value,
          p_note: note.trim() || null,
        })
        message = `Received ${qty} ${item.unit} of ${item.name}.`
      } else {
        call = supabase.rpc('set_item_price', { p_item_id: item.item_id, p_unit_cost: parsed.value })
        message = `${item.name} is now ${formatMoney(parsed.value)} per ${item.unit}.`
      }
    }

    setSaving(true)
    const { error: saveError } = await call
    setSaving(false)
    if (saveError) return setError(saveError.message)
    onSaved(message)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="stock-action-title" className="card w-full max-w-md">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="stock-action-title" className="text-xl leading-7 font-bold text-ink">
              {TITLES[action]}
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">
              {item.name} · {item.quantity} {item.unit} on hand
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleSave()
          }}
          className="flex flex-col gap-4 px-6 py-5"
        >
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          {action === 'adjust' && (
            <div role="group" aria-label="Remove or add stock" className="grid grid-cols-2 gap-2">
              {(['remove', 'add'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={direction === d}
                  onClick={() => pickDirection(d)}
                  className={`min-h-11 rounded-[2px] border text-sm font-semibold ${
                    direction === d ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-secondary hover:bg-slate-50'
                  }`}
                >
                  {d === 'remove' ? 'Remove stock' : 'Add stock'}
                </button>
              ))}
            </div>
          )}

          {action !== 'price' && (
            <label className={labelClasses}>
              {action === 'receive'
                ? `Quantity received (${item.unit})`
                : `Quantity to ${direction} (${item.unit})`}
              <input
                inputMode={WHOLE_UNITS.includes(item.unit) ? 'numeric' : 'decimal'}
                value={quantity}
                onChange={(e) => setQuantity(filterQuantity(e.target.value, item.unit))}
                className={`${fieldClasses} tabular-nums`}
                autoFocus
              />
              {stockAfter !== null && (
                <span className={`text-[13px] font-normal ${stockAfter < 0 ? 'text-red-700' : 'text-ink-muted'}`}>
                  Stock after: {stockAfter} {item.unit}
                  {stockAfter < 0 && ' -- more than is on hand'}
                </span>
              )}
            </label>
          )}

          {action === 'adjust' && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-semibold text-ink">Reason</legend>
              <div className="grid grid-cols-2 gap-2">
                {ADJUST_REASONS[direction].map((r) => (
                  <label
                    key={r}
                    className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[2px] border px-3 text-sm font-medium ${
                      reason === r ? 'border-primary bg-primary-soft text-ink' : 'border-line-control text-ink-secondary'
                    }`}
                  >
                    <input type="radio" name="adjust-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                    {r}
                  </label>
                ))}
              </div>
              <span className="text-[13px] text-ink-muted">
                {direction === 'remove'
                  ? 'Damaged and Lost are recorded as write-offs. Stock comes off the oldest batch first.'
                  : "Added stock is valued at the item's listed price. Bought stock? Use Receive Stock instead."}
              </span>
            </fieldset>
          )}

          {action !== 'adjust' && (
            <label className={labelClasses}>
              Unit price (₱ per {item.unit})
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(filterAmountInput(e.target.value))}
                placeholder={item.unit_cost !== null ? String(item.unit_cost) : undefined}
                className={`${fieldClasses} tabular-nums`}
                autoFocus={action === 'price'}
              />
              <span className="text-[13px] font-normal text-ink-muted">
                {action === 'receive'
                  ? 'What this delivery cost. It becomes its own batch, used after the older ones.'
                  : 'Also fills in the cost of every use of this item recorded without a price.'}
              </span>
            </label>
          )}

          {action !== 'price' && (
            <label className={labelClasses}>
              <span>
                Note{' '}
                <span className="font-normal text-ink-muted">
                  {action === 'adjust' && reason === 'Other' ? '(required)' : '(optional)'}
                </span>
              </span>
              <input
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder={action === 'receive' ? 'e.g. supplier, receipt no.' : 'e.g. found during shelf check'}
                className={fieldClasses}
              />
            </label>
          )}

          <div className="flex justify-end gap-3 border-t border-line pt-4">
            <button type="button" onClick={onClose} disabled={saving} className="btn-secondary px-5 text-sm font-medium">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-6 text-sm">
              {saving ? 'Saving...' : TITLES[action]}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default StockActionModal
