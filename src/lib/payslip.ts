// payslip: shared calculation + data access for employee payroll --
// used by the admin "Issue Payslip" flow (PayrollSection.tsx) and every
// employee's own "My Payslip" view (MyPayslipSection.tsx, shown to
// Driver/Mechanic/Helper/Dispatcher).
//
// Pay model (rewritten 2026-09-23 to read each employee's own
// rate_type/rate columns on `employees`, instead of one shared
// app_settings value per position -- see buildEmployeePayLineItems):
// - rate_type 'Commission Per Trip' (Drivers only): per trip,
//   app_settings.driver_commission_rate% of that trip's
//   bookings.rate_of_delivery_service (the rate is per trip, not per
//   contract) PLUS app_settings.driver_per_trip_fee -- both
//   company-wide, editable on the Settings page, and the same formula
//   QuoteReviewModal's profitability panel estimates with. The old
//   per-employee commission_basis / commission_per_trip columns are no
//   longer used (removed 2026-09-28). One line
//   item per trip actually delivered whose delivery_receipts.received_at
//   falls inside the pay period -- NOT itineraries.trip_date_from,
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
import { countPaidAttendanceDays, sumPaidAttendanceHours, markAttendanceAsPaid } from './employeeAttendance'
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

// Commission Per Trip (Drivers only): one line item per trip actually
// delivered within the period -- commission% of the trip's rate plus
// the flat per-trip fee, both from app_settings.
// Trips already paid on some earlier payslip (any itinerary_id already
// sitting in payslip_line_items) are excluded up front, regardless of
// period dates -- the guarantee that a trip is never paid twice.
async function buildCommissionTripLineItems(
  employee: EmployeePayRate,
  periodStart: string,
  periodEnd: string,
  settings: PayrollSettings,
): Promise<{ lineItems: PayslipLineItem[]; error: string | null }> {
  if (employee.position !== 'Driver') {
    return {
      lineItems: [],
      error: `"Commission Per Trip" is for Drivers only (${employee.position}s are paid a salary) -- change this employee's rate type.`,
    }
  }

  const { data: crewRows, error: crewError } = await supabase
    .from('itinerary_crews')
    .select('itinerary_id')
    .eq('employee_id', employee.employee_id)
    .eq('crew_role', 'Driver')

  if (crewError) {
    return { lineItems: [], error: crewError.message }
  }

  const itineraryIds = Array.from(new Set(crewRows.map((row) => row.itinerary_id)))
  if (itineraryIds.length === 0) {
    return { lineItems: [], error: null }
  }

  const { data: itineraryRows, error: itineraryError } = await supabase
    .from('itineraries')
    .select(
      'itinerary_id, booking_id, place_of_pickup_id, place_of_delivery_id, itinerary_status',
    )
    .in('itinerary_id', itineraryIds)
    .eq('itinerary_status', 'Delivered')

  if (itineraryError) {
    return { lineItems: [], error: itineraryError.message }
  }
  if (itineraryRows.length === 0) {
    return { lineItems: [], error: null }
  }

  const deliveredIds = itineraryRows.map((row) => row.itinerary_id)

  // payslip_line_items has no employee_id column of its own -- it only
  // links back to payroll_payslips, which does. So "already paid"
  // has to go through THIS employee's own payslips specifically, not
  // a bare itinerary_id lookup across the whole table -- otherwise the
  // Driver on a trip getting paid would wrongly blacklist that same
  // trip from ever paying the Helper who was also on it, since two
  // different employees legitimately earn their own commission on the
  // same delivered trip.
  const [receiptsResult, statusLogResult, ownPayslipsResult] = await Promise.all([
    supabase.from('delivery_receipts').select('itinerary_id, received_at').in('itinerary_id', deliveredIds),
    // Fallback for a trip marked Delivered via the Dispatch Board's
    // direct status override instead of the Driver's own Delivery
    // Receipt flow -- that path never writes a delivery_receipts row
    // at all, so without this a staff-overridden trip could never be
    // paid. Ordered oldest-first so the reduce below naturally keeps
    // the LAST (most recent) Delivered transition per itinerary, in
    // case one cycled through Delivered more than once.
    supabase
      .from('dispatch_status_logs')
      .select('itinerary_id, status_changed_at')
      .in('itinerary_id', deliveredIds)
      .eq('new_status', 'Delivered')
      .order('status_changed_at', { ascending: true }),
    supabase.from('payroll_payslips').select('payroll_id').eq('employee_id', employee.employee_id),
  ])

  if (receiptsResult.error) {
    return { lineItems: [], error: receiptsResult.error.message }
  }
  if (statusLogResult.error) {
    return { lineItems: [], error: statusLogResult.error.message }
  }
  if (ownPayslipsResult.error) {
    return { lineItems: [], error: ownPayslipsResult.error.message }
  }

  const receivedDateByItinerary = new Map<number, string>()
  for (const row of statusLogResult.data) {
    receivedDateByItinerary.set(row.itinerary_id, toManilaDate(row.status_changed_at))
  }
  // delivery_receipts wins where it exists -- it's the more precise,
  // intentionally-recorded date.
  for (const row of receiptsResult.data) {
    receivedDateByItinerary.set(row.itinerary_id, toManilaDate(row.received_at))
  }

  const ownPayrollIds = ownPayslipsResult.data.map((row) => row.payroll_id)
  let alreadyPaidIds = new Set<number>()
  if (ownPayrollIds.length > 0) {
    const alreadyPaidResult = await supabase
      .from('payslip_line_items')
      .select('itinerary_id')
      .in('payroll_id', ownPayrollIds)
      .in('itinerary_id', deliveredIds)

    if (alreadyPaidResult.error) {
      return { lineItems: [], error: alreadyPaidResult.error.message }
    }
    alreadyPaidIds = new Set(
      alreadyPaidResult.data.map((row) => row.itinerary_id).filter((id): id is number => id != null),
    )
  }

  const qualifying = itineraryRows.filter((row) => {
    if (alreadyPaidIds.has(row.itinerary_id)) return false
    const receivedDate = receivedDateByItinerary.get(row.itinerary_id)
    return receivedDate && receivedDate >= periodStart && receivedDate <= periodEnd
  })

  if (qualifying.length === 0) {
    return { lineItems: [], error: null }
  }

  const bookingIds = Array.from(new Set(qualifying.map((row) => row.booking_id)))
  const placeIds = Array.from(
    new Set(
      qualifying.flatMap((row) => [row.place_of_pickup_id, row.place_of_delivery_id]),
    ),
  )

  const [bookingsResult, placesResult] = await Promise.all([
    supabase
      .from('bookings')
      .select('booking_id, rate_of_delivery_service')
      .in('booking_id', bookingIds),
    supabase.from('places').select('place_id, place_name').in('place_id', placeIds),
  ])

  if (bookingsResult.error) {
    return { lineItems: [], error: bookingsResult.error.message }
  }
  if (placesResult.error) {
    return { lineItems: [], error: placesResult.error.message }
  }

  const rateByBooking = new Map(
    bookingsResult.data.map((row) => [row.booking_id, row.rate_of_delivery_service]),
  )
  const placeNameById = new Map(
    placesResult.data.map((row) => [row.place_id, row.place_name]),
  )

  const lineItems = qualifying.map((row) => {
    const tripRate = rateByBooking.get(row.booking_id) ?? 0
    const amount = (settings.driverCommissionRate / 100) * tripRate + settings.driverPerTripFee
    const pickup = placeNameById.get(row.place_of_pickup_id) ?? '—'
    const delivery = placeNameById.get(row.place_of_delivery_id) ?? '—'
    const date = receivedDateByItinerary.get(row.itinerary_id) ?? ''

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
async function buildAttendanceBasedLineItems(
  employee: EmployeePayRate,
  periodStart: string,
  periodEnd: string,
): Promise<{ lineItems: PayslipLineItem[]; error: string | null }> {
  if (employee.rate_type === 'Hourly') {
    if (employee.hourly_rate == null) {
      return { lineItems: [], error: `This employee's hourly rate hasn't been set -- edit their employee record first.` }
    }
    const { hours, error } = await sumPaidAttendanceHours(employee.employee_id, periodStart, periodEnd)
    if (error) return { lineItems: [], error }

    return {
      lineItems: [
        {
          itinerary_id: null,
          description: `${employee.position} hourly pay (${hours} hrs @ ₱${employee.hourly_rate}/hr)`,
          amount: employee.hourly_rate * hours,
        },
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

  const { days, error } = await countPaidAttendanceDays(employee.employee_id, periodStart, periodEnd)
  if (error) return { lineItems: [], error }

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

  return {
    lineItems: [
      {
        itinerary_id: null,
        description: `${employee.position} ${label} (${days}/${denominator} paid attendance days)`,
        amount: dayRate * days,
      },
    ],
    error: null,
  }
}

// The single entry point IssuePayslipModal calls -- dispatches on the
// employee's own rate_type instead of their position.
export async function buildEmployeePayLineItems(
  employee: EmployeePayRate,
  periodStart: string,
  periodEnd: string,
  settings: PayrollSettings,
): Promise<{ lineItems: PayslipLineItem[]; error: string | null }> {
  if (employee.rate_type === 'Commission Per Trip') {
    return buildCommissionTripLineItems(employee, periodStart, periodEnd, settings)
  }
  return buildAttendanceBasedLineItems(employee, periodStart, periodEnd)
}

export { countPaidAttendanceDays }

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

  const { error: lineItemsError } = await supabase.from('payslip_line_items').insert(
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
export async function generateDraftPayslips(
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

  const createdIds: number[] = []
  const warnings: string[] = []

  // One at a time: each employee's earlier-this-month payslips must be
  // read after anything just created for them.
  for (const employee of toProcess) {
    const pay = await buildEmployeePayLineItems(employee, periodStart, periodEnd, settingsResult.settings)
    if (pay.error) {
      warnings.push(`${employee.full_name}: ${pay.error}`)
      continue
    }
    // Nothing (new) earned -- salary types still return a ₱0 line when
    // no attendance was recorded, so check the total, not the count.
    const grossAdded = pay.lineItems.reduce((sum, item) => sum + item.amount, 0)
    if (grossAdded <= 0) continue

    const draft = existingByEmployee.get(employee.employee_id)
    if (draft) {
      const { error } = await topUpDraft(draft, employee, pay.lineItems, grossAdded, periodStart, periodEnd)
      if (error) warnings.push(`${employee.full_name}: ${error}`)
      continue
    }

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

    const { payrollId, error } = await issuePayslip({
      employeeId: employee.employee_id,
      rateType: employee.rate_type,
      periodStart,
      periodEnd,
      lineItems: pay.lineItems,
      cashAdvanceDeducted: 0,
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

  const grossPay = draft.gross_pay + grossAdded
  let deductions: PayslipDeductions
  if (draft.deductions_note) {
    const flag = `Pay went up by ₱${grossAdded.toLocaleString()} after these deductions were edited -- check them.`
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
      return { error: `new lines were added to draft #${draft.payroll_id}, but its totals couldn't be updated (${auto.error}). This needs manual review.` }
    }
    deductions = auto.deductions
  }

  const { data, error: updateError } = await supabase
    .from('payroll_payslips')
    .update({
      gross_pay: grossPay,
      base_pay: grossPay,
      ...deductions,
      net_pay: grossPay - draft.cash_advance_deducted - totalEmployeeDeductions(deductions),
    })
    .eq('payroll_id', draft.payroll_id)
    .is('finalized_at', null)
    .select('payroll_id')
    .maybeSingle()

  if (updateError || !data) {
    return {
      error: `new lines were added to draft #${draft.payroll_id}, but its totals couldn't be updated (${updateError?.message ?? 'it was finalized meanwhile'}). This needs manual review.`,
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
// be paid again), then the payslip itself. Finalized payslips can't be
// discarded. Not a DB transaction (same limitation as issuePayslip) --
// a failure partway names what's left over.
export async function discardDraftPayslip(
  payrollId: number,
): Promise<{ error: string | null }> {
  const { error: attendanceError } = await supabase
    .from('employee_attendance')
    .update({ paid_payroll_id: null })
    .eq('paid_payroll_id', payrollId)

  if (attendanceError) {
    return { error: attendanceError.message }
  }

  const { error: lineItemsError } = await supabase
    .from('payslip_line_items')
    .delete()
    .eq('payroll_id', payrollId)

  if (lineItemsError) {
    return { error: lineItemsError.message }
  }

  const { data, error: payslipError } = await supabase
    .from('payroll_payslips')
    .delete()
    .eq('payroll_id', payrollId)
    .is('finalized_at', null)
    .select('payroll_id')
    .maybeSingle()

  if (payslipError || !data) {
    return {
      error:
        `Draft payslip #${payrollId}'s line items were removed, but the payslip itself ` +
        `could not be deleted (${payslipError?.message ?? 'already finalized, or not permitted'}). ` +
        `This needs manual review.`,
    }
  }
  return { error: null }
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
