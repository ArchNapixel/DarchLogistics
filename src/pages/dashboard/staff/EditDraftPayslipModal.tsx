// EditDraftPayslipModal: admin reviews/adjusts ONE auto-generated draft
// payslip before finalizing it (PayrollSection.tsx). Starts from what's
// saved on the draft -- its line items, cash advance deduction and
// government deductions -- and saves the changes back onto the same
// draft (lib/payslip.ts updateDraftPayslip). It does NOT recalculate pay
// from trips/attendance -- that's "Regenerate" on the Payroll page.
//
// "Auto" values: a line's auto amount is what the generator computed
// (recovered from an earlier "(adjusted by admin, auto: ₱X)" tag if it
// was already edited once); government deductions are recomputed live
// from the gross pay (lib/governmentContributions.ts), and any saved
// value that differs is shown as an admin override. Changed lines get
// tagged in their description and changed deductions are listed in
// deductions_note, so the payslip record shows what the admin changed.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  getOutstandingCashAdvance,
  loadEarlierPayslipsThisMonth,
  loadPayslipLineItems,
  totalEmployeeDeductions,
  updateDraftPayslip,
  type PayslipDeductions,
  type PayslipLineItem,
} from '../../../lib/payslip'
import {
  CONTRIBUTION_KEYS,
  computeWeeklyContributions,
  weeklyWithholdingTax,
  type ContributionKey,
  type EarlierPayslip,
} from '../../../lib/governmentContributions'

export type DraftToEdit = {
  payrollId: number
  employeeId: number
  employeeName: string
  periodStart: string
  periodEnd: string
  periodLabel: string
}

type DeductionKey = ContributionKey | 'withholding_tax'

// Rows of the deductions table: what comes out of the employee's pay
// (ee) and what the company pays on top (er).
const DEDUCTION_ROWS: { label: string; ee: DeductionKey | null; er: DeductionKey | null }[] = [
  { label: 'SSS', ee: 'sss_ee', er: 'sss_er' },
  { label: 'SSS EC', ee: null, er: 'sss_ec' },
  { label: 'PhilHealth', ee: 'philhealth_ee', er: 'philhealth_er' },
  { label: 'Pag-IBIG', ee: 'pagibig_ee', er: 'pagibig_er' },
  { label: 'Withholding tax (BIR)', ee: 'withholding_tax', er: null },
]

// One row of the editable breakdown. autoAmount is what the generator
// calculated (null for a line the admin added by hand); amount is the
// text in the input box.
type EditableLine = {
  itinerary_id: number | null
  description: string
  autoAmount: number | null
  amount: string
}

