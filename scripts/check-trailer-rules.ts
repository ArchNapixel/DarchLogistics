// Self-check for src/lib/trailerRules.ts -- run with:
//   node scripts/check-trailer-rules.ts
import assert from 'node:assert/strict'
import { substituteNote, trailerAllowed, trailerRank } from '../src/lib/trailerRules.ts'

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

console.log('ok')
