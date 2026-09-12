// payslip: shared calculation + data access for employee payroll --
// used by the admin "Issue Payslip" flow (PayrollSection.tsx) and every
// employee's own "My Payslip" view (MyPayslipSection.tsx, shown to
// Driver/Mechanic/Helper/Dispatcher).
//
// Pay model (from the business owner):
// - Driver: 12% commission on rate_of_delivery_service PLUS a flat
//   driver_per_trip_fee, for every trip they actually delivered whose
//   delivery_receipts.received_at falls inside the pay period -- NOT
//   itineraries.trip_date_from, since that's just the planned date and
//   a driver is paid for when they actually finished the trip. A trip
//   counts for whoever delivered it even if itinerary_crews was later
//   reassigned to someone else (itinerary_crews keeps history rows).
// - Mechanic/Dispatcher/Helper: one flat weekly salary, the same for
//   everyone in that position -- a single app_settings value per
//   position, not a per-employee rate.
// - Everyone (including Driver) also gets a flat daily_allowance x 7,
//   since there's no attendance/time-tracking system to count actual
//   worked days against.
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

export type PayrollSettings = {
  driverCommissionRate: number
  driverPerTripFee: number
  mechanicWeeklySalary: number
  dispatcherWeeklySalary: number
  helperWeeklySalary: number
  dailyAllowance: number
}

const SETTINGS_KEYS = [
  'driver_commission_rate',
  'driver_per_trip_fee',
  'mechanic_weekly_salary',
  'dispatcher_weekly_salary',
  'helper_weekly_salary',
  'daily_allowance',
] as const

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
      mechanicWeeklySalary: valueByKey.get('mechanic_weekly_salary') ?? 0,
      dispatcherWeeklySalary: valueByKey.get('dispatcher_weekly_salary') ?? 0,
      helperWeeklySalary: valueByKey.get('helper_weekly_salary') ?? 0,
      dailyAllowance: valueByKey.get('daily_allowance') ?? 0,
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

// Driver-only: one line item per trip actually delivered within the
// period, each combining that trip's commission + flat per-trip fee.
export async function buildDriverTripLineItems(
  employeeId: number,
  periodStart: string,
  periodEnd: string,
  commissionRate: number,
  perTripFee: number,
): Promise<{ lineItems: PayslipLineItem[]; error: string | null }> {
  const { data: crewRows, error: crewError } = await supabase
    .from('itinerary_crews')
    .select('itinerary_id')
    .eq('employee_id', employeeId)
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

  const { data: receiptRows, error: receiptError } = await supabase
    .from('delivery_receipts')
    .select('itinerary_id, received_at')
    .in('itinerary_id', deliveredIds)

  if (receiptError) {
    return { lineItems: [], error: receiptError.message }
  }

  const receivedDateByItinerary = new Map(
    receiptRows.map((row) => [row.itinerary_id, row.received_at.slice(0, 10)]),
  )

  const qualifying = itineraryRows.filter((row) => {
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
    const rate = rateByBooking.get(row.booking_id) ?? 0
    const commission = (commissionRate / 100) * rate
    const amount = commission + perTripFee
    const pickup = placeNameById.get(row.place_of_pickup_id) ?? '—'
    const delivery = placeNameById.get(row.place_of_delivery_id) ?? '—'
    const date = receivedDateByItinerary.get(row.itinerary_id) ?? ''

    return {
      itinerary_id: row.itinerary_id,
      description: `Trip #${row.itinerary_id}: ${pickup} → ${delivery} (${date})`,
      amount,
    }
  })

  return { lineItems, error: null }
}

export function fixedSalaryLineItem(
  position: string,
  settings: PayrollSettings,
): PayslipLineItem {
  const salary =
    position === 'Mechanic'
      ? settings.mechanicWeeklySalary
      : position === 'Dispatcher'
        ? settings.dispatcherWeeklySalary
        : settings.helperWeeklySalary

  return {
    itinerary_id: null,
    description: `${position} weekly salary`,
    amount: salary,
  }
}

export function allowanceLineItem(settings: PayrollSettings): PayslipLineItem {
  return {
    itinerary_id: null,
    description: 'Daily allowance (7 days)',
    amount: settings.dailyAllowance * 7,
  }
}

// Total cash advances issued minus what's already been deducted across
// this employee's past payslips -- what's still owed back.
export async function getOutstandingCashAdvance(
  employeeId: number,
): Promise<{ outstanding: number; error: string | null }> {
  const [advancesResult, payslipsResult] = await Promise.all([
    supabase.from('cash_advances').select('amount').eq('employee_id', employeeId),
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
  periodStart,
  periodEnd,
  lineItems,
  cashAdvanceDeducted,
}: {
  employeeId: number
  periodStart: string
  periodEnd: string
  lineItems: PayslipLineItem[]
  cashAdvanceDeducted: number
}): Promise<{ payrollId: number | null; error: string | null }> {
  const grossPay = lineItems.reduce((sum, item) => sum + item.amount, 0)
  const allowanceAmount =
    lineItems.find((item) => item.description.startsWith('Daily allowance'))?.amount ?? 0
  const basePay = grossPay - allowanceAmount
  const netPay = grossPay - cashAdvanceDeducted

  const { data: payslip, error: payslipError } = await supabase
    .from('payroll_payslips')
    .insert({
      employee_id: employeeId,
      payroll_period_start: periodStart,
      payroll_period_end: periodEnd,
      gross_pay: grossPay,
      base_pay: basePay,
      allowance_amount: allowanceAmount,
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
