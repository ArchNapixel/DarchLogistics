// Self-check for src/lib/inventoryReportTotals.ts -- run with:
//   node scripts/check-inventory-report.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { buildItemWeeks, weekAddsUp, type ReportMove } from '../src/lib/inventoryReportTotals.ts'

// Item 1: 10 on hand at the start of the week (Sun 2026-11-08).
// During the week: +20 received @400, 3 used @350 then 1 returned, 2
// damaged @350, stocktake -1. After the week (next Monday): 4 used.
// Item 2: no movement at all, 5 on hand.
const END = '2026-11-15T00:00:00+08:00'
const moves: ReportMove[] = [
  { item_id: 1, reason: 'receive', qty_change: 20, unit_cost: 400, created_at: '2026-11-09T09:00:00+08:00' },
  { item_id: 1, reason: 'use', qty_change: -3, unit_cost: 350, created_at: '2026-11-10T09:00:00+08:00' },
  { item_id: 1, reason: 'return', qty_change: 1, unit_cost: 350, created_at: '2026-11-10T10:00:00+08:00' },
  { item_id: 1, reason: 'write_off', qty_change: -2, unit_cost: 350, created_at: '2026-11-11T09:00:00+08:00' },
  { item_id: 1, reason: 'count', qty_change: -1, unit_cost: 350, created_at: '2026-11-14T23:59:00+08:00' },
  { item_id: 1, reason: 'use', qty_change: -4, unit_cost: 350, created_at: '2026-11-16T09:00:00+08:00' }, // after the week
]
// Today: 10 + 20 - 3 + 1 - 2 - 1 - 4 = 21
const weeks = buildItemWeeks(new Map([[1, 21], [2, 5]]), moves, END)

const a = weeks.get(1)!
assert.equal(a.opening, 10)
assert.equal(a.in, 20)
assert.equal(a.used, 3)
assert.equal(a.returned, 1)
assert.equal(a.written_off, 2)
assert.equal(a.adjusted, -1)
assert.equal(a.closing, 25) // 10 + 20 - 3 + 1 - 2 - 1
assert.equal(a.used_value, 700) // 3 x 350 used, 1 x 350 returned
assert.equal(a.written_off_value, 700)
assert.ok(weekAddsUp(a))

const b = weeks.get(2)!
assert.equal(b.opening, 5)
assert.equal(b.closing, 5)
assert.ok(weekAddsUp(b))

// Decimal units don't leave float leftovers (0.1 + 0.2)
const c = buildItemWeeks(
  new Map([[3, 0.3]]),
  [
    { item_id: 3, reason: 'receive', qty_change: 0.1, unit_cost: 100, created_at: '2026-11-09T09:00:00+08:00' },
    { item_id: 3, reason: 'receive', qty_change: 0.2, unit_cost: 100, created_at: '2026-11-09T10:00:00+08:00' },
  ],
  END,
).get(3)!
assert.equal(c.in, 0.3)
assert.equal(c.opening, 0)
assert.ok(weekAddsUp(c))

console.log('ok')
