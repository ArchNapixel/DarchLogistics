// Self-check for src/lib/trailerRules.ts -- run with:
//   node scripts/check-trailer-rules.ts
import assert from 'node:assert/strict'
import { sizeAllowed, substituteNote, trailerAllowed, trailerRank } from '../src/lib/trailerRules.ts'

// Container: either type, whichever was asked.
assert.equal(trailerAllowed('Container', 'Flatbed', 'Skeletal'), true)
assert.equal(trailerAllowed('Container', 'Skeletal', 'Flatbed'), true)
assert.equal(trailerAllowed('Container', 'Flatbed', 'Flatbed'), true)
// Loose cargo: Flatbed only.
assert.equal(trailerAllowed('Loose', 'Flatbed', 'Skeletal'), false)
assert.equal(trailerAllowed('Loose', 'Flatbed', 'Flatbed'), true)
// Lowbed isn't part of it.
assert.equal(trailerAllowed('Container', 'Flatbed', 'Lowbed'), false)
// No requirement known -> anything.
assert.equal(trailerAllowed('Container', null, 'Skeletal'), true)

assert.ok(trailerRank('Container', 'Skeletal') < trailerRank('Container', 'Flatbed'))
assert.equal(trailerRank('Loose', 'Flatbed'), trailerRank('Loose', 'Skeletal'))

assert.equal(substituteNote('Flatbed', 'Skeletal'), 'Skeletal instead of the Flatbed asked for')
assert.equal(substituteNote('Flatbed', 'Flatbed'), null)

// Size: a 40ft trailer may take a 20ft trip, never the other way round.
assert.equal(sizeAllowed('20ft', '20ft'), true)
assert.equal(sizeAllowed('20ft', '40ft'), true)
assert.equal(sizeAllowed('40ft', '20ft'), false)
assert.equal(sizeAllowed('40ft', null), true) // trailer's size not set yet
assert.equal(sizeAllowed(null, '20ft'), true) // old trip, no size asked
assert.equal(trailerAllowed('Container', 'Skeletal', 'Skeletal', '40ft', '20ft'), false)
assert.equal(trailerAllowed('Container', 'Flatbed', 'Skeletal', '20ft', '40ft'), true)
assert.equal(trailerAllowed('Loose', 'Flatbed', 'Skeletal', '20ft', '20ft'), false) // type still checked
// The asked size first, then Skeletal before Flatbed for containers.
const order = [
  ['Flatbed', '40ft'],
  ['Skeletal', '40ft'],
  ['Flatbed', '20ft'],
  ['Skeletal', '20ft'],
].sort((a, b) => trailerRank('Container', a[0], '20ft', a[1]) - trailerRank('Container', b[0], '20ft', b[1]))
assert.deepEqual(order, [['Skeletal', '20ft'], ['Flatbed', '20ft'], ['Skeletal', '40ft'], ['Flatbed', '40ft']])
assert.equal(substituteNote('Flatbed', 'Flatbed', '20ft', '40ft'), '40ft Flatbed instead of the 20ft Flatbed asked for')
assert.equal(substituteNote('Flatbed', 'Skeletal', '20ft', '20ft'), 'Skeletal instead of the Flatbed asked for')

console.log('ok')
