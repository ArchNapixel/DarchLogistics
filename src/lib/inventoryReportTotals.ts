// inventoryReportTotals: the weekly Inventory Report's math, from the stock
// history (inventory_movements). Pure -- no imports -- so the self-check
// runs in plain Node:  node scripts/check-inventory-report.ts
//
// Per item, for one week:
//   opening + in - used + returned + adjusted - written off = closing
// where
//   in          = 'receive' + 'opening' rows (deliveries and starting stock)
//   used        = 'use' rows (parts taken out on work orders), as a positive number
//   returned    = 'return' rows (parts put back from a job)
//   adjusted    = 'adjust' + 'count' rows, signed (corrections, Found, stocktakes)
//   written off = 'write_off' rows (Damaged / Lost, cancelled-job parts kept as used), positive
// Opening is worked out BACKWARDS from today's stock: today's quantity
// minus every movement since the week started. That only needs the history
// from the week onwards, not all of it.

export type ReportMove = {
  item_id: number
  reason: string
  qty_change: number
  unit_cost: number | null
  // ISO timestamp
  created_at: string
}

export type ItemWeek = {
  item_id: number
  opening: number
  in: number
  used: number
  returned: number
  adjusted: number
  written_off: number
  closing: number
  // money: what the parts used / written off cost (their batch prices)
  used_value: number
  written_off_value: number
}

// `|| 0` turns -0 (from a tiny float leftover) into 0, so a CSV never says "-0".
const round2 = (n: number) => Math.round(n * 100) / 100 || 0

// `currentQty`: item_id -> quantity right now.
// `sinceStart`: every movement from the week's start until now.
// `weekEndExclusive`: ISO timestamp where the week ends (movements at or
// after it are after the week).
export function buildItemWeeks(
  currentQty: Map<number, number>,
  sinceStart: ReportMove[],
  weekEndExclusive: string,
): Map<number, ItemWeek> {
  const endMs = new Date(weekEndExclusive).getTime()
  const weeks = new Map<number, ItemWeek>()
  const row = (itemId: number): ItemWeek => {
    let w = weeks.get(itemId)
    if (!w) {
      w = { item_id: itemId, opening: 0, in: 0, used: 0, returned: 0, adjusted: 0, written_off: 0, closing: 0, used_value: 0, written_off_value: 0 }
      weeks.set(itemId, w)
    }
    return w
  }

  // Everything since the start, per item (to walk back to the opening).
  const sinceByItem = new Map<number, number>()
  const afterByItem = new Map<number, number>()
  for (const m of sinceStart) {
    sinceByItem.set(m.item_id, (sinceByItem.get(m.item_id) ?? 0) + m.qty_change)
    if (new Date(m.created_at).getTime() >= endMs) {
      afterByItem.set(m.item_id, (afterByItem.get(m.item_id) ?? 0) + m.qty_change)
      continue
    }
    const w = row(m.item_id)
    const cost = m.unit_cost ?? 0
    switch (m.reason) {
      case 'receive':
      case 'opening':
        w.in += m.qty_change
        break
      case 'use':
        w.used += -m.qty_change
        w.used_value += -m.qty_change * cost
        break
      case 'return':
        w.returned += m.qty_change
        w.used_value -= m.qty_change * cost // a return undoes a use
        break
      case 'write_off':
        w.written_off += -m.qty_change
        w.written_off_value += -m.qty_change * cost
        break
      default: // 'adjust', 'count'
        w.adjusted += m.qty_change
    }
  }

  for (const [itemId, qty] of currentQty) {
    const w = row(itemId)
    w.opening = qty - (sinceByItem.get(itemId) ?? 0)
    w.closing = qty - (afterByItem.get(itemId) ?? 0)
  }
  for (const w of weeks.values()) {
    for (const k of ['opening', 'in', 'used', 'returned', 'adjusted', 'written_off', 'closing', 'used_value', 'written_off_value'] as const) {
      w[k] = round2(w[k])
    }
  }
  return weeks
}

// True when the row adds up (it always should -- the self-check proves it,
// and a row that doesn't means the history and the stock count disagree).
export function weekAddsUp(w: ItemWeek): boolean {
  return round2(w.opening + w.in - w.used + w.returned + w.adjusted - w.written_off) === w.closing
}