const roundPeso = (value: number) => Math.round(value * 100) / 100
const formatPeso = (value: number) =>
  `₱${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

const ADDED_TAG = / \(added by admin\)$/
const ADJUSTED_TAG = / \(adjusted by admin, auto: ₱([\d,.]+)\)$/

// Saved line -> editable line, stripping the tag a previous edit added
// so it isn't stacked twice.
function toEditableLine(item: PayslipLineItem): EditableLine {
  const amount = String(roundPeso(item.amount))
  if (ADDED_TAG.test(item.description)) {
    return { itinerary_id: item.itinerary_id, description: item.description.replace(ADDED_TAG, ''), autoAmount: null, amount }
  }
  const adjusted = ADJUSTED_TAG.exec(item.description)
  return {
    itinerary_id: item.itinerary_id,
    description: item.description.replace(ADJUSTED_TAG, ''),
    autoAmount: adjusted ? Number(adjusted[1].replace(/,/g, '')) : roundPeso(item.amount),
    amount,
  }
}

function EditDraftPayslipModal({
  draft,
  onClose,
  onSaved,
}: {
  draft: DraftToEdit
  onClose: () => void
  onSaved: () => void
}) {
  const periodEnd = draft.periodEnd
  const [lineItems, setLineItems] = useState<EditableLine[]>([])
  const [isMinimumWageEarner, setIsMinimumWageEarner] = useState(false)
  const [outstandingAdvance, setOutstandingAdvance] = useState(0)
  const [deductAmount, setDeductAmount] = useState('0')
  const [earlierThisMonth, setEarlierThisMonth] = useState<EarlierPayslip[]>([])
  // Admin-typed amounts, keyed by deduction; anything not in here uses
  // the auto value.
  const [deductionOverrides, setDeductionOverrides] = useState<Partial<Record<DeductionKey, string>>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadDraft() {
    const [payslipResult, employeeResult, linesResult, advanceResult, earlierResult] = await Promise.all([
      supabase
        .from('payroll_payslips')
        .select(`cash_advance_deducted, ${CONTRIBUTION_KEYS.join(', ')}, withholding_tax`)
        .eq('payroll_id', draft.payrollId)
        .single(),
      supabase.from('employees').select('is_minimum_wage_earner').eq('employee_id', draft.employeeId).single(),
      loadPayslipLineItems(draft.payrollId),
      getOutstandingCashAdvance(draft.employeeId),
      loadEarlierPayslipsThisMonth(draft.employeeId, periodEnd),
    ])

    const loadError =
      payslipResult.error?.message ??
      employeeResult.error?.message ??
      linesResult.error ??
      advanceResult.error ??
      earlierResult.error
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    const saved = payslipResult.data as unknown as Record<DeductionKey | 'cash_advance_deducted', number>
    const lines = linesResult.lineItems.map(toEditableLine)
    const isMwe = employeeResult.data!.is_minimum_wage_earner

    // Anything saved that differs from what the formulas give now was
    // an admin override last time -- keep showing it as one.
    const gross = lines.reduce((sum, line) => sum + Number(line.amount), 0)
    const auto = computeWeeklyContributions(gross, periodEnd, earlierResult.payslips)
    const overrides: Partial<Record<DeductionKey, string>> = {}
    for (const key of CONTRIBUTION_KEYS) {
      if (roundPeso(saved[key]) !== roundPeso(auto[key])) overrides[key] = String(saved[key])
    }
    const employeeShares =
      saved.sss_ee + saved.philhealth_ee + saved.pagibig_ee
    const autoTax = isMwe ? 0 : weeklyWithholdingTax(gross - employeeShares)
    if (roundPeso(saved.withholding_tax) !== roundPeso(autoTax)) {
      overrides.withholding_tax = String(saved.withholding_tax)
    }

    setLineItems(lines)
    setIsMinimumWageEarner(isMwe)
    // The draft's own deduction is already subtracted from the
    // outstanding balance -- add it back so it can be re-chosen.
    setOutstandingAdvance(advanceResult.outstanding + saved.cash_advance_deducted)
    setDeductAmount(String(saved.cash_advance_deducted))
    setEarlierThisMonth(earlierResult.payslips)
    setDeductionOverrides(overrides)
    setLoading(false)
  }

  function updateLine(index: number, changes: Partial<EditableLine>) {
    setLineItems((lines) => lines.map((line, i) => (i === index ? { ...line, ...changes } : line)))
  }

  function addManualLine() {
    setLineItems((lines) => [...lines, { itinerary_id: null, description: '', autoAmount: null, amount: '' }])
  }

  function removeLine(index: number) {
    setLineItems((lines) => lines.filter((_, i) => i !== index))
  }

  const grossPay = lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const deductValue = Number(deductAmount) || 0

  // Government deductions: auto values from the current gross, then the
  // admin's overrides on top. Tax is worked out from the EFFECTIVE
  // employee shares (contributions aren't taxable), so overriding e.g.
  // SSS updates the auto tax too.
  const contributions = computeWeeklyContributions(grossPay, periodEnd, earlierThisMonth)
  const effectiveValue = (key: DeductionKey, auto: number) => {
    const override = deductionOverrides[key]
    return override !== undefined ? Number(override) || 0 : auto
  }
  const effectiveEmployeeShares =
    effectiveValue('sss_ee', contributions.sss_ee) +
    effectiveValue('philhealth_ee', contributions.philhealth_ee) +
    effectiveValue('pagibig_ee', contributions.pagibig_ee)
  const autoDeductions: Record<DeductionKey, number> = {
    sss_ee: contributions.sss_ee,
    sss_er: contributions.sss_er,
    sss_ec: contributions.sss_ec,
    philhealth_ee: contributions.philhealth_ee,
    philhealth_er: contributions.philhealth_er,
    pagibig_ee: contributions.pagibig_ee,
    pagibig_er: contributions.pagibig_er,
    withholding_tax: isMinimumWageEarner ? 0 : weeklyWithholdingTax(grossPay - effectiveEmployeeShares),
  }
  const deductions = Object.fromEntries(
    (Object.keys(autoDeductions) as DeductionKey[]).map((key) => [
      key,
      roundPeso(effectiveValue(key, autoDeductions[key])),
    ]),
  ) as Record<DeductionKey, number>

  const netPay = grossPay - deductValue - totalEmployeeDeductions(deductions)

  async function handleSubmit() {
    if (deductValue < 0 || deductValue > outstandingAdvance) {
      setError(
        `Cash advance deduction must be between 0 and the outstanding balance (₱${outstandingAdvance.toLocaleString()}).`,
      )
      return
    }
    if (lineItems.length === 0) {
      setError('A payslip needs at least one line.')
      return
    }
    for (const line of lineItems) {
      if (line.autoAmount === null && !line.description.trim()) {
        setError('Enter a description for every line you added.')
        return
      }
      if (line.amount.trim() === '' || !(Number(line.amount) >= 0)) {
        setError(`Enter an amount of 0 or more for "${line.description || 'the new line'}".`)
        return
      }
    }
    for (const value of Object.values(deductionOverrides)) {
      if (value.trim() === '' || !Number.isFinite(Number(value))) {
        setError('Enter a number for every government deduction you changed.')
        return
      }
    }
    if (netPay < 0) {
      setError('Deductions are more than the gross pay -- lower the cash advance or a deduction.')
      return
    }

    // Record which deductions the admin changed, with the auto value.
    const overrideNotes = DEDUCTION_ROWS.flatMap((row) =>
      (['ee', 'er'] as const).flatMap((side) => {
        const key = row[side]
        if (!key || deductions[key] === roundPeso(autoDeductions[key])) return []
        const who = side === 'ee' ? 'employee' : 'employer'
        return [`${row.label} (${who}): auto ${formatPeso(roundPeso(autoDeductions[key]))}`]
      }),
    )
    const payslipDeductions: PayslipDeductions = {
      ...deductions,
      sss_msc: contributions.sss_msc,
      deductions_note: overrideNotes.length > 0 ? `Adjusted by admin -- ${overrideNotes.join('; ')}` : null,
    }

    // Final line items as they'll be saved -- overridden amounts and
    // manual lines get tagged in the description so the payslip itself
    // shows what the admin changed.
    const finalLineItems = lineItems.map((line) => {
      const amount = Number(line.amount)
      let description = line.description.trim()
      if (line.autoAmount === null) {
        description += ' (added by admin)'
      } else if (roundPeso(amount) !== line.autoAmount) {
        description += ` (adjusted by admin, auto: ${formatPeso(line.autoAmount)})`
      }
      return { itinerary_id: line.itinerary_id, description, amount }
    })

    setSubmitting(true)
    setError(null)

    const { error: saveError } = await updateDraftPayslip(draft.payrollId, {
      lineItems: finalLineItems,
      cashAdvanceDeducted: deductValue,
      deductions: payslipDeductions,
    })

    setSubmitting(false)

    if (saveError) {
      setError(saveError)
      return
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Edit Draft Payslip</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {draft.employeeName} · {draft.periodLabel}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-4 text-slate-500">Loading...</p>
        ) : (
          <>
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                Breakdown
              </h4>

              {loading && (
                <p className="mt-3 text-sm text-slate-500">Calculating...</p>
              )}

              {!loading && lineItems.length === 0 && (
                <p className="mt-3 text-sm text-slate-500">
                  Nothing to pay for this period yet.
                </p>
              )}

              {!loading && (
                <div className="mt-3 flex flex-col gap-2 text-sm">
                  {lineItems.map((item, index) => {
                    const isAdjusted =
                      item.autoAmount !== null && roundPeso(Number(item.amount) || 0) !== item.autoAmount

                    return (
                      <div key={index} className="flex items-start justify-between gap-3">
                        {item.autoAmount === null ? (
                          <input
                            type="text"
                            placeholder="e.g. Bonus, correction"
                            aria-label="Line description"
                            value={item.description}
                            onChange={(e) => updateLine(index, { description: e.target.value })}
                            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-slate-900 focus:border-slate-500 focus:outline-none"
                          />
                        ) : (
                          <span className="flex-1 text-slate-600">
                            {item.description}
                            {isAdjusted && (
                              <span className="mt-0.5 block text-xs text-amber-700">
                                Adjusted — auto was {formatPeso(item.autoAmount!)}{' '}
                                <button
                                  type="button"
                                  onClick={() => updateLine(index, { amount: String(item.autoAmount) })}
                                  className="underline hover:text-amber-900"
                                >
                                  Reset
                                </button>
                              </span>
                            )}
                          </span>
                        )}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label="Amount"
                          value={item.amount}
                          onChange={(e) => updateLine(index, { amount: e.target.value })}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right font-medium text-slate-900 focus:border-slate-500 focus:outline-none"
                        />
                        {item.autoAmount === null && (
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            aria-label="Remove line"
                            className="py-1 text-slate-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )
                  })}
                  <button
                    type="button"
                    onClick={addManualLine}
                    className="self-start text-sm font-medium text-slate-600 hover:text-slate-900"
                  >
                    + Add line
                  </button>
                  {lineItems.length > 0 && (
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
                      <span>Gross pay</span>
                      <span>{formatPeso(grossPay)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {!loading && lineItems.length > 0 && (
              <div className="mt-6 border-t border-slate-200 pt-4">
                <h4 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  Government deductions
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  This week's share of the month, based on projected monthly pay of{' '}
                  {formatPeso(contributions.projectedMonthlyPay)} (SSS MSC{' '}
                  {formatPeso(contributions.sss_msc)}). The month's last payslip settles the
                  exact amount.
                  {isMinimumWageEarner && ' Minimum wage earner — no withholding tax.'}
                </p>
                <div className="mt-3 grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-x-2 gap-y-2 text-sm">
                  <span />
                  <span className="text-right text-xs font-medium text-slate-500">Employee</span>
                  <span className="text-right text-xs font-medium text-slate-500">Employer</span>
                  {DEDUCTION_ROWS.map((row) => (
                    <div key={row.label} className="contents">
                      <span className="text-slate-600">{row.label}</span>
                      {([row.ee, row.er] as const).map((key, i) =>
                        key ? (
                          <input
                            key={key}
                            type="number"
                            step="0.01"
                            aria-label={`${row.label} ${i === 0 ? 'employee' : 'employer'} share`}
                            value={deductionOverrides[key] ?? String(deductions[key])}
                            onChange={(e) =>
                              setDeductionOverrides((overrides) => ({ ...overrides, [key]: e.target.value }))
                            }
                            className={`w-full rounded-lg border px-2 py-1 text-right text-slate-900 focus:border-slate-500 focus:outline-none ${
                              deductions[key] !== roundPeso(autoDeductions[key])
                                ? 'border-amber-400 bg-amber-50'
                                : 'border-slate-300'
                            }`}
                          />
                        ) : (
                          <span key={i} className="text-right text-slate-400">—</span>
                        ),
                      )}
                    </div>
                  ))}
                </div>
                {Object.keys(deductionOverrides).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setDeductionOverrides({})}
                    className="mt-2 text-xs font-medium text-amber-700 underline hover:text-amber-900"
                  >
                    Reset deductions to auto
                  </button>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-medium text-slate-900">
                  <span>Total deducted from employee</span>
                  <span>-{formatPeso(totalEmployeeDeductions(deductions))}</span>
                </div>
              </div>
            )}

            <div className="mt-6 rounded-lg bg-slate-50 p-4">
              <h4 className="font-medium text-slate-900">Cash advance</h4>
              <p className="mt-1 text-sm text-slate-500">
                Outstanding balance: ₱{outstandingAdvance.toLocaleString()}
              </p>
              <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
                Deduct this payslip (optional)
                <input
                  type="number"
                  min="0"
                  max={outstandingAdvance}
                  step="0.01"
                  value={deductAmount}
                  onChange={(e) => setDeductAmount(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
              <span className="font-medium text-slate-700">Net pay</span>
              <span className="text-lg font-bold text-slate-900">
                {formatPeso(netPay)}
              </span>
            </div>
          </>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || loading || lineItems.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save Draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EditDraftPayslipModal
