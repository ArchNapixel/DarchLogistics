// Self-check for src/lib/csv.ts -- run with:
//   node scripts/check-csv.ts
// Prints "ok" or throws on the first wrong cell.
import assert from 'node:assert/strict'
import { csvField } from '../src/lib/csv.ts'

assert.equal(csvField('Juan'), 'Juan')
assert.equal(csvField('Dela Cruz, Juan'), '"Dela Cruz, Juan"')
assert.equal(csvField('5" pipe'), '"5"" pipe"')
assert.equal(csvField('line\nbreak'), '"line\nbreak"')
// Numbers stay numbers.
assert.equal(csvField(-500), '-500')
assert.equal(csvField(1234.5), '1234.5')
assert.equal(csvField('-500.25'), '-500.25')
// Formula-looking text is made plain text.
assert.equal(csvField('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`)
assert.equal(csvField('+639171234567'), "'+639171234567")
assert.equal(csvField('-1+2'), "'-1+2")
assert.equal(csvField('@SUM(A1)'), "'@SUM(A1)")
assert.equal(csvField('\tcmd'), "'\tcmd")
assert.equal(csvField('Trip #12 - done'), 'Trip #12 - done') // a dash inside is fine

console.log('ok')
