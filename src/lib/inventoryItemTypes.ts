// inventoryItemTypes: the inventory_items.item_type choices.
export const ITEM_TYPES = ['Tools', 'Parts', 'Supplies', 'Equipment', 'Other'] as const

// inventory_items.unit choices -- same list as the column's CHECK in the DB,
// change both together. pcs / set are counted whole; L / kg / m can be decimals.
export const ITEM_UNITS = ['pcs', 'L', 'kg', 'm', 'set'] as const
export type ItemUnit = (typeof ITEM_UNITS)[number]
export const WHOLE_UNITS: readonly string[] = ['pcs', 'set']
