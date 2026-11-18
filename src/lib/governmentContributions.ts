// governmentContributions: pure math for SSS / PhilHealth / Pag-IBIG
// contributions and BIR withholding tax on a WEEKLY payslip. No
// Supabase calls in here -- payslip.ts loads the data, EditDraftPayslipModal
// shows/edits the result. The rates themselves are rows in the
// `government_rates` table -- when an agency changes them, add a new row
// with the date they start (no code change).
//
// Contributions are MONTHLY amounts, but payslips are weekly, so each
// weekly payslip takes its share and the month corrects itself:
// 1. A payslip belongs to the month its period END falls in. That month
//    has N weekly payslips (one per Saturday -- 4 or 5).
// 2. This is payslip k of the month (k = earlier payslips this month + 1).
//    Month's pay so far is projected to a full month:
//    (gross so far / k) x N. On the last one (k >= N) it's the real total.
// 3. Monthly contribution on that projection x k/N = what should have
//    been deducted by now. This payslip deducts that minus what earlier
//    payslips this month already deducted -- so the month's total
//    always ends up exact, even when a driver's weekly pay swings. (It
//    can go slightly negative = a refund, if pay dropped late in the
//    month.)
// Employer (ER) shares follow the same steps -- never deducted from the
// employee, just stored per payslip for remittance reports.

// --- Rate tables ---------------------------------------------------------

// The rates live in the `government_rates` table (one row per date they
// take effect from) -- loadGovernmentRates() in payslip.ts reads them.
// Rates are PERCENT (5 = 5%). A tax bracket: tax = fixed + (pay - over) x
// rate%, for the highest `over` the pay is above.
export type TaxBracket = { over: number; fixed: number; rate: number }
export type GovernmentRates = {
  effective_from: string
  // SSS: MSC = pay rounded to the nearest step, kept between min and max.
  // EC (employer only): low below the threshold MSC, high from it.
  sss_msc_min: number
  sss_msc_max: number
  sss_msc_step: number
  sss_ee_rate: number
  sss_er_rate: number
  sss_ec_threshold: number
  sss_ec_low: number
  sss_ec_high: number
  philhealth_floor: number
  philhealth_ceiling: number
  philhealth_ee_rate: number
  philhealth_er_rate: number
  pagibig_salary_cap: number
  pagibig_low_salary: number
  pagibig_ee_rate_low: number
  pagibig_ee_rate: number
  pagibig_er_rate: number
  weekly_tax_brackets: TaxBracket[]
}

// The rate set in force on a YYYY-MM-DD date: the latest one that took
// effect on or before it. null = none (date before the first row).
export function ratesFor(sets: GovernmentRates[], date: string): GovernmentRates | null {
  let best: GovernmentRates | null = null
  for (const set of sets) {
    if (set.effective_from <= date && (!best || set.effective_from > best.effective_from)) best = set
  }
  return best
}

// --- Monthly formulas ---------------------------------------------------

const round2 = (value: number) => Math.round(value * 100) / 100
const pct = (rate: number) => rate / 100

export function sssMonthly(monthlyPay: number, r: GovernmentRates) {
  // Nearest step with halves rounding up = the SSS bracket table
  // (e.g. ₱5,250-₱5,749.99 -> ₱5,500 with a ₱500 step).
  const stepped = Math.round(monthlyPay / r.sss_msc_step) * r.sss_msc_step
  const msc = Math.min(r.sss_msc_max, Math.max(r.sss_msc_min, stepped))
  return {
    msc,
    ee: round2(msc * pct(r.sss_ee_rate)),
    er: round2(msc * pct(r.sss_er_rate)),
    ec: msc < r.sss_ec_threshold ? r.sss_ec_low : r.sss_ec_high,
  }
}

export function philhealthMonthly(monthlyPay: number, r: GovernmentRates) {
  const basis = Math.min(r.philhealth_ceiling, Math.max(r.philhealth_floor, monthlyPay))
  return { ee: round2(basis * pct(r.philhealth_ee_rate)), er: round2(basis * pct(r.philhealth_er_rate)) }
}

export function pagibigMonthly(monthlyPay: number, r: GovernmentRates) {
  const fundSalary = Math.min(r.pagibig_salary_cap, monthlyPay)
  const eeRate = monthlyPay <= r.pagibig_low_salary ? r.pagibig_ee_rate_low : r.pagibig_ee_rate
  return {
    ee: round2(fundSalary * pct(eeRate)),
    er: round2(fundSalary * pct(r.pagibig_er_rate)),
  }
}

export function weeklyWithholdingTax(weeklyTaxablePay: number, r: GovernmentRates) {
  const bracket = [...r.weekly_tax_brackets]
    .sort((a, b) => b.over - a.over)
    .find(({ over }) => weeklyTaxablePay > over)
  if (!bracket) return 0
  return round2(bracket.fixed + (weeklyTaxablePay - bracket.over) * pct(bracket.rate))
}

// --- Weekly payslip share -----------------------------------------------

// The per-payslip columns stored on payroll_payslips.
export const CONTRIBUTION_KEYS = [
  'sss_ee',
  'sss_er',
  'sss_ec',
  'philhealth_ee',
  'philhealth_er',
  'pagibig_ee',
  'pagibig_er',
] as const
export type ContributionKey = (typeof CONTRIBUTION_KEYS)[number]
export type Contributions = Record<ContributionKey, number>

// An earlier payslip in the same month -- its gross and what it already
// deducted/recorded.
export type EarlierPayslip = Contributions & { gross_pay: number }

// Saturdays in the month of a YYYY-MM-DD date = weekly payslips that month.
export function payslipsInMonth(periodEnd: string) {
  const [year, month] = periodEnd.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  let saturdays = 0
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 6) saturdays++
  }
  return saturdays
}

export function computeWeeklyContributions(
  weekGross: number,
  periodEnd: string,
  earlierThisMonth: EarlierPayslip[],
  rates: GovernmentRates,
): Contributions & { sss_msc: number; projectedMonthlyPay: number } {
  const n = payslipsInMonth(periodEnd)
  const k = earlierThisMonth.length + 1
  const weeksCounted = Math.min(k, n)
  const monthGross = earlierThisMonth.reduce((sum, p) => sum + p.gross_pay, weekGross)
  const projectedMonthlyPay = k >= n ? monthGross : (monthGross / k) * n

  const sss = sssMonthly(projectedMonthlyPay, rates)
  const philhealth = philhealthMonthly(projectedMonthlyPay, rates)
  const pagibig = pagibigMonthly(projectedMonthlyPay, rates)
  const monthly: Contributions = {
    sss_ee: sss.ee,
    sss_er: sss.er,
    sss_ec: sss.ec,
    philhealth_ee: philhealth.ee,
    philhealth_er: philhealth.er,
    pagibig_ee: pagibig.ee,
    pagibig_er: pagibig.er,
  }

  const thisWeek = {} as Contributions
  for (const key of CONTRIBUTION_KEYS) {
    const alreadyDeducted = earlierThisMonth.reduce((sum, p) => sum + p[key], 0)
    thisWeek[key] = round2((monthly[key] * weeksCounted) / n - alreadyDeducted)
  }

  return { ...thisWeek, sss_msc: sss.msc, projectedMonthlyPay: round2(projectedMonthlyPay) }
}
