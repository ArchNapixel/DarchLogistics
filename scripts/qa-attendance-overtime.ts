// QA tests for time in / time out + overtime (adversarial review, 2026-10-26).
// Run with:
//   node scripts/qa-attendance-overtime.ts
// Each test states the behaviour we WANT. They are expected to FAIL against
// the current code -- each one is a confirmed bug in src/lib/attendanceHours.ts
// (or in how lib/payslip.ts uses it). Prints every result, exits 1 if any fail.
import assert from 'node:assert/strict'
import { OVERTIME_RATE, REGULAR_HOURS, overtimeHours, overtimePay, timeToMinutes, workedHours } from '../src/lib/attendanceHours.ts'

const t = (hhmm: string) => timeToMinutes(hhmm)!
const round2 = (n: number) => Math.round(n * 100) / 100

const results: { name: string; error: unknown }[] = []
function test(name: string, fn: () => void) {
  try {
    fn()
    results.push({ name, error: null })
  } catch (error) {
    results.push({ name, error })
  }
}

// 1. Time out equal to time in (e.g. admin changed Time In to 5:00 PM before
//    changing Time Out) is read as a 24-hour night shift: 23 h worked, 15 h
//    overtime. attendanceHours.ts:26 (`span <= 0` adds 24 h).
test('equal time in and time out is 0 hours, not a 24-hour shift', () => {
  assert.equal(workedHours(t('17:00'), t('17:00')), 0)
  assert.equal(overtimeHours(workedHours(t('17:00'), t('17:00'))), 0)
})

// 2. An AM/PM slip (out 5:00 AM instead of 5:00 PM) is silently taken as a
//    night shift: 21 h span - lunch = 20 h worked, 12 h overtime paid.
//    No upper limit anywhere. attendanceHours.ts:24-29.
test('a shift over 16 hours is not accepted as normal (AM/PM slip)', () => {
  const hours = workedHours(t('08:00'), t('05:00'))
  assert.ok(hours <= 16, `got ${hours} h worked (${overtimeHours(hours)} h overtime) for 8:00 AM -> 5:00 AM`)
})

// 3. Working longer must never count as fewer hours. The lunch hour is taken
//    off only above 5 h (attendanceHours.ts:27), so 5 h 00 m = 5 h but
//    5 h 05 m = 4.08 h. Hits Hourly pay directly.
test('hours worked never go down when the time out is later', () => {
  const fiveHours = workedHours(t('08:00'), t('13:00'))
  const fiveHoursFive = workedHours(t('08:00'), t('13:05'))
  assert.ok(fiveHoursFive >= fiveHours, `5h00m -> ${fiveHours} h, but 5h05m -> ${fiveHoursFive} h`)
})

// 4. The payslip's Overtime line shows a rounded hourly rate but is paid with
//    the unrounded one (payslip.ts:413 vs :427), so "3 hrs @ ₱91.15/hr" is
//    paid ₱273.44, not ₱273.45 -- the line doesn't add up when an employee
//    checks it. Weekly salary ₱3,500 (÷ 6 = ₱583.33 a day).
test('overtime line amount = shown hourly rate x hours', () => {
  const dayRate = 3500 / 6
  const hours = 3
  const shownRate = Math.round((dayRate / REGULAR_HOURS) * OVERTIME_RATE * 100) / 100
  assert.equal(overtimePay(hours, dayRate), round2(shownRate * hours))
})

for (const r of results) {
  console.log(`${r.error ? 'FAIL' : 'pass'}  ${r.name}`)
  if (r.error) console.log(`      ${r.error instanceof Error ? r.error.message.split('\n')[0] : String(r.error)}`)
}
const failed = results.filter((r) => r.error).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
if (failed) process.exit(1)
