// payslip: shared calculation + data access for employee payroll --
// used by the admin "Issue Payslip" flow (PayrollSection.tsx) and every
// employee's own "My Payslip" view (MyPayslipSection.tsx, shown to
// Driver/Mechanic/Helper/Dispatcher).
//
// Pay model (rewritten 2026-09-23 to read each employee's own
// rate_type/rate columns on `employees`, instead of one shared
// app_settings value per position -- see buildEmployeePayLineItems):
// - rate_type 'Commission Per Trip' (Drivers only): per trip,
//   app_settings.driver_commission_rate% of that trip's own
//   itineraries.trip_rate (per trip, not per contract; cargo lines of one
//   booking can be priced differently -- an old trip without one uses
//   bookings.rate_of_delivery_service) PLUS app_settings.driver_per_trip_fee -- both
//   company-wide, editable on the Settings page, and the same formula
//   QuoteReviewModal's profitability panel estimates with. The old
//   per-employee commission_basis / commission_per_trip columns are no
//   longer used (removed 2026-09-28). One line
//   item per trip actually delivered whose Delivered date (latest
//   dispatch_status_logs row with new_status 'Delivered') falls inside
//   the pay period -- NOT itineraries.trip_date_from,
//   since that's just the planned date and pay is for when the trip
//   actually finished. A trip counts for whoever delivered it even if
//   itinerary_crews was later reassigned to someone else (itinerary_crews
//   keeps history rows). Any itinerary_id that already appears in a
//   previously issued payslip_line_items row is skipped regardless of
//   period dates -- a trip can never be paid twice, even if periods
//   ever end up overlapping.
// - rate_type 'Daily Fixed' / 'Weekly Salary' / 'Monthly Salary' /
//   'Hourly': paid against attendance (employee_attendance,
//   Present/Leave days count) using that employee's own daily_rate /
//   weekly_salary / monthly_salary / hourly_rate -- Daily Fixed is
//   daily_rate x paid days, Weekly Salary is (weekly_salary / 6 working
//   days) x paid days (how Helpers are paid), Monthly Salary is
//   (monthly_salary / 30) x paid days, Hourly is hourly_rate x
//   hours_worked summed over the period's paid days.
//   Plus an Overtime line (since 2026-10-25) when Present days were logged
//   with time in / time out: hours above 8 a day at (day rate / 8) x 1.25
//   (Hourly: just the extra 0.25 -- every hour is already paid). Rules in
//   lib/attendanceHours.ts.
// - The admin can override any calculated line amount, or add manual
//   lines, in IssuePayslipModal before issuing -- issuePayslip() just
//   saves whatever lines it's handed.
// - Dates are Philippine local dates (Asia/Manila), not UTC -- see
//   toManilaDate().
// - No separate daily allowance line item -- removed 2026-09-23, gross
//   pay is just the rate_type-based pay above.
// - Cash advances (cash_advances table) are never auto-deducted --
//   admin sees the employee's outstanding balance when issuing a
//   payslip and chooses how much (if any) to deduct THIS time.
// - Government deductions (SSS / PhilHealth / Pag-IBIG employee shares
//   + BIR withholding tax) are computed per weekly payslip by
//   lib/governmentContributions.ts (see there for the weekly-share
//   math); employer shares are stored alongside for remittance reports
//   but never deducted. Admin can override any of them when issuing.
//   net_pay = gross_pay - cash_advance_deducted - employee shares -
//   withholding_tax.
// - Lifecycle: issued as a Draft (staff-only) -> Finalized (released to
//   the employee) -> Paid. See finalizePayslips / discardDraftPayslip.
// - Payslips are issued weekly, period ending Saturday. Issuing writes
//   the breakdown into payslip_line_items so it stays accurate forever
//   even if settings/rates change later -- a payslip is a historical
//   record, not a live calculation.
import { supabase } from './supabaseClient'
import { markAttendanceAsPaid } from './employeeAttendance'
import { OVERTIME_RATE, REGULAR_HOURS, overtimePay, summarizeUnpaidDays } from './attendanceHours'
import { fetchAll, fetchIn } from './dashboardExpenses'
import { deliveryDatesInPeriod, tripKey, tripsToPay } from './payslipPeriod'
import {
  computeWeeklyContributions,
  weeklyWithholdingTax,
  type Contributions,
  type EarlierPayslip,
} from './governmentContributions'

export type PayrollSettings = {
  driverCommissionRate: number
  driverPerTripFee: number
}

const SETTINGS_KEYS = ['driver_commission_rate', 'driver_per_trip_fee'] as const

export async function loadPayrollSettings(): Promise<{
  settings: PayrollSettings | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('setting_key, setting_value')
    .in('setting_key', SETTINGS_KEYS)

  if (error) {
    return { settings: null, error: error.message }
  }

  const valueByKey = new Map(data.map((row) => [row.setting_key, row.setting_value]))

  return {
    settings: {
      driverCommissionRate: valueByKey.get('driver_commission_rate') ?? 0,
      driverPerTripFee: valueByKey.get('driver_per_trip_fee') ?? 0,
    },
    error: null,
  }
}

// A timestamp (or Date) as a YYYY-MM-DD date in Philippine time.
// Slicing an ISO string gives the UTC date instead, which is 8 hours
// behind -- a delivery at 7am Sunday in Manila would land on Saturday
// and get paid in the wrong week.
export function toManilaDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

