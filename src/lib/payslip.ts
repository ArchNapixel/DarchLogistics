// payslip: shared calculation + data access for employee payroll --
// used by the admin "Issue Payslip" flow (PayrollSection.tsx) and every
// employee's own "My Payslip" view (MyPayslipSection.tsx, shown to
// Driver/Mechanic/Helper/Dispatcher).
//
// Pay model (rewritten 2026-09-23 to read each employee's own
// rate_type/rate columns on `employees`, instead of one shared
// app_settings value per position -- see buildEmployeePayLineItems):
// - rate_type 'Commission Per Trip': commission_basis decides the
//   formula -- 'Percentage' is commissionRate% (from
//   app_settings.driver_commission_rate, company-wide and still
//   editable on the Settings page) of that trip's
//   bookings.rate_of_delivery_service; 'Flat Fee' is that employee's
//   own commission_per_trip peso amount instead. Either way, one line
//   item per trip actually delivered whose delivery_receipts.received_at
//   falls inside the pay period -- NOT itineraries.trip_date_from,
//   since that's just the planned date and pay is for when the trip
//   actually finished. A trip counts for whoever delivered it even if
//   itinerary_crews was later reassigned to someone else (itinerary_crews
//   keeps history rows). Any itinerary_id that already appears in a
//   previously issued payslip_line_items row is skipped regardless of
//   period dates -- a trip can never be paid twice, even if periods
//   ever end up overlapping.
// - rate_type 'Daily Fixed' / 'Monthly Salary' / 'Hourly': paid against
//   attendance (employee_attendance, Present/Leave days count) using
//   that employee's own daily_rate / monthly_salary / hourly_rate --
//   Daily Fixed is daily_rate x paid days, Monthly Salary is
//   (monthly_salary / 30) x paid days (same day-rate-equivalent
//   approach, just per-employee now instead of one shared salary per
//   position), Hourly is hourly_rate x hours_worked summed over the
//   period's paid days.
// - No separate daily allowance line item -- removed 2026-09-23, gross
//   pay is just the rate_type-based pay above.
// - Cash advances (cash_advances table) are never auto-deducted --
//   admin sees the employee's outstanding balance when issuing a
//   payslip and chooses how much (if any) to deduct THIS time.
//   net_pay = gross_pay (base_pay + allowance_amount) -
//   cash_advance_deducted.
// - Payslips are issued weekly, period ending Saturday. Issuing writes
//   the breakdown into payslip_line_items so it stays accurate forever
//   even if settings/rates change later -- a payslip is a historical
//   record, not a live calculation.
import { supabase } from './supabaseClient'
import { countPaidAttendanceDays, sumPaidAttendanceHours, markAttendanceAsPaid } from './employeeAttendance'

export type PayrollSettings = {
  driverCommissionRate: number
}

const SETTINGS_KEYS = ['driver_commission_rate'] as const

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
    },
    error: null,
  }
}

// Most recent Saturday on/before today, and the 6 days before it --
// the default weekly pay period, editable in the Issue Payslip form.
export function getDefaultPayPeriod(): { start: string; end: string } {
  const today = new Date()
  const daysSinceSaturday = (today.getDay() - 6 + 7) % 7
  const end = new Date(today)
  end.setDate(today.getDate() - daysSinceSaturday)
  const start = new Date(end)
  start.setDate(end.getDate() - 6)

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export type PayslipLineItem = {
  itinerary_id: number | null
  description: string
  amount: number
}

export type RateType = 'Daily Fixed' | 'Commission Per Trip' | 'Monthly Salary' | 'Hourly'
export type CommissionBasis = 'Flat Fee' | 'Percentage'

export type EmployeePayRate = {
  employee_id: number
  position: string
  rate_type: RateType
  commission_basis: CommissionBasis | null
  daily_rate: number | null
  commission_per_trip: number | null
  monthly_salary: number | null
  hourly_rate: number | null
}

// Commission Per Trip: one line item per trip actually delivered
// within the period, using whichever formula commission_basis picks.
// Trips already paid on some earlier payslip (any itinerary_id already
// sitting in payslip_line_items) are excluded up front, regardless of
// period dates -- the guarantee that a trip is never paid twice.
async function buildCommissionTripLineItems(
  employee: EmployeePayRate,
  periodStart: string,
  periodEnd: string,
  companyCommissionRate: number,
): Promise<{ lineItems: PayslipLineItem[]; error: string | null }> {
  if (!employee.commission_basis) {
    return {
      lineItems: [],
      error:
        `${employee.position} #${employee.employee_id} is set to "Commission Per Trip" ` +
        `but has no commission basis (Flat Fee / Percentage) chosen yet -- edit their ` +
        `employee record first.`,
    }
  }
  if (employee.commission_basis === 'Flat Fee' && employee.commission_per_trip == null) {
    return {
      lineItems: [],
      error: `This employee's flat commission-per-trip amount hasn't been set -- edit their employee record first.`,
    }
  }
  if (employee.position !== 'Driver' && employee.position !== 'Helper') {
    return {
      lineItems: [],
      error: `"Commission Per Trip" only makes sense for a Driver or Helper (${employee.position} isn't crewed on trips) -- check this employee's rate type.`,
    }
  }

  // crew_role matches the employee's own position ('Driver' or
  // 'Helper' can both be Commission Per Trip, per the rate_type
  // dropdown) -- not hardcoded to 'Driver', or a Helper on this rate
  // type would silently get 0 trips found instead of a real error.
  const { data: crewRows, error: crewError } = await supabase
    .from('itinerary_crews')
    .select('itinerary_id')
    .eq('employee_id', employee.employee_id)
    .eq('crew_role', employee.position)

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
    receivedDateByItinerary.set(row.itinerary_id, row.status_changed_at.slice(0, 10))
  }
  // delivery_receipts wins where it exists -- it's the more precise,
  // intentionally-recorded date.
  for (const row of receiptsResult.data) {
    receivedDateByItinerary.set(row.itinerary_id, row.received_at.slice(0, 10))
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
    const amount =
      employee.commission_basis === 'Flat Fee'
        ? employee.commission_per_trip ?? 0
        : (companyCommissionRate / 100) * (rateByBooking.get(row.booking_id) ?? 0)
    const basisLabel =
      employee.commission_basis === 'Flat Fee'
        ? 'flat fee'
        : `${companyCommissionRate}% commission`
    const pickup = placeNameById.get(row.place_of_pickup_id) ?? '—'
    const delivery = placeNameById.get(row.place_of_delivery_id) ?? '—'
    const date = receivedDateByItinerary.get(row.itinerary_id) ?? ''

    return {
      itinerary_id: row.itinerary_id,
      description: `Trip #${row.itinerary_id}: ${pickup} → ${delivery} (${date}) — ${basisLabel}`,
      amount,
    }
  })

  return { lineItems, error: null }
}

