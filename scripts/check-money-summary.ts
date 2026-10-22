// Self-check for src/lib/moneySummary.ts -- run with:
//   node scripts/check-money-summary.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { buildMoneySummary, monthLabel, shiftMonth } from '../src/lib/moneySummary.ts'

const s = buildMoneySummary({
  earned: 120000,
  revenueRows: [
    { client_name: 'Jomar', amount: 45000 },
    { client_name: 'arch', amount: 30000 },
    { client_name: 'Jomar', amount: 45000 }, // two bookings, one client
    { client_name: 'client1', amount: 0 }, // nothing this month -> left out
  ],
  collected: 95000,
  tripCount: 24,
  salaries: 45000,
  diesel: 21000,
  tripExpenses: 4500,
  repairs: 5000,
  damage: 3000,
})
assert.equal(s.spent, 78500)
assert.equal(s.left, 41500)
assert.equal(s.collected, 95000)
// Biggest first.
assert.deepEqual(s.spending.map((l) => l.label), ['Salaries', 'Diesel', 'Truck repairs', 'Trip expenses', 'Damage we paid for'])

// Revenue grouped per client, biggest first.
assert.deepEqual(s.revenueByClient, [
  { label: 'Jomar', amount: 90000 },
  { label: 'arch', amount: 30000 },
])

// A loss shows as a negative "left"; zero lines are dropped; float sums round to cents.
const loss = buildMoneySummary({
  earned: 1000.1,
  revenueRows: [],
  collected: 0,
  tripCount: 1,
  salaries: 1000.2,
  diesel: 0.1,
  tripExpenses: 0,
  repairs: 0,
  damage: 0,
})
assert.equal(loss.spent, 1000.3)
assert.equal(loss.left, -0.2)
assert.deepEqual(loss.spending.map((l) => l.label), ['Salaries', 'Diesel'])

// Nothing happened: all zeros, empty list.
const quiet = buildMoneySummary({ earned: 0, revenueRows: [], collected: 0, tripCount: 0, salaries: 0, diesel: 0, tripExpenses: 0, repairs: 0, damage: 0 })
assert.equal(quiet.left, 0)
assert.deepEqual(quiet.spending, [])
assert.deepEqual(quiet.revenueByClient, [])

// Month arrows, across year ends.
assert.equal(shiftMonth('2026-10', 1), '2026-11')
assert.equal(shiftMonth('2026-12', 1), '2027-01')
assert.equal(shiftMonth('2026-01', -1), '2025-12')
assert.equal(monthLabel('2026-10'), 'October 2026')

console.log('ok')
