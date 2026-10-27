// QA tests for quotes -> bookings (Operations), adversarial review 2026-10-26.
// Run with:
//   node --import ./scripts/qa/stub-supabase.mjs scripts/qa-quotes-bookings.ts
// (the hook only stubs Supabase so lib files load outside the browser).
// Each test states the behaviour we WANT; they are expected to FAIL against
// the current code -- each is a confirmed bug. Exits 1 if any fail.
import assert from 'node:assert/strict'
import { downpaymentFor, downpaymentStatus } from '../src/lib/downpayment.ts'
import { rateForCostShare } from '../src/lib/quotePricing.ts'
import {
  emptyCargoLine,
  emptyLocationValue,
  validateShipment,
  type ShipmentForm,
} from '../src/lib/quoteRequest.ts'

const results: { name: string; error: unknown }[] = []
function test(name: string, fn: () => void) {
  try {
    fn()
    results.push({ name, error: null })
  } catch (error) {
    results.push({ name, error })
  }
}

// A quote that passes every check except whatever a test changes.
function validQuote(overrides: Partial<ShipmentForm> = {}): ShipmentForm {
  return {
    pickup: { ...emptyLocationValue, city: 'Davao City', barangay: 'Sasa', detail: 'Wharf gate 2' },
    delivery: { ...emptyLocationValue, city: 'Panabo City', barangay: 'J.P. Laurel', detail: 'Warehouse 5' },
    cargoLines: [{ ...emptyCargoLine, trailerType: 'Skeletal', weight: '20', descriptions: ['Rice'], quantity: '1' }],
    preferredPickupDate: '2099-01-10',
    paymentTerms: 'Cash',
    isLastDayOfPortStorage: 'No',
    preferredDeliveryDate: '2099-01-12',
    ...overrides,
  }
}

// 1. Staff may offer a rate below the trip cost (the profit panel only warns).
//    The downpayment is cost + 25% of (contract - cost), with the remainder
//    floored at 0 (downpayment.ts:26-28), so it becomes the FULL COST --
//    more than the whole contract. Payments are capped at contract - paid,
//    so it can never be met: no trip can leave Awaiting unless Admin waives.
test('downpayment never exceeds the contract value (rate below cost)', () => {
  const rate = 1000
  const costPerTrip = 1500
  const trips = 2
  const required = downpaymentFor(rate, costPerTrip, trips)!
  assert.ok(required <= rate * trips, `downpayment ₱${required} > contract ₱${rate * trips}`)
})

test('a client who paid the whole contract has met the downpayment', () => {
  const status = downpaymentStatus({ contract: 2000, costPerTrip: 1500, trips: 2, amountPaid: 2000, waivedAt: null })!
  assert.equal(status.met, true, `paid ₱2000 of a ₱2000 contract, still ₱${status.missing} "to go"`)
})

// 2. "Same as pickup. Add a landmark or pin." (quoteRequest.ts:226) -- but
//    sameSpot() compares the ADDRESS field (detail), never the landmark
//    (quoteRequest.ts:119-133). Following the message doesn't clear it.
test('adding a landmark (as the error says) makes two spots in one barangay different', () => {
  const errors = validateShipment(
    validQuote({
      pickup: { ...emptyLocationValue, city: 'Davao City', barangay: 'Sasa', landmark: 'Beside Shell' },
      delivery: { ...emptyLocationValue, city: 'Davao City', barangay: 'Sasa', landmark: 'Blue gate, Warehouse 9' },
    }),
  )
  assert.equal(errors.delivery, undefined, `still blocked: "${errors.delivery}"`)
})

// 3. "Date is in the past" uses the DEVICE's timezone (todayDateString,
//    quoteRequest.ts:115-117) while everything else (offers, capacity,
//    bookings) uses Manila time. 8:30 AM Oct 26 in Manila on a laptop set to
//    US Eastern: the form still thinks it's Oct 25 and accepts Oct 25 --
//    yesterday in Manila -- as the pickup date.
test('pickup date "in the past" is judged in Manila time, not the device timezone', () => {
  process.env.TZ = 'America/New_York'
  const RealDate = Date
  const fixed = RealDate.parse('2026-10-26T00:30:00Z') // 8:30 AM Manila, Oct 26
  class FakeDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length === 0) super(fixed)
      else super(...(args as ConstructorParameters<typeof Date>))
    }
    static now() {
      return fixed
    }
  }
  globalThis.Date = FakeDate as DateConstructor
  try {
    const errors = validateShipment(validQuote({ preferredPickupDate: '2026-10-25', preferredDeliveryDate: '2026-10-27' }))
    assert.equal(errors.preferredPickupDate, 'Date is in the past.', 'Oct 25 accepted as a pickup date on Oct 26 (Manila)')
  } finally {
    globalThis.Date = RealDate
    delete process.env.TZ
  }
})

// 4. The pricing guide's "rate at the 50% line" is ₱1 too high when the
//    exact answer is a whole peso: floating-point (0.5 - 0.15 =
//    0.35000000000000003) pushes Math.ceil up (quotePricing.ts:17-19).
//    "Use ₱X as the rate" then fills in an overpriced offer.
test('rate at the 50% cost line is exact when it is a whole peso', () => {
  // diesel ₱70/L x 5 km = ₱350, no fee, 15% commission: 350 / 0.35 = ₱1,000
  const rate = rateForCostShare({ dieselPricePerLiter: 70, driverCommissionRate: 15, driverPerTripFee: 0 }, 5, 0.5)
  assert.equal(rate, 1000)
})

for (const r of results) {
  console.log(`${r.error ? 'FAIL' : 'pass'}  ${r.name}`)
  if (r.error) console.log(`      ${r.error instanceof Error ? r.error.message.split('\n')[0] : String(r.error)}`)
}
const failed = results.filter((r) => r.error).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
if (failed) process.exit(1)