// The last COMPLETED Sun-Sat week (Manila time) -- the most recent
// Saturday strictly before today, and the 6 days before it. On a
// Saturday itself that's last week, since today's trips/attendance
// aren't in yet. This is the week auto-generated drafts cover. The date
// math runs on UTC midnight of that Manila date so toISOString() below
// can't shift it.
export function getDefaultPayPeriod(): { start: string; end: string } {
  const end = new Date(`${toManilaDate(new Date())}T00:00:00Z`)
  const daysSinceSaturday = (end.getUTCDay() - 6 + 7) % 7 || 7
  end.setUTCDate(end.getUTCDate() - daysSinceSaturday)
  const start = new Date(end)
  start.setUTCDate(end.getUTCDate() - 6)

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

// The Sun-Sat week containing today (Manila time) -- still in progress,
// so its drafts keep topping up and can't be finalized yet.
export function getCurrentPayPeriod(): { start: string; end: string } {
  const start = new Date(`${toManilaDate(new Date())}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

// A week is still in progress until its Saturday has passed (Manila).
export function isWeekInProgress(periodEnd: string) {
  return periodEnd >= toManilaDate(new Date())
}

export type PayslipLineItem = {
  itinerary_id: number | null
  description: string
  amount: number
}

export type RateType = 'Daily Fixed' | 'Weekly Salary' | 'Commission Per Trip' | 'Monthly Salary' | 'Hourly'

export type EmployeePayRate = {
  employee_id: number
  position: string
  rate_type: RateType
  daily_rate: number | null
  weekly_salary: number | null
  monthly_salary: number | null
  hourly_rate: number | null
}

type UnpaidDay = { attendance_status: string; hours_worked: number | null }
type PeriodTrip = {
  itinerary_id: number
  booking_id: number
  place_of_pickup_id: number
  place_of_delivery_id: number
  trip_rate: number | null
}

// Everything a generate run needs to work out pay, read ONCE for everybody
// instead of employee by employee (that was a chain of about 100 requests
// one after another on every Payroll open). Reads only -- the writes in
// generateDraftPayslipsNow still go one employee at a time.
type PeriodPayData = {
  // Present / Leave days in the period not on a payslip yet (paid_payroll_id
  // gets set once one uses them, so a day is only ever counted once).
  daysByEmployee: Map<number, UnpaidDay[]>
  // Trips whose delivery date is in the period (see deliveryDatesInPeriod).
  trips: PeriodTrip[]
  deliveryDates: Map<number, string>
  // tripKey(employee, trip) sets: the active driver, and "already on one of
  // this employee's own payslips" -- the guarantee a trip is never paid twice.
  crew: Set<string>
  alreadyPaid: Set<string>
  rateByBooking: Map<number, number | null>
  placeNameById: Map<number, string>
}

// ponytail: days are read when the run starts, so a day marked in another tab
// during a run that writes could be marked paid without being counted. A
// Postgres function (one transaction) closes that if it ever becomes real.
async function loadPeriodPayData(
  periodStart: string,
  periodEnd: string,
): Promise<{ data: PeriodPayData | null; error: string | null }> {
  // A day early so no time-zone difference can cut a trip off;
  // deliveryDatesInPeriod does the exact check on the Manila date.
  const logsFrom = new Date(new Date(periodStart).getTime() - 86_400_000).toISOString()

  const [attendance, logs] = await Promise.all([
    fetchAll<UnpaidDay & { employee_id: number }>((from, to) =>
      supabase
        .from('employee_attendance')
        .select('employee_id, attendance_status, hours_worked')
        .gte('attendance_date', periodStart)
        .lte('attendance_date', periodEnd)
        .in('attendance_status', ['Present', 'Leave'])
        .is('paid_payroll_id', null)
        .order('attendance_id')
        .range(from, to),
    ),
    // The delivery date is when the trip was marked Delivered on the Dispatch
    // Board. Oldest first, so the LATEST Delivered log per trip wins.
    fetchAll<{ itinerary_id: number; status_changed_at: string }>((from, to) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id, status_changed_at')
        .eq('new_status', 'Delivered')
        .gte('status_changed_at', logsFrom)
        .order('status_changed_at', { ascending: true })
        .range(from, to),
    ),
  ])
  if (attendance.error) return { data: null, error: attendance.error }
  if (logs.error) return { data: null, error: logs.error }

  const daysByEmployee = new Map<number, UnpaidDay[]>()
  for (const row of attendance.rows) {
    daysByEmployee.set(row.employee_id, [...(daysByEmployee.get(row.employee_id) ?? []), row])
  }

  const deliveryDates = deliveryDatesInPeriod(
    logs.rows.map((row) => ({ itinerary_id: row.itinerary_id, date: toManilaDate(row.status_changed_at) })),
    periodStart,
    periodEnd,
  )
  const tripIds = [...deliveryDates.keys()]
  if (tripIds.length === 0) {
    return {
      data: {
        daysByEmployee,
        deliveryDates,
        trips: [],
        crew: new Set(),
        alreadyPaid: new Set(),
        rateByBooking: new Map(),
        placeNameById: new Map(),
      },
      error: null,
    }
  }

  const [tripRows, crewRows, paidLines] = await Promise.all([
    // Still Delivered now -- a trip moved back since isn't paid.
    fetchIn<PeriodTrip>(tripIds, (chunk, from, to) =>
      supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, place_of_pickup_id, place_of_delivery_id, trip_rate')
        .in('itinerary_id', chunk)
        .eq('itinerary_status', 'Delivered')
        .order('itinerary_id')
        .range(from, to),
    ),
    // A driver swapped off the trip (Dispatch Board keeps their row as
    // is_active: false) didn't drive it -- only the active driver is paid.
    fetchIn<{ itinerary_id: number; employee_id: number }>(tripIds, (chunk, from, to) =>
      supabase
        .from('itinerary_crews')
        .select('itinerary_id, employee_id')
        .in('itinerary_id', chunk)
        .eq('crew_role', 'Driver')
        .eq('is_active', true)
        .order('itinerary_id')
        .order('employee_id')
        .range(from, to),
    ),
    fetchIn<{ itinerary_id: number; payroll_id: number }>(tripIds, (chunk, from, to) =>
      supabase
        .from('payslip_line_items')
        .select('itinerary_id, payroll_id')
        .in('itinerary_id', chunk)
        .order('payslip_line_item_id')
        .range(from, to),
    ),
  ])
  if (tripRows.error) return { data: null, error: tripRows.error }
  if (crewRows.error) return { data: null, error: crewRows.error }
  if (paidLines.error) return { data: null, error: paidLines.error }

  // payslip_line_items has no employee_id of its own, so "already paid" goes
  // through the payslip each line sits on.
  const payslipOwners = await fetchIn<{ payroll_id: number; employee_id: number }>(
    [...new Set(paidLines.rows.map((line) => line.payroll_id))],
    (chunk, from, to) =>
      supabase
        .from('payroll_payslips')
        .select('payroll_id, employee_id')
        .in('payroll_id', chunk)
        .order('payroll_id')
        .range(from, to),
  )
  if (payslipOwners.error) return { data: null, error: payslipOwners.error }
  const ownerByPayroll = new Map(payslipOwners.rows.map((row) => [row.payroll_id, row.employee_id]))

  const bookingIds = [...new Set(tripRows.rows.map((row) => row.booking_id))]
  const placeIds = [...new Set(tripRows.rows.flatMap((row) => [row.place_of_pickup_id, row.place_of_delivery_id]))]
  const [bookings, places] = await Promise.all([
    fetchIn<{ booking_id: number; rate_of_delivery_service: number | null }>(bookingIds, (chunk, from, to) =>
      supabase
        .from('bookings')
        .select('booking_id, rate_of_delivery_service')
        .in('booking_id', chunk)
        .order('booking_id')
        .range(from, to),
    ),
    fetchIn<{ place_id: number; place_name: string }>(placeIds, (chunk, from, to) =>
      supabase.from('places').select('place_id, place_name').in('place_id', chunk).order('place_id').range(from, to),
    ),
  ])
  if (bookings.error) return { data: null, error: bookings.error }
  if (places.error) return { data: null, error: places.error }

  return {
    data: {
      daysByEmployee,
      deliveryDates,
      trips: tripRows.rows,
      crew: new Set(crewRows.rows.map((row) => tripKey(row.employee_id, row.itinerary_id))),
      alreadyPaid: new Set(
        paidLines.rows.flatMap((line) => {
          const owner = ownerByPayroll.get(line.payroll_id)
          return owner === undefined ? [] : [tripKey(owner, line.itinerary_id)]
        }),
      ),
      rateByBooking: new Map(bookings.rows.map((row) => [row.booking_id, row.rate_of_delivery_service])),
      placeNameById: new Map(places.rows.map((row) => [row.place_id, row.place_name])),
    },
    error: null,
  }
}

// Commission Per Trip (Drivers only): one line item per trip delivered within
// the period and not on a payslip of theirs yet -- commission% of the trip's
// rate plus the flat per-trip fee, both from app_settings.
function buildCommissionTripLineItems(
  employee: EmployeePayRate,
  settings: PayrollSettings,
  data: PeriodPayData,
): { lineItems: PayslipLineItem[]; error: string | null } {
  if (employee.position !== 'Driver') {
    return {
      lineItems: [],
      error: `"Commission Per Trip" is for Drivers only (${employee.position}s are paid a salary) -- change this employee's rate type.`,
    }
  }

  const lineItems = tripsToPay(employee.employee_id, data.trips, data.crew, data.alreadyPaid).map((row) => {
    // The trip's OWN rate (cargo lines of a booking can be priced differently).
    const tripRate = Number(row.trip_rate ?? data.rateByBooking.get(row.booking_id) ?? 0)
    const amount = (settings.driverCommissionRate / 100) * tripRate + settings.driverPerTripFee
    const pickup = data.placeNameById.get(row.place_of_pickup_id) ?? '—'
    const delivery = data.placeNameById.get(row.place_of_delivery_id) ?? '—'
    const date = data.deliveryDates.get(row.itinerary_id) ?? ''

    return {
      itinerary_id: row.itinerary_id,
      description:
        `Trip #${row.itinerary_id}: ${pickup} → ${delivery} (${date}) — ` +
        `${settings.driverCommissionRate}% of ₱${tripRate.toLocaleString()} + ₱${settings.driverPerTripFee.toLocaleString()} trip fee`,
      amount,
    }
  })

  return { lineItems, error: null }
}

