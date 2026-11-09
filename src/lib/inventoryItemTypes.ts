// inventoryItemTypes: inventory constants and the pure form rules shared by
// the Inventory page and the mechanic screens. No imports on purpose, so
// the self-check can run it in plain Node:
//   node scripts/check-inventory-rules.ts

// inventory_items.item_type choices.
export const ITEM_TYPES = ['Tools', 'Parts', 'Supplies', 'Equipment', 'Other'] as const

// inventory_items.unit choices -- same list as the column's CHECK in the DB,
// change both together. pcs / set are counted whole; L / kg / m can be decimals.
export const ITEM_UNITS = ['pcs', 'L', 'kg', 'm', 'set'] as const
export type ItemUnit = (typeof ITEM_UNITS)[number]
export const WHOLE_UNITS: readonly string[] = ['pcs', 'set']

// Quantity box typing filter: whole numbers for pcs / set, up to 2 decimals
// for L / kg / m. Max 10 characters.
export function filterQuantity(value: string, unit: string): string {
  if (WHOLE_UNITS.includes(unit)) return value.replace(/[^\d]/g, '').slice(0, 10)
  const cleaned = value.replace(/[^\d.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  return (rest.length === 0 ? whole : `${whole}.${rest.join('').slice(0, 2)}`).slice(0, 10)
}

// Stock level of an item. A reorder level is how Admin says "we keep this
// in stock": only items WITH one count as needing reordering (low or out)
// -- otherwise every item a mechanic added on a job (received N, used N,
// so 0 left) would raise an alert forever.
export type StockLevel = 'out' | 'low' | 'ok'
export function stockLevel(quantity: number, reorderLevel: number | null): StockLevel {
  if (quantity <= 0) return 'out'
  if (reorderLevel !== null && quantity <= reorderLevel) return 'low'
  return 'ok'
}
export function needsReorder(quantity: number, reorderLevel: number | null): boolean {
  return reorderLevel !== null && stockLevel(quantity, reorderLevel) !== 'ok'
}

// Adjust Stock: the admin types how many to REMOVE or ADD (not the new
// total). Reasons per direction -- same rules as the adjust_stock DB
// function (Damaged / Lost only take off, Found only adds), change both
// together.
export type AdjustDirection = 'remove' | 'add'
export const ADJUST_REASONS: Record<AdjustDirection, readonly string[]> = {
  remove: ['Damaged', 'Lost', 'Count correction', 'Other'],
  add: ['Found', 'Count correction', 'Other'],
}

// Why an Adjust Stock form can't be saved yet, or null when it can.
export function adjustError(
  current: number,
  direction: AdjustDirection,
  amountText: string,
  reason: string,
  note: string,
  unit: string,
): string | null {
  if (amountText === '') return `Enter how many to ${direction}.`
  const amount = Number(amountText)
  if (Number.isNaN(amount) || amount <= 0) return 'Enter a quantity more than 0.'
  if (WHOLE_UNITS.includes(unit) && !Number.isInteger(amount)) return `Quantity in ${unit} must be a whole number.`
  if (direction === 'remove' && amount > current) return `Only ${current} ${unit} on hand.`
  if (!reason) return 'Pick a reason.'
  if (!ADJUST_REASONS[direction].includes(reason)) {
    return `"${reason}" can't be used to ${direction} stock.`
  }
  if (reason === 'Other' && !note.trim()) return 'Explain the adjustment.'
  return null
}