// Daily Fixed / Monthly Salary / Hourly: paid against attendance,
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

  const rateAmount = employee.rate_type === 'Daily Fixed' ? employee.daily_rate : employee.monthly_salary
  if (rateAmount == null) {
    return {
      lineItems: [],
      error: `This employee's ${employee.rate_type === 'Daily Fixed' ? 'daily rate' : 'monthly salary'} hasn't been set -- edit their employee record first.`,
    }
  }

  const { days, error } = await countPaidAttendanceDays(employee.employee_id, periodStart, periodEnd)
  if (error) return { lineItems: [], error }

  // Monthly Salary is converted to a daily-equivalent (÷30) and paid
  // per attendance day, same approach as Daily Fixed -- just derived
  // from a monthly figure instead of an already-daily one. The label's
  // denominator matches whichever divisor actually drives the math --
  // 30 for Monthly Salary regardless of period length, and the
  // selected period's own day count for Daily Fixed (not a hardcoded
  // 7 -- the period isn't always exactly a week, e.g. a first payslip
  // covering however many days since the employee was hired, or an
  // admin picking a custom range).
  const dayRate = employee.rate_type === 'Daily Fixed' ? rateAmount : rateAmount / 30
  const label = employee.rate_type === 'Daily Fixed' ? 'daily rate' : 'monthly salary'
  const daysInPeriod =
    Math.round(
      (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86_400_000,
    ) + 1
  const denominator = employee.rate_type === 'Daily Fixed' ? daysInPeriod : 30

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
    return buildCommissionTripLineItems(employee, periodStart, periodEnd, settings.driverCommissionRate)
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

// Creates the payroll_payslips row plus its payslip_line_items rows in
// one call. Not wrapped in a real DB transaction (no RPC for that yet
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
}: {
  employeeId: number
  rateType: RateType
  periodStart: string
  periodEnd: string
  lineItems: PayslipLineItem[]
  cashAdvanceDeducted: number
}): Promise<{ payrollId: number | null; error: string | null }> {
  const grossPay = lineItems.reduce((sum, item) => sum + item.amount, 0)
  // No separate allowance line item anymore (removed 2026-09-23) --
  // base_pay is just gross_pay.
  const basePay = grossPay
  const netPay = grossPay - cashAdvanceDeducted

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

export async function markPayslipPaid(
  payrollId: number,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('payroll_payslips')
    .update({ payslip_status: 'Paid' })
    .eq('payroll_id', payrollId)

  return { error: error?.message ?? null }
}

export type Payslip = {
  payroll_id: number
  payroll_period_start: string
  payroll_period_end: string
  gross_pay: number
  base_pay: number
  allowance_amount: number
  cash_advance_deducted: number
  net_pay: number
  payslip_status: string
}

export async function loadPayslipsForEmployee(
  employeeId: number,
): Promise<{ payslips: Payslip[]; error: string | null }> {
  const { data, error } = await supabase
    .from('payroll_payslips')
    .select(
      'payroll_id, payroll_period_start, payroll_period_end, gross_pay, base_pay, allowance_amount, cash_advance_deducted, net_pay, payslip_status',
    )
    .eq('employee_id', employeeId)
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
