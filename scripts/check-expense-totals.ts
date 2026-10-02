// Self-check for src/lib/expenseTotals.ts -- run with:
//   node scripts/check-expense-totals.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { payslipCost, rangeStartManila, summarizeParts } from '../src/lib/expenseTotals.ts'

// Gross + employer shares; null contribution columns count as 0.
assert.deepEqual(
  payslipCost({ gross_pay: 5_000, sss_er: 500, sss_ec: 10, philhealth_er: '125', pagibig_er: 100 }),
  { gross: 5_000, employerShares: 735, total: 5_735 },
)
assert.equal(
  payslipCost({ gross_pay: 1_000, sss_er: null, sss_ec: null, philhealth_er: null, pagibig_er: null })
    .total,
  1_000,
)

// Month subtraction clamps the day (noon Manila on 2026-03-31 = 04:00Z).
assert.equal(rangeStartManila({ months: 1 }, new Date('2026-03-31T04:00:00Z')), '2026-02-28')
assert.equal(rangeStartManila({ months: 3 }, new Date('2026-10-02T04:00:00Z')), '2026-07-02')
assert.equal(rangeStartManila({ months: 12 }, new Date('2026-10-02T04:00:00Z')), '2025-10-02')
assert.equal(rangeStartManila({ months: 6 }, new Date('2026-03-15T04:00:00Z')), '2025-09-15')

// Day periods include today: 7 days = today + 6 before; crosses month/year ends.
assert.equal(rangeStartManila({ days: 7 }, new Date('2026-10-02T04:00:00Z')), '2026-09-26')
assert.equal(rangeStartManila({ days: 14 }, new Date('2026-10-02T04:00:00Z')), '2026-09-19')
assert.equal(rangeStartManila({ days: 7 }, new Date('2026-01-03T04:00:00Z')), '2025-12-28')
// 11pm UTC on Oct 1 is already Oct 2 in Manila.
assert.equal(rangeStartManila({ days: 7 }, new Date('2026-10-01T23:00:00Z')), '2026-09-26')

// Parts: grouped by type, unpriced parts flagged and counted as 0.
const parts = summarizeParts([
  { item_name: 'Oil filter', item_type: 'Parts', quantity: 2, unit_cost: 300 },
  { item_name: 'Oil filter', item_type: 'Parts', quantity: 1, unit_cost: 300 },
  { item_name: 'Wrench', item_type: 'Tools', quantity: 1, unit_cost: 1_000 },
  { item_name: 'Rags', item_type: 'Supplies', quantity: 5, unit_cost: null },
])
assert.equal(parts.total, 1_900)
assert.equal(parts.unpricedLines, 1)
assert.deepEqual(parts.byType, [
  { type: 'Tools', cost: 1_000 },
  { type: 'Parts', cost: 900 },
  { type: 'Supplies', cost: 0 },
])
assert.deepEqual(parts.topItems[1], { name: 'Oil filter', type: 'Parts', quantity: 3, cost: 900 })

console.log('ok')
