// Self-check for src/lib/inventoryItemTypes.ts -- run with:
//   node scripts/check-inventory-rules.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { adjustError, filterQuantity, needsReorder, stockLevel } from '../src/lib/inventoryItemTypes.ts'

// Stock level + reorder alerts
assert.equal(stockLevel(0, null), 'out')
assert.equal(stockLevel(0, 5), 'out')
assert.equal(stockLevel(5, 5), 'low') // AT the reorder level = time to reorder
assert.equal(stockLevel(6, 5), 'ok')
assert.equal(stockLevel(3, null), 'ok') // no reorder level = never "low"
assert.equal(needsReorder(0, null), false) // not kept in stock -> no alert
assert.equal(needsReorder(0, 5), true)
assert.equal(needsReorder(4, 5), true)
assert.equal(needsReorder(9, 5), false)

// Quantity typing filter
assert.equal(filterQuantity('12a', 'pcs'), '12')
assert.equal(filterQuantity('2.5', 'pcs'), '25') // pcs: no dot at all
assert.equal(filterQuantity('2.555', 'L'), '2.55') // max 2 decimals
assert.equal(filterQuantity('1.2.3', 'kg'), '1.23') // only the first dot counts
assert.equal(filterQuantity('-3', 'm'), '3')

// Adjust Stock rules (current stock 10 pcs; amounts are how many to remove / add)
assert.equal(adjustError(10, 'remove', '', 'Lost', '', 'pcs'), 'Enter how many to remove.')
assert.equal(adjustError(10, 'add', '', 'Found', '', 'pcs'), 'Enter how many to add.')
assert.equal(adjustError(10, 'remove', '0', 'Lost', '', 'pcs'), 'Enter a quantity more than 0.')
assert.equal(adjustError(10, 'remove', '2.5', 'Lost', '', 'pcs'), 'Quantity in pcs must be a whole number.')
assert.equal(adjustError(10, 'remove', '2.5', 'Lost', '', 'L'), null) // litres may be decimal
assert.equal(adjustError(10, 'remove', '11', 'Damaged', '', 'pcs'), 'Only 10 pcs on hand.')
assert.equal(adjustError(10, 'remove', '10', 'Count correction', '', 'pcs'), null) // down to zero is fine
assert.equal(adjustError(10, 'add', '50', 'Found', '', 'pcs'), null) // adding has no upper limit
assert.equal(adjustError(10, 'remove', '2', '', '', 'pcs'), 'Pick a reason.')
assert.equal(adjustError(10, 'remove', '2', 'Found', '', 'pcs'), `"Found" can't be used to remove stock.`)
assert.equal(adjustError(10, 'add', '2', 'Damaged', '', 'pcs'), `"Damaged" can't be used to add stock.`)
assert.equal(adjustError(10, 'remove', '2', 'Other', '  ', 'pcs'), 'Explain the adjustment.')
assert.equal(adjustError(10, 'add', '2', 'Other', 'returned by supplier', 'pcs'), null)

console.log('ok')
