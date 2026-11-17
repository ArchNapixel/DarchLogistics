// Self-check for src/lib/search.ts -- run with: node scripts/check-search.ts
import assert from 'node:assert/strict'
import { idMatches, noMatchText, numberQuery, searchText, textMatches } from '../src/lib/search.ts'

assert.equal(searchText('  ABC   1234 '), 'abc 1234')
assert.equal(searchText(null), '')
assert.equal(numberQuery('48'), 48)
assert.equal(numberQuery(' #48 '), 48)
assert.equal(numberQuery('# 48'), 48)
assert.equal(numberQuery('48a'), null)
assert.equal(numberQuery(''), null)
assert.ok(textMatches('abc  1234', 'ABC 1234'))
assert.ok(textMatches('jua', null, 'Juan Dela Cruz'))
assert.ok(!textMatches('pedro', 'Juan'))
assert.ok(textMatches('   ', 'anything'))
assert.ok(idMatches('#4', 14, 4))
assert.ok(!idMatches('4', 14, 41, 140))
assert.ok(!idMatches('abc', 4))
assert.equal(noMatchText('employee', ' juan '), 'No employee matches "juan"')
assert.equal(noMatchText('employee', 'juan', true), 'No employee matches "juan" with these filters')
assert.equal(noMatchText('item', '', true), 'No item matches these filters')
console.log('ok')
