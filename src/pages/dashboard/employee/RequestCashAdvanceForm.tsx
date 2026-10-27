// RequestCashAdvanceForm: the "Request Cash Advance" card on My Payslips
// (Driver/Mechanic/Helper -- not the Dispatcher's payslip page). Amount +
// reason, inserted into cash_advances with status 'Pending' -- staff then
// Approve/Reject it on the Cash Advance page (staff/CashAdvanceRequestsSection.tsx).
// Doesn't touch the admin's direct-issue flow (IssueCashAdvanceModal.tsx),
// which still creates an already-approved row with no request step. Also
// says what the employee still owes and how much each payslip deducts.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { requestCashAdvance } from '../../../lib/cashAdvanceRequests'
import { getOutstandingCashAdvance, loadCashAdvanceDeductionRate, DEFAULT_CASH_ADVANCE_DEDUCTION_RATE } from '../../../lib/payslip'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { showToast } from '../../../components/Toast'
import { formatMoney } from '../../../lib/format'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'

function RequestCashAdvanceForm({ onRequested }: { onRequested: () => void }) {
  const { employeeId } = useAuth()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What the employee still owes (counts finalized payslips only -- they
  // can't see drafts), and the share of each payslip that pays it off.
  const [owed, setOwed] = useState(0)
  const [rate, setRate] = useState(DEFAULT_CASH_ADVANCE_DEDUCTION_RATE)

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    void Promise.all([getOutstandingCashAdvance(employeeId), loadCashAdvanceDeductionRate()]).then(([o, r]) => {
      if (cancelled) return
      setOwed(o.outstanding)
      setRate(r)
    })
    return () => {
      cancelled = true
    }
  }, [employeeId])

  async function handleSubmit() {
    const parsed = parseAmount(amount)
    if (parsed.value === null) {
      setError(parsed.error ?? 'Enter a valid amount.')
      return
    }
    if (!reason.trim()) {
      setError('Enter a reason for this request.')
      return
    }
    if (!employeeId) {
      setError('Could not determine your employee record. Contact an admin.')
      return
    }

    setSubmitting(true)
    setError(null)
    const { error: requestError } = await requestCashAdvance({ employeeId, amount: parsed.value, reason: reason.trim() })
    setSubmitting(false)
    if (requestError) {
      setError(requestError)
      return
    }

    setAmount('')
    setReason('')
    showToast('Your cash advance request was submitted.')
    onRequested()
  }

  return (
    <section aria-labelledby="cash-advance-h" className="card flex flex-col">
      <h2 id="cash-advance-h" className="border-b border-line px-5 py-4 text-base font-semibold text-ink">
        Request Cash Advance
      </h2>
      <form
        className="flex flex-col gap-3.5 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
      >
        {error && <p className="bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {owed > 0 && (
          <p className="bg-slate-50 px-3 py-2 text-sm text-ink-secondary">
            You still owe <span className="font-semibold text-primary">{formatMoney(owed)}</span>.
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Amount (₱)</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(filterAmountInput(e.target.value))}
            placeholder="0.00"
            className={`${fieldClasses} tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Emergency" className={fieldClasses} />
        </label>
        <p className="text-[13px] leading-[18px] text-ink-muted">
          Once Admin approves, {rate}% of each payslip's gross pay is deducted until it's paid off.
        </p>
        <button type="submit" disabled={submitting} className="btn-primary px-5 text-sm">
          {submitting ? 'Sending...' : 'Send Request'}
        </button>
      </form>
    </section>
  )
}

export default RequestCashAdvanceForm
