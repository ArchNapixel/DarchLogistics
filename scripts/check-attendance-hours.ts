// Self-check for src/lib/attendanceHours.ts -- run with:
//   node scripts/check-attendance-hours.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { minutesToTime, overtimeHours, overtimePay, timeToMinutes, workedHours } from '../src/lib/attendanceHours.ts'

const t = (hhmm: string) => timeToMinutes(hhmm)!

// 8 AM - 5 PM = 9 h span - 1 h lunch = 8 h, no overtime.
assert.equal(workedHours(t('08:00'), t('17:00')), 8)
assert.equal(overtimeHours(8), 0)
// 7 AM - 7 PM = 12 h - lunch = 11 h -> 3 h overtime.
assert.equal(workedHours(t('07:00'), t('19:00')), 11)
assert.equal(overtimeHours(11), 3)
// Half day (5 h or less): no lunch taken off.
assert.equal(workedHours(t('08:00'), t('12:00')), 4)
assert.equal(workedHours(t('08:00'), t('13:00')), 5)
assert.equal(workedHours(t('08:00'), t('13:30')), 4.5)
// Night shift past midnight: 10 PM - 7 AM = 9 h - lunch = 8 h.
assert.equal(workedHours(t('22:00'), t('07:00')), 8)
// Quarter hours.
assert.equal(workedHours(t('08:15'), t('17:45')), 8.5)
assert.equal(overtimeHours(8.5), 0.5)
// No hours recorded = no overtime.
assert.equal(overtimeHours(null), 0)
// Overtime pay: daily rate 600 -> 75/h -> x1.25 = 93.75/h.
assert.equal(overtimePay(3, 600), 281.25)
assert.equal(overtimePay(0, 600), 0)
// Weekly salary 3,600 / 6 = 600 a day, same as above.
assert.equal(overtimePay(2, 3600 / 6), 187.5)
// Time text both ways.
assert.equal(timeToMinutes('08:30:00'), 510)
assert.equal(timeToMinutes(null), null)
assert.equal(minutesToTime(510), '08:30')
assert.equal(minutesToTime(0), '00:00')

console.log('ok')