// Daily Fixed / Weekly Salary / Monthly Salary / Hourly: paid against attendance,
// using this employee's own rate column instead of a shared
// per-position app_settings value.
function buildAttendanceBasedLineItems(
  employee: EmployeePayRate,
  periodStart: string,
  periodEnd: string,
  data: PeriodPayData,
): { lineItems: PayslipLineItem[]; error: string | null } {
  const { days, hours, overtime } = summarizeUnpaidDays(data.daysByEmployee.get(employee.employee_id) ?? [])

  if (employee.rate_type === 'Hourly') {
    if (employee.hourly_rate == null) {
      return { lineItems: [], error: `This employee's hourly rate hasn't been set -- edit their employee record first.` }
    }
    // Every hour is already paid above; overtime hours get the extra 0.25.
    return {
      lineItems: [
        {
          itinerary_id: null,
          description: `${employee.position} hourly pay (${hours} hrs @ ₱${employee.hourly_rate}/hr)`,
          amount: employee.hourly_rate * hours,
        },
        ...(overtime > 0
          ? [
              {
                itinerary_id: null,
                description: `Overtime premium (${overtime} hrs @ ₱${employee.hourly_rate}/hr × ${OVERTIME_RATE - 1})`,
                amount: Math.round(overtime * employee.hourly_rate * (OVERTIME_RATE - 1) * 100) / 100,
              },
            ]
          : []),
      ],
      error: null,
    }
  }

  const label =
    employee.rate_type === 'Daily Fixed'
      ? 'daily rate'
      : employee.rate_type === 'Weekly Salary'
        ? 'weekly salary'
        : 'monthly salary'
  const rateAmount =
    employee.rate_type === 'Daily Fixed'
      ? employee.daily_rate
      : employee.rate_type === 'Weekly Salary'
        ? employee.weekly_salary
        : employee.monthly_salary
  if (rateAmount == null) {
    return {
      lineItems: [],
      error: `This employee's ${label} hasn't been set -- edit their employee record first.`,
    }
  }

  // Weekly (÷6 working days) and Monthly (÷30) salaries are converted
  // to a daily-equivalent and paid per attendance day, same approach as
  // Daily Fixed -- just derived from a bigger figure instead of an
  // already-daily one. The label's denominator matches whichever
  // divisor actually drives the math -- 6 / 30 regardless of period
  // length, and the selected period's own day count for Daily Fixed
  // (not a hardcoded 7 -- the period isn't always exactly a week, e.g.
  // a first payslip covering however many days since the employee was
  // hired, or an admin picking a custom range).
  const salaryDivisor = employee.rate_type === 'Weekly Salary' ? 6 : 30
  const dayRate = employee.rate_type === 'Daily Fixed' ? rateAmount : rateAmount / salaryDivisor
  const daysInPeriod =
    Math.round(
      (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86_400_000,
    ) + 1
  const denominator = employee.rate_type === 'Daily Fixed' ? daysInPeriod : salaryDivisor

  // Overtime from time in / time out (lib/attendanceHours.ts): hours above
  // 8 a day, at (day rate ÷ 8) × 1.25.
  const otHourly = Math.round((dayRate / REGULAR_HOURS) * OVERTIME_RATE * 100) / 100

  return {
    lineItems: [
      {
        itinerary_id: null,
        description: `${employee.position} ${label} (${days}/${denominator} paid attendance days)`,
        amount: dayRate * days,
      },
      ...(overtime > 0
        ? [
            {
              itinerary_id: null,
              description: `Overtime (${overtime} hrs @ ₱${otHourly}/hr)`,
              amount: overtimePay(overtime, dayRate),
            },
          ]
        : []),
    ],
    error: null,
  }
}

// Dispatches on the employee's own rate_type instead of their position.
function buildEmployeePayLineItems(
  employee: EmployeePayRate,
  periodStart: string,
  periodEnd: string,
  settings: PayrollSettings,
  data: PeriodPayData,
): { lineItems: PayslipLineItem[]; error: string | null } {
  if (employee.rate_type === 'Commission Per Trip') {
    return buildCommissionTripLineItems(employee, settings, data)
  }
  return buildAttendanceBasedLineItems(employee, periodStart, periodEnd, data)
}

// Total cash advances issued minus what's already been deducted across
// this employee's past payslips -- what's still owed back. Only counts
// 'Approved' rows -- a 'Pending' employee-requested advance hasn't
// actually been given to them yet, so it must not inflate this balance.
export async function getOutstandingCashAdvance(
  employeeId: number,
): Promise<{ outstanding: number; error: string | null }> {
  const [advancesResult, payslipsResult] = await Promise.all([
    supabase
      .from('cash_advances')
      .select('amount')
      .eq('employee_id', employeeId)
      .eq('status', 'Approved'),
    supabase
      .from('payroll_payslips')
      .select('cash_advance_deducted')
      .eq('employee_id', employeeId),
  ])

  if (advancesResult.error) {
    return { outstanding: 0, error: advancesResult.error.message }
  }
  if (payslipsResult.error) {
    return { outstanding: 0, error: payslipsResult.error.message }
  }

  const totalIssued = advancesResult.data.reduce((sum, row) => sum + row.amount, 0)
  const totalDeducted = payslipsResult.data.reduce(
    (sum, row) => sum + (row.cash_advance_deducted ?? 0),
    0,
  )

  return { outstanding: totalIssued - totalDeducted, error: null }
}

// The same balance for every employee at once, read in one go. Employees
// who never had a cash advance aren't in the map (they owe nothing).
export async function loadOutstandingCashAdvances(): Promise<{
  owedByEmployee: Map<number, number>
  error: string | null
}> {
  const [advances, payslips] = await Promise.all([
    fetchAll<{ employee_id: number; amount: number }>((from, to) =>
      supabase
        .from('cash_advances')
        .select('employee_id, amount')
        .eq('status', 'Approved')
        .order('cash_advance_id')
        .range(from, to),
    ),
    fetchAll<{ employee_id: number; cash_advance_deducted: number }>((from, to) =>
      supabase
        .from('payroll_payslips')
        .select('employee_id, cash_advance_deducted')
        .gt('cash_advance_deducted', 0)
        .order('payroll_id')
        .range(from, to),
    ),
  ])
  const owedByEmployee = new Map<number, number>()
  const error = advances.error ?? payslips.error
  if (error) return { owedByEmployee, error }

  for (const row of advances.rows) {
    owedByEmployee.set(row.employee_id, (owedByEmployee.get(row.employee_id) ?? 0) + row.amount)
  }
  for (const row of payslips.rows) {
    owedByEmployee.set(row.employee_id, (owedByEmployee.get(row.employee_id) ?? 0) - row.cash_advance_deducted)
  }
  return { owedByEmployee, error: null }
}

// Cash advances are paid back automatically: this share of each weekly
// payslip's gross pay comes off until the balance is gone. The percent
// is app_settings.cash_advance_deduction_rate (editable on the Settings
// page); 10 if that row doesn't exist yet.
export const DEFAULT_CASH_ADVANCE_DEDUCTION_RATE = 10

export async function loadCashAdvanceDeductionRate(): Promise<number> {
  const { data } = await supabase
    .from('app_settings')
    .select('setting_value')
    .eq('setting_key', 'cash_advance_deduction_rate')
    .maybeSingle()
  return data?.setting_value ?? DEFAULT_CASH_ADVANCE_DEDUCTION_RATE
}

// What to deduct on a draft: the rate % of its gross pay, rounded to
// centavos and capped by what's still owed. A ₱0-gross draft deducts ₱0.
// alreadyOnThisDraft = what this draft already deducts, which the
// outstanding balance already counts as paid.
async function autoCashAdvanceDeduction(employeeId: number, grossPay: number, alreadyOnThisDraft = 0) {
  const [{ outstanding }, rate] = await Promise.all([
    getOutstandingCashAdvance(employeeId),
    loadCashAdvanceDeductionRate(),
  ])
  const share = Math.round(grossPay * rate) / 100
  return Math.max(0, Math.min(share, outstanding + alreadyOnThisDraft))
}

const CONTRIBUTION_COLUMNS =
  'sss_msc, sss_ee, sss_er, sss_ec, philhealth_ee, philhealth_er, pagibig_ee, pagibig_er, withholding_tax'

// This employee's payslips for EARLIER weeks of the same calendar month
// as periodEnd (period ending on/after the 1st, before this one) --
// what computeWeeklyContributions needs to work out this week's share of
// the month's contributions. Strictly earlier, so editing a draft never
// counts the draft itself (or a later week) as "already deducted".
export async function loadEarlierPayslipsThisMonth(
  employeeId: number,
  periodEnd: string,
): Promise<{ payslips: EarlierPayslip[]; error: string | null }> {
  const monthStart = `${periodEnd.slice(0, 7)}-01`

  const { data, error } = await supabase
    .from('payroll_payslips')
    .select(`gross_pay, ${CONTRIBUTION_COLUMNS}`)
    .eq('employee_id', employeeId)
    .gte('payroll_period_end', monthStart)
    .lt('payroll_period_end', periodEnd)

  if (error) {
    return { payslips: [], error: error.message }
  }
  return { payslips: data, error: null }
}

export type PayslipDeductions = Contributions & {
  sss_msc: number
  withholding_tax: number
  // Which computed amounts the admin overrode, e.g. "SSS (employee):
  // auto ₱300" -- null when nothing was changed.
  deductions_note: string | null
}

// What actually comes out of the employee's pay (employer shares don't).
export function totalEmployeeDeductions(
  d: Pick<PayslipDeductions, 'sss_ee' | 'philhealth_ee' | 'pagibig_ee' | 'withholding_tax'>,
) {
  return d.sss_ee + d.philhealth_ee + d.pagibig_ee + d.withholding_tax
}

// Creates the payroll_payslips row plus its payslip_line_items rows in
// one call, as a DRAFT (finalized_at left null -- see finalizePayslips).
// A draft already counts as paying its trips/attendance days, so they
// can't be put on a second payslip while it's under review. Not wrapped in a real DB transaction (no RPC for that yet
// -- same known limitation as QuoteReviewModal's Approve flow), so if
// the line items insert fails after the payslip row succeeds, the
// caller should treat it as needing manual review rather than retrying
// (a retry would create a duplicate payslip).
export async function issuePayslip({
  employeeId,
  rateType,
  periodStart,
  periodEnd,
  lineItems,
  cashAdvanceDeducted,
  deductions,
}: {
  employeeId: number
  rateType: RateType
  periodStart: string
  periodEnd: string
  lineItems: PayslipLineItem[]
  cashAdvanceDeducted: number
  deductions: PayslipDeductions
}): Promise<{ payrollId: number | null; error: string | null }> {
  const grossPay = lineItems.reduce((sum, item) => sum + item.amount, 0)
  // No separate allowance line item anymore (removed 2026-09-23) --
  // base_pay is just gross_pay.
  const basePay = grossPay
  const netPay =
    grossPay - cashAdvanceDeducted - totalEmployeeDeductions(deductions)

  const { data: payslip, error: payslipError } = await supabase
    .from('payroll_payslips')
    .insert({
      employee_id: employeeId,
      payroll_period_start: periodStart,
      payroll_period_end: periodEnd,
      gross_pay: grossPay,
      base_pay: basePay,
      allowance_amount: 0,
      cash_advance_deducted: cashAdvanceDeducted,
      ...deductions,
      net_pay: netPay,
      payslip_status: 'Pending',
    })
    .select('payroll_id')
    .single()

  if (payslipError || !payslip) {
    return {
      payrollId: null,
      error: payslipError?.message ?? 'Could not create payslip.',
    }
  }

  // An empty draft (cash-advance-only, no pay yet) has no lines to save.
  const { error: lineItemsError } = lineItems.length === 0 ? { error: null } : await supabase.from('payslip_line_items').insert(
    lineItems.map((item) => ({
      payroll_id: payslip.payroll_id,
      itinerary_id: item.itinerary_id,
      description: item.description,
      amount: item.amount,
    })),
  )

  if (lineItemsError) {
    return {
      payrollId: payslip.payroll_id,
      error:
        `Payslip #${payslip.payroll_id} was created, but its line items ` +
        `could not be saved (${lineItemsError.message}). This needs manual review.`,
    }
  }

  // Lock in the attendance days this payslip just paid for, so a
  // future payslip run can never recount them -- the attendance
  // equivalent of trips being excluded via payslip_line_items.itinerary_id.
  // Not applicable to Commission Per Trip (no attendance involved in
  // its pay at all).
  if (rateType !== 'Commission Per Trip') {
    const { error: markError } = await markAttendanceAsPaid(
      employeeId,
      periodStart,
      periodEnd,
      payslip.payroll_id,
    )

    if (markError) {
      return {
        payrollId: payslip.payroll_id,
        error:
          `Payslip #${payslip.payroll_id} was created, but its attendance days ` +
          `could not be marked as paid (${markError}). This needs manual review -- ` +
          `those days could get counted again on a future payslip.`,
      }
    }
  }

  return { payrollId: payslip.payroll_id, error: null }
}

// Government deductions for a gross pay with no admin overrides -- what
// a freshly generated (or topped-up, un-overridden) draft gets.
async function computeAutoDeductions(
  employeeId: number,
  grossPay: number,
  periodEnd: string,
  isMinimumWageEarner: boolean,
): Promise<{ deductions: PayslipDeductions | null; error: string | null }> {
  const earlier = await loadEarlierPayslipsThisMonth(employeeId, periodEnd)
  if (earlier.error) return { deductions: null, error: earlier.error }

  const c = computeWeeklyContributions(grossPay, periodEnd, earlier.payslips)
  const employeeShares = c.sss_ee + c.philhealth_ee + c.pagibig_ee
  return {
    deductions: {
      sss_msc: c.sss_msc,
      sss_ee: c.sss_ee,
      sss_er: c.sss_er,
      sss_ec: c.sss_ec,
      philhealth_ee: c.philhealth_ee,
      philhealth_er: c.philhealth_er,
      pagibig_ee: c.pagibig_ee,
      pagibig_er: c.pagibig_er,
      withholding_tax: isMinimumWageEarner ? 0 : weeklyWithholdingTax(grossPay - employeeShares),
      deductions_note: null,
    },
    error: null,
  }
}

type DraftLine = {
  payroll_id: number
  payslip_line_item_id: number
  itinerary_id: number | null
  amount: number
}

type ExistingDraft = PayslipDeductions & {
  payroll_id: number
  employee_id: number
  finalized_at: string | null
  gross_pay: number
  cash_advance_deducted: number
}

// Auto-generation, run whenever the Payroll page opens (for last week
// and the current week), so drafts just "appear" and stay current -- no
// Issue button. For every current employee (not Deactivated/Terminated):
// - no payslip for the period yet, and something earned -> create a
//   draft (formula amounts, no cash advance -- admin adds that via Edit)
// - an existing DRAFT -> top it up with only what's NEW since it was
//   made (topUpDraft) -- a trip delivered or attendance recorded later
// - an existing FINALIZED payslip -> leave it alone
// This works because buildEmployeePayLineItems already skips trips on
// any of the employee's payslips and attendance days already marked
// paid, so for an existing draft it returns exactly the new items.
// Employees whose pay can't be computed (e.g. rate not set) come back as
// warnings instead of blocking everyone else. Two admins creating the
// same new draft at once is safe (the unique employee+period constraint
// rejects the second insert).
// ponytail: topping up is not atomic -- two admins opening Payroll in
// the same second could both add the same new trip line to a draft.
// The review-before-finalize step catches it; move topUpDraft into a
// Postgres function (one transaction) if that ever becomes real.
// Runs are queued one after another in this browser tab: React StrictMode
// (dev) fires Payroll's open-effect twice, and two overlapping runs both
// added the same trips to a draft (duplicate lines, stale gross). Queued,
// the second run sees the first one's lines and adds nothing.
// ponytail: only guards one tab -- two admins at once still need the
// Postgres-function fix above.
let generateQueue: Promise<unknown> = Promise.resolve()
export function generateDraftPayslips(
  periodStart: string,
  periodEnd: string,
  onlyEmployeeId?: number,
) {
  const run = generateQueue.then(() => generateDraftPayslipsNow(periodStart, periodEnd, onlyEmployeeId))
  generateQueue = run.catch(() => undefined)
  return run
}

async function generateDraftPayslipsNow(
  periodStart: string,
  periodEnd: string,
  // Regenerate: only this employee (their draft was just discarded).
  onlyEmployeeId?: number,
): Promise<{ createdIds: number[]; warnings: string[]; error: string | null }> {
  const [settingsResult, employeesResult, statusesResult, existingResult] = await Promise.all([
    loadPayrollSettings(),
    supabase
      .from('employees')
      .select(
        'employee_id, full_name, position, rate_type, daily_rate, weekly_salary, monthly_salary, hourly_rate, is_minimum_wage_earner, employment_status_id',
      ),
    supabase.from('employment_status').select('status_id, status_name'),
    supabase
      .from('payroll_payslips')
      .select(
        `payroll_id, employee_id, finalized_at, gross_pay, cash_advance_deducted, deductions_note, ${CONTRIBUTION_COLUMNS}`,
      )
      .eq('payroll_period_start', periodStart)
      .eq('payroll_period_end', periodEnd),
  ])

  const loadError =
    settingsResult.error ??
    employeesResult.error?.message ??
    statusesResult.error?.message ??
    existingResult.error?.message
  if (loadError || !settingsResult.settings) {
    return { createdIds: [], warnings: [], error: loadError ?? 'Could not load payroll settings.' }
  }

  const inactiveStatusIds = new Set(
    statusesResult.data!
      .filter((s) => s.status_name === 'Deactivated' || s.status_name === 'Terminated')
      .map((s) => s.status_id),
  )
  const existingByEmployee = new Map(
    (existingResult.data as unknown as ExistingDraft[]).map((row) => [row.employee_id, row]),
  )
  const toProcess = employeesResult.data!.filter(
    (e) =>
      !inactiveStatusIds.has(e.employment_status_id) &&
      !existingByEmployee.get(e.employee_id)?.finalized_at &&
      (onlyEmployeeId === undefined || e.employee_id === onlyEmployeeId),
  )

  // Reads for everybody at once; the loop below only works it out and writes.
  const draftIds = toProcess.flatMap((e) => {
    const draft = existingByEmployee.get(e.employee_id)
    return draft ? [draft.payroll_id] : []
  })
  const [payData, owed, draftLines] = await Promise.all([
    loadPeriodPayData(periodStart, periodEnd),
    loadOutstandingCashAdvances(),
    fetchIn<DraftLine>(draftIds, (chunk, from, to) =>
      supabase
        .from('payslip_line_items')
        .select('payroll_id, payslip_line_item_id, itinerary_id, amount')
        .in('payroll_id', chunk)
        .order('payslip_line_item_id', { ascending: true })
        .range(from, to),
    ),
  ])
  const readError = payData.error ?? owed.error ?? draftLines.error
  if (readError || !payData.data) {
    return { createdIds: [], warnings: [], error: readError ?? 'Could not load the payroll data.' }
  }

  const createdIds: number[] = []
  const warnings: string[] = []

  // One at a time: each employee's earlier-this-month payslips must be
  // read after anything just created for them.
  for (const employee of toProcess) {
    // Self-heal an existing draft first (duplicate trip lines / gross that
    // doesn't match its lines), so the top-up below adds to a correct total.
    const existing = existingByEmployee.get(employee.employee_id)
    if (existing) {
      const lines = draftLines.rows.filter((line) => line.payroll_id === existing.payroll_id)
      const healed = await healDraft(existing, lines, employee, periodEnd)
      if (healed.error) warnings.push(`${employee.full_name}: ${healed.error}`)
      else if (healed.gross !== null) existing.gross_pay = healed.gross
    }

    const pay = buildEmployeePayLineItems(employee, periodStart, periodEnd, settingsResult.settings, payData.data)
    if (pay.error) {
      warnings.push(`${employee.full_name}: ${pay.error}`)
      continue
    }
    // Nothing (new) earned -- salary types still return a ₱0 line when
    // no attendance was recorded, so check the total, not the count.
    const grossAdded = pay.lineItems.reduce((sum, item) => sum + item.amount, 0)
    if (grossAdded <= 0) {
      // Nothing earned -- skip, unless the employee still owes a cash
      // advance: then make an empty draft so admin can deduct it via Edit.
      if (existingByEmployee.has(employee.employee_id)) continue
      if ((owed.owedByEmployee.get(employee.employee_id) ?? 0) <= 0) continue
    }

    const draft = existingByEmployee.get(employee.employee_id)
    if (draft) {
      const { error } = await topUpDraft(draft, employee, pay.lineItems, grossAdded, periodStart, periodEnd)
      if (error) warnings.push(`${employee.full_name}: ${error}`)
      continue
    }

    // Contributions are computed even on a nothing-earned draft (kept only
    // for a cash advance), so net pay can go negative -- same as top-up.
    const auto = await computeAutoDeductions(
      employee.employee_id,
      grossAdded,
      periodEnd,
      employee.is_minimum_wage_earner,
    )
    if (auto.error || !auto.deductions) {
      warnings.push(`${employee.full_name}: ${auto.error}`)
      continue
    }

    const cashAdvanceDeducted = await autoCashAdvanceDeduction(employee.employee_id, grossAdded)

    const { payrollId, error } = await issuePayslip({
      employeeId: employee.employee_id,
      rateType: employee.rate_type,
      periodStart,
      periodEnd,
      lineItems: pay.lineItems,
      cashAdvanceDeducted,
      deductions: auto.deductions,
    })

    if (error) {
      // Another admin generated this one at the same moment -- fine.
      if (!error.includes('duplicate key')) warnings.push(`${employee.full_name}: ${error}`)
      continue
    }
    if (payrollId !== null) createdIds.push(payrollId)
  }

  return { createdIds, warnings, error: null }
}

// Adds newly earned lines (new trips / newly recorded attendance) to an
// existing draft and updates its totals. Admin edits stay: edited and
// manual lines aren't touched, cash advance stays. Government deductions
// are recalculated on the new gross -- unless the admin overrode them
// (deductions_note set), in which case they're kept and the note gets a
// "pay changed, check the deductions" flag instead of silently
// replacing the admin's numbers.
async function topUpDraft(
  draft: ExistingDraft,
  employee: EmployeePayRate & { is_minimum_wage_earner: boolean },
  newLines: PayslipLineItem[],
  grossAdded: number,
  periodStart: string,
  periodEnd: string,
): Promise<{ error: string | null }> {
  const { error: linesError } = await supabase
    .from('payslip_line_items')
    .insert(newLines.map((item) => ({ payroll_id: draft.payroll_id, ...item })))
  if (linesError) return { error: linesError.message }

  if (employee.rate_type !== 'Commission Per Trip') {
    const { error: markError } = await markAttendanceAsPaid(
      employee.employee_id,
      periodStart,
      periodEnd,
      draft.payroll_id,
    )
    if (markError) {
      return {
        error: `new lines were added to draft #${draft.payroll_id}, but the attendance days couldn't be marked as paid (${markError}). This needs manual review.`,
      }
    }
  }

  return saveDraftTotals(
    draft,
    employee,
    draft.gross_pay + grossAdded,
    periodEnd,
    `Pay went up by ₱${grossAdded.toLocaleString()} after these deductions were edited -- check them.`,
  )
}

// Removes double-counted trip lines from a draft (same itinerary_id on
// more than one line -- left behind by the old overlapping-runs bug) and
// makes its gross match its lines again. Runs on every Payroll open, so
// bad drafts fix themselves. Returns the corrected gross when it changed.
async function healDraft(
  draft: ExistingDraft,
  // The draft's lines, oldest first (so the first copy of a trip is kept).
  lines: DraftLine[],
  employee: EmployeePayRate & { is_minimum_wage_earner: boolean },
  periodEnd: string,
): Promise<{ gross: number | null; error: string | null }> {
  const seenTrips = new Set<number>()
  const duplicateIds: number[] = []
  let gross = 0
  for (const line of lines) {
    if (line.itinerary_id != null) {
      if (seenTrips.has(line.itinerary_id)) {
        duplicateIds.push(line.payslip_line_item_id)
        continue
      }
      seenTrips.add(line.itinerary_id)
    }
    gross += Number(line.amount)
  }

  if (duplicateIds.length === 0 && Math.abs(gross - draft.gross_pay) < 0.005) {
    return { gross: null, error: null }
  }

  if (duplicateIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('payslip_line_items')
      .delete()
      .in('payslip_line_item_id', duplicateIds)
    if (deleteError) return { gross: null, error: deleteError.message }
  }

  const { error: saveError } = await saveDraftTotals(
    draft,
    employee,
    gross,
    periodEnd,
    'Duplicate trip lines were removed and the total corrected -- check the deductions.',
  )
  return { gross: saveError ? null : gross, error: saveError }
}

// Saves a draft's new gross and the deductions/net that go with it.
// Government deductions are recalculated unless the admin overrode them.
async function saveDraftTotals(
  draft: ExistingDraft,
  employee: EmployeePayRate & { is_minimum_wage_earner: boolean },
  grossPay: number,
  periodEnd: string,
  flag: string,
): Promise<{ error: string | null }> {
  let deductions: PayslipDeductions
  if (draft.deductions_note) {
    deductions = {
      sss_msc: draft.sss_msc,
      sss_ee: draft.sss_ee,
      sss_er: draft.sss_er,
      sss_ec: draft.sss_ec,
      philhealth_ee: draft.philhealth_ee,
      philhealth_er: draft.philhealth_er,
      pagibig_ee: draft.pagibig_ee,
      pagibig_er: draft.pagibig_er,
      withholding_tax: draft.withholding_tax,
      deductions_note: `${draft.deductions_note} | ${flag}`,
    }
  } else {
    const auto = await computeAutoDeductions(
      employee.employee_id,
      grossPay,
      periodEnd,
      employee.is_minimum_wage_earner,
    )
    if (auto.error || !auto.deductions) {
      return { error: `draft #${draft.payroll_id}'s lines were changed, but its totals couldn't be updated (${auto.error}). This needs manual review.` }
    }
    deductions = auto.deductions
  }

  // Keep an existing deduction (admin may have set it); if there is none
  // yet (e.g. a cash-advance-only draft that just earned pay), auto-fill.
  const netBeforeAdvance = grossPay - totalEmployeeDeductions(deductions)
  const cashAdvanceDeducted =
    draft.cash_advance_deducted > 0
      ? draft.cash_advance_deducted
      : await autoCashAdvanceDeduction(employee.employee_id, grossPay)

  const { data, error: updateError } = await supabase
    .from('payroll_payslips')
    .update({
      gross_pay: grossPay,
      base_pay: grossPay,
      cash_advance_deducted: cashAdvanceDeducted,
      ...deductions,
      net_pay: netBeforeAdvance - cashAdvanceDeducted,
    })
    .eq('payroll_id', draft.payroll_id)
    .is('finalized_at', null)
    .select('payroll_id')
    .maybeSingle()

  if (updateError || !data) {
    return {
      error: `draft #${draft.payroll_id}'s lines were changed, but its totals couldn't be updated (${updateError?.message ?? 'it was finalized meanwhile'}). This needs manual review.`,
    }
  }
  return { error: null }
}

// Saves the admin's edits to a DRAFT in place -- same payslip row, same
// period, its line items replaced with the edited set (trip lines keep
// their itinerary_id, so those trips stay paid by this draft). Refuses
// once finalized. Not a DB transaction: a failure after the row update
// names the payslip for manual review.
export async function updateDraftPayslip(
  payrollId: number,
  {
    lineItems,
    cashAdvanceDeducted,
    deductions,
  }: { lineItems: PayslipLineItem[]; cashAdvanceDeducted: number; deductions: PayslipDeductions },
): Promise<{ error: string | null }> {
  const grossPay = lineItems.reduce((sum, item) => sum + item.amount, 0)

  const { data, error: updateError } = await supabase
    .from('payroll_payslips')
    .update({
      gross_pay: grossPay,
      base_pay: grossPay,
      cash_advance_deducted: cashAdvanceDeducted,
      ...deductions,
      net_pay: grossPay - cashAdvanceDeducted - totalEmployeeDeductions(deductions),
    })
    .eq('payroll_id', payrollId)
    .is('finalized_at', null)
    .select('payroll_id')
    .maybeSingle()

  if (updateError) return { error: updateError.message }
  if (!data) return { error: 'This payslip has already been finalized, so it can no longer be edited.' }

  const { error: deleteError } = await supabase.from('payslip_line_items').delete().eq('payroll_id', payrollId)
  if (deleteError) {
    return { error: `Payslip #${payrollId}'s totals were saved, but its old line items couldn't be replaced (${deleteError.message}). This needs manual review.` }
  }

  const { error: insertError } = await supabase.from('payslip_line_items').insert(
    lineItems.map((item) => ({ payroll_id: payrollId, ...item })),
  )
  if (insertError) {
    return { error: `Payslip #${payrollId}'s old line items were removed, but the edited ones couldn't be saved (${insertError.message}). This needs manual review.` }
  }
  return { error: null }
}

// Hold (Drivers only, enforced in the UI): an on-hold draft can't be
// finalized -- neither on its own nor by "Finalize all" -- until the hold
// is lifted, so it can't be released to the driver by accident.
export async function setPayslipHold(
  payrollId: number,
  onHold: boolean,
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('payroll_payslips')
    .update({ on_hold: onHold })
    .eq('payroll_id', payrollId)
    .is('finalized_at', null)
    .select('payroll_id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'Only a draft payslip can be put on or taken off hold -- reload to check.' }
  return { error: null }
}

// Draft -> released. A newly issued payslip has finalized_at = null (a
// draft): only staff can see it (RLS hides drafts from employees), so
// admin can review it first. Finalizing stamps finalized_at, which is
// what makes it show up in the employee's own payslip list.
// .is('finalized_at', null) + .select() so an already-finalized (or
// RLS-blocked) row is reported instead of silently "succeeding".
export async function finalizePayslips(
  payrollIds: number[],
): Promise<{ finalizedIds: number[]; error: string | null }> {
  const { data, error } = await supabase
    .from('payroll_payslips')
    .update({ finalized_at: new Date().toISOString() })
    .in('payroll_id', payrollIds)
    .is('finalized_at', null)
    .eq('on_hold', false)
    // Week must be over -- a trip delivered after finalizing could
    // never be paid (one payslip per employee per week).
    .lt('payroll_period_end', toManilaDate(new Date()))
    .select('payroll_id')

  if (error) {
    return { finalizedIds: [], error: error.message }
  }
  const finalizedIds = data.map((row) => row.payroll_id)
  if (finalizedIds.length < payrollIds.length) {
    return {
      finalizedIds,
      error: `Only ${finalizedIds.length} of ${payrollIds.length} payslips were finalized -- the rest are on hold, still in their week, already finalized, or couldn't be updated. Reload to check.`,
    }
  }
  return { finalizedIds, error: null }
}

// Throws away a DRAFT payslip so it can be re-issued correctly: frees
// its attendance days, deletes its line items (which frees its trips to
// be paid again), then the payslip itself. Done by the database function
// discard_draft_payslip (SQL given in chat, 2026-10-23) in ONE
// transaction that first locks the payslip and checks it's still a
// draft -- the old browser version freed the days and deleted the lines
// BEFORE that check, so a payslip finalized at the same moment lost its
// lines and its days became payable again.
export async function discardDraftPayslip(
  payrollId: number,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('discard_draft_payslip', { p_payroll_id: payrollId })
  return { error: error?.message ?? null }
}

// Only a finalized payslip can be marked Paid.
export async function markPayslipPaid(
  payrollId: number,
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from('payroll_payslips')
    .update({ payslip_status: 'Paid' })
    .eq('payroll_id', payrollId)
    .not('finalized_at', 'is', null)
    .select('payroll_id')
    .maybeSingle()

  if (error) {
    return { error: error.message }
  }
  if (!data) {
    return { error: 'This payslip is still a draft -- finalize it before marking it paid.' }
  }
  return { error: null }
}

export type Payslip = {
  payroll_id: number
  payroll_period_start: string
  payroll_period_end: string
  gross_pay: number
  base_pay: number
  allowance_amount: number
  cash_advance_deducted: number
  sss_ee: number
  philhealth_ee: number
  pagibig_ee: number
  withholding_tax: number
  net_pay: number
  payslip_status: string
}

export async function loadPayslipsForEmployee(
  employeeId: number,
): Promise<{ payslips: Payslip[]; error: string | null }> {
  const { data, error } = await supabase
    .from('payroll_payslips')
    .select(
      'payroll_id, payroll_period_start, payroll_period_end, gross_pay, base_pay, allowance_amount, cash_advance_deducted, sss_ee, philhealth_ee, pagibig_ee, withholding_tax, net_pay, payslip_status',
    )
    .eq('employee_id', employeeId)
    // Drafts aren't released yet (RLS hides them from employees too --
    // this keeps staff viewing their own payslips consistent).
    .not('finalized_at', 'is', null)
    .order('payroll_period_start', { ascending: false })

  if (error) {
    return { payslips: [], error: error.message }
  }

  return { payslips: data, error: null }
}

export async function loadPayslipLineItems(
  payrollId: number,
): Promise<{ lineItems: PayslipLineItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from('payslip_line_items')
    .select('itinerary_id, description, amount')
    .eq('payroll_id', payrollId)
    .order('payslip_line_item_id', { ascending: true })

  if (error) {
    return { lineItems: [], error: error.message }
  }

  return { lineItems: data, error: null }
}
