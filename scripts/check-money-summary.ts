// Self-check for src/lib/moneySummary.ts -- run with:
//   node scripts/check-money-summary.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { billedVsCollected, buildCashFlow, buildMoneySummary, monthLabel, pctChange, remittanceStatus, shiftMonth } from '../src/lib/moneySummary.ts'

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
  { key: 'name:Jomar', label: 'Jomar', amount: 90000 },
  { key: 'name:arch', label: 'arch', amount: 30000 },
])

// Two different clients with the same name stay apart (grouped by client id).
assert.deepEqual(
  buildMoneySummary({
    earned: 3000,
    revenueRows: [
      { client_id: 1, client_name: 'ABC', amount: 1000 },
      { client_id: 2, client_name: 'ABC', amount: 2000 },
      { client_id: 1, client_name: 'ABC', amount: 500 },
    ],
    collected: 0, tripCount: 3, salaries: 0, diesel: 0, tripExpenses: 0, repairs: 0, damage: 0,
  }).revenueByClient,
  [
    { key: 'id:2', label: 'ABC', amount: 2000 },
    { key: 'id:1', label: 'ABC', amount: 1500 },
  ],
)

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

// Money in / Money out: totals and net, float drift rounded away.
const flow = buildCashFlow({
  clientPayments: 50000.1,
  repayments: 500,
  refunds: 1000,
  salariesPaid: 20000.2,
  remittances: 3000,
  advancesGiven: 3200,
  dieselEstimated: 4000,
  tripExpenses: 1500,
  stockBought: 2000,
  companyDamage: 800,
})
assert.equal(flow.totalIn, 50500.1)
assert.equal(flow.totalOut, 35500.2)
assert.equal(flow.net, 14999.9)
assert.equal(flow.moneyIn.length, 2)
assert.equal(flow.moneyOut.length, 8) // zero lines stay (the box always shows every kind)
assert.equal(
  buildCashFlow({ clientPayments: 0, repayments: 0, refunds: 0, salariesPaid: 0, remittances: 0, advancesGiven: 0, dieselEstimated: 0, tripExpenses: 0, stockBought: 0, companyDamage: 0 }).net,
  0,
)

// Compare to last month.
assert.equal(pctChange(110, 100), 10)
assert.equal(pctChange(50, -100), 150) // a loss shrinking is an improvement
assert.equal(pctChange(5, 0), null)


// Remittances: due vs paid per agency.
const rem = remittanceStatus(
  { SSS: 1000, PhilHealth: 500, 'Pag-IBIG': 200, BIR: 0 },
  { SSS: 1000, PhilHealth: 200, 'Pag-IBIG': 0, BIR: 0 },
)
assert.deepEqual(
  rem.map((r) => [r.agency, r.left, r.state]),
  [
    ['SSS', 0, 'remitted'],
    ['PhilHealth', 300, 'partly'],
    ['Pag-IBIG', 200, 'not yet'],
    ['BIR', 0, 'none'],
  ],
)

// Billed vs collected per client; a client who only paid still shows.
assert.deepEqual(
  billedVsCollected(
    [{ key: 'id:7', label: 'ABC', amount: 1000 }],
    [
      { client_id: 7, client_name: 'ABC', amount: 300 },
      { client_id: 8, client_name: 'XYZ', amount: 200 },
      { client_id: 7, client_name: 'ABC', amount: 100.1 },
    ],
  ),
  [
    { label: 'ABC', billed: 1000, collected: 400.1 },
    { label: 'XYZ', billed: 0, collected: 200 },
  ],
)

console.log('ok')
