// attendanceHours: the time in / time out rules for staff on attendance pay
// (the canvas's Attendance board). Pure functions -- the attendance sheet
// shows these numbers and payroll (lib/payslip.ts) pays with them, so both
// always agree. Self-check: node scripts/check-attendance-hours.ts
//
//   hours worked = time out − time in − 1 hour lunch (no lunch taken off a
//                  short day of 5 hours or less)
//   overtime     = hours worked above 8
//   overtime pay = overtime hours × (daily rate ÷ 8) × 1.25
//
// A time out earlier than the time in is read as past midnight (a night
// shift). Times are minutes after midnight (TimeInput12's unit); the
// database stores them as "HH:MM:SS" in employee_attendance.time_in / time_out.

export const REGULAR_HOURS = 8
export const LUNCH_MINUTES = 60
// A day this long or shorter gets no lunch taken off.
export const SHORT_DAY_MINUTES = 5 * 60
export const OVERTIME_RATE = 1.25

const round2 = (n: number) => Math.round(n * 100) / 100

// Hours actually worked between time in and time out (minutes after midnight).
export function workedHours(timeIn: number, timeOut: number): number {
  let span = timeOut - timeIn
  if (span <= 0) span += 24 * 60 // went past midnight
  const minutes = span > SHORT_DAY_MINUTES ? span - LUNCH_MINUTES : span
  return round2(minutes / 60)
}

// Overtime hours in a day of `hours` worked.
export function overtimeHours(hours: number | null): number {
  return hours == null ? 0 : round2(Math.max(0, hours - REGULAR_HOURS))
}

// What `otHours` of overtime pays for someone earning `dayRate` a day.
export function overtimePay(otHours: number, dayRate: number): number {
  return round2(otHours * (dayRate / REGULAR_HOURS) * OVERTIME_RATE)
}

// "08:30:00" / "08:30" -> 510 minutes; null stays null.
export function timeToMinutes(time: string | null): number | null {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}

// 510 -> "08:30" (what a Postgres time column takes).
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
