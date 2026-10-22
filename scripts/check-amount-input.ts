// Self-check for src/lib/amountInput.ts -- run with:
//   node scripts/check-amount-input.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { cents, filterAmountInput, parseAmount } from '../src/lib/amountInput.ts'

// Typing filter
assert.equal(filterAmountInput('₱21,952.50'), '21952.50') // pasted with symbol + comma
assert.equal(filterAmountInput('1.2.3'), '1.23') // only the first dot counts
assert.equal(filterAmountInput('100.999'), '100.99') // max 2 decimals
assert.equal(filterAmountInput('abc'), '')
assert.equal(filterAmountInput('-50'), '50') // no minus sign
assert.equal(filterAmountInput('1234567890123456'), '123456789012') // max 12 characters
assert.equal(filterAmountInput('.5'), '.5')

// Parsing
assert.deepEqual(parseAmount(''), { value: null, error: null })
assert.deepEqual(parseAmount('21952.5'), { value: 21952.5, error: null })
assert.deepEqual(parseAmount('.5'), { value: 0.5, error: null })
assert.equal(parseAmount('0').error, 'Enter an amount greater than zero.')
assert.equal(parseAmount('0.00').error, 'Enter an amount greater than zero.')
assert.equal(parseAmount('.').error, 'Not a valid amount.')
assert.equal(parseAmount('1.2.3').error, 'Not a valid amount.') // if it ever got past the filter
assert.equal(parseAmount('100.999').error, 'Not a valid amount.')

// Float leftovers don't decide a comparison once both sides are in cents.
const remaining = 40000 - 18047.5000000001
assert.equal(cents(remaining), 21952.5)
assert.ok(cents(21952.5) <= cents(remaining))

console.log('ok')
