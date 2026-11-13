// Self-check for src/lib/pms.ts -- run with:
//   node scripts/check-pms.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { byPmsUrgency, pmsStatus } from '../src/lib/pms.ts'

const s = { intervalKm: 1000, dueSoonKm: 200 }

assert.equal(pmsStatus(5000, null, s), null) // "Last PMS at" not set
assert.equal(pmsStatus(null, 4000, s), null)
assert.equal(pmsStatus(5000, 4000, { intervalKm: 0, dueSoonKm: 0 }), null)

assert.deepEqual(pmsStatus(4300, 4000, s), { nextAt: 5000, used: 300, left: 700, pct: 30, stage: 'ok' })
assert.equal(pmsStatus(4799.99, 4000, s)!.stage, 'ok') // 200.01 left
assert.equal(pmsStatus(4800, 4000, s)!.stage, 'soon') // exactly 200 left
assert.equal(pmsStatus(4999.5, 4000, s)!.stage, 'soon')
assert.equal(pmsStatus(5000, 4000, s)!.stage, 'due') // reached
const over = pmsStatus(5120, 4000, s)!
assert.equal(over.stage, 'due')
assert.equal(over.left, -120) // over by 120 km
assert.equal(over.pct, 100) // bar never past full
assert.equal(pmsStatus(3900, 4000, s)!.pct, 0) // reading below last PMS: empty bar, not negative

// The KAM 3357 case from testing: 543,252 with last PMS 542,310
const kam = pmsStatus(543252, 542310, s)!
assert.equal(kam.nextAt, 543310)
assert.equal(kam.left, 58)
assert.equal(kam.stage, 'soon')

// Sorting: nearest first, not-set last
const list = [pmsStatus(4100, 4000, s), null, over, kam]
assert.deepEqual(
  [...list].sort(byPmsUrgency).map((x) => x?.left ?? null),
  [-120, 58, 900, null],
)

console.log('ok')
