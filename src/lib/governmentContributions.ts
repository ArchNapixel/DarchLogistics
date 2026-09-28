// governmentContributions: pure math for SSS / PhilHealth / Pag-IBIG
// contributions and BIR withholding tax on a WEEKLY payslip. No
// Supabase calls in here -- payslip.ts loads the data, EditDraftPayslipModal
// shows/edits the result. Rates are the 2026 rules; when a government
// agency changes them, this is the only file to update.
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

// --- Rate tables (2026) -------------------------------------------------

// SSS (RA 11199 schedule, 15% total since 2025): MSC ₱5,000-₱35,000 in
// ₱500 steps. EE 5%, ER 10% of the whole MSC (the part above ₱20,000
// goes to the MPF / MySSS Pension Booster -- same rate, reporting only).
// EC is employer-only: ₱10 below ₱15,000 MSC, ₱30 from ₱15,000.
const SSS_MSC_MIN = 5_000
const SSS_MSC_MAX = 35_000
const SSS_EE_RATE = 0.05
const SSS_ER_RATE = 0.1

// PhilHealth (2026): 5% of monthly basic salary, floor ₱10,000, ceiling
// ₱100,000, split 50/50 -> ₱250 to ₱2,500 each.
const PHILHEALTH_FLOOR = 10_000
const PHILHEALTH_CEILING = 100_000
const PHILHEALTH_SHARE_RATE = 0.025

// Pag-IBIG (HDMF Circular 460, since Feb 2024): fund salary capped at
// ₱10,000. ER 2%; EE 2%, or 1% if salary is ₱1,500 or less. Max ₱200 each.
const PAGIBIG_MAX_FUND_SALARY = 10_000
const PAGIBIG_LOW_SALARY = 1_500

// BIR weekly withholding tax table (TRAIN law, Jan 1 2023 onwards):
// [over, fixed tax, rate on the excess over `over`].
const WEEKLY_TAX_BRACKETS: [number, number, number][] = [
  [153_846, 42_355.65, 0.35],
  [38_462, 7_740.45, 0.3],
  [15_385, 1_971.2, 0.25],
  [7_692, 432.6, 0.2],
  [4_808, 0, 0.15],
]

// --- Monthly formulas ---------------------------------------------------

const round2 = (value: number) => Math.round(value * 100) / 100

export function sssMonthly(monthlyPay: number) {
  // Nearest ₱500 with halves rounding up = the SSS bracket table
  // (e.g. ₱5,250-₱5,749.99 -> ₱5,500).
  const msc = Math.min(SSS_MSC_MAX, Math.max(SSS_MSC_MIN, Math.round(monthlyPay / 500) * 500))
  return {
    msc,
    ee: round2(msc * SSS_EE_RATE),
    er: round2(msc * SSS_ER_RATE),
    ec: msc < 15_000 ? 10 : 30,
  }
}

export function philhealthMonthly(monthlyPay: number) {
  const basis = Math.min(PHILHEALTH_CEILING, Math.max(PHILHEALTH_FLOOR, monthlyPay))
  const share = round2(basis * PHILHEALTH_SHARE_RATE)
  return { ee: share, er: share }
}

export function pagibigMonthly(monthlyPay: number) {
  const fundSalary = Math.min(PAGIBIG_MAX_FUND_SALARY, monthlyPay)
  return {
    ee: round2(fundSalary * (monthlyPay <= PAGIBIG_LOW_SALARY ? 0.01 : 0.02)),
    er: round2(fundSalary * 0.02),
  }
}

export function weeklyWithholdingTax(weeklyTaxablePay: number) {
  const bracket = WEEKLY_TAX_BRACKETS.find(([over]) => weeklyTaxablePay > over)
  if (!bracket) return 0
  const [over, fixed, rate] = bracket
  return round2(fixed + (weeklyTaxablePay - over) * rate)
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
): Contributions & { sss_msc: number; projectedMonthlyPay: number } {
  const n = payslipsInMonth(periodEnd)
  const k = earlierThisMonth.length + 1
  const weeksCounted = Math.min(k, n)
  const monthGross = earlierThisMonth.reduce((sum, p) => sum + p.gross_pay, weekGross)
  const projectedMonthlyPay = k >= n ? monthGross : (monthGross / k) * n

  const sss = sssMonthly(projectedMonthlyPay)
  const philhealth = philhealthMonthly(projectedMonthlyPay)
  const pagibig = pagibigMonthly(projectedMonthlyPay)
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
