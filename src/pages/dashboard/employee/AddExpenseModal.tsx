// AddExpenseModal: lets a driver log an expense against one specific trip
// (the canvas's "Add Expense" board): amount, category (Fuel / Toll /
// Parking / Other) and a description. Saved to itinerary_expenses; shows
// on the trip card and in the booking for staff.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { formatMoney } from '../../../lib/format'
import { showToast } from '../../../components/Toast'

const CATEGORIES = ['Fuel', 'Toll', 'Parking', 'Other'] as const

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const labelClasses = 'flex justify-between gap-2 text-sm font-semibold text-ink'

function AddExpenseModal({
  itineraryId,
  spentSoFar,
  onClose,
}: {
  itineraryId: number
  // This driver's expenses on the trip so far.
  spentSoFar: number
  onClose: () => void
}) {
  const { employeeId } = useAuth()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  // No default on purpose: the dashboard counts "Fuel" as real diesel cost,
  // so the driver has to pick it deliberately.
  const [category, setCategory] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!employeeId) {
      setError('Your account is not linked to an employee record. Ask an admin to fix it.')
      return
    }
    const parsed = parseAmount(amount)
    if (parsed.value === null) {
      setError(parsed.error ?? 'Enter an amount greater than 0.')
      return
    }
    if (!category) {
      setError('Pick a category for this expense.')
      return
    }
    if (!description.trim()) {
      setError('Enter a description for this expense.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('itinerary_expenses').insert({
      itinerary_id: itineraryId,
      employee_id: employeeId,
      amount: parsed.value,
      category,
      description: description.trim(),
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    showToast(`Expense of ${formatMoney(parsed.value)} added to trip #${itineraryId}.`)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="expense-title" className="card w-full max-w-[560px]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="expense-title" className="text-xl leading-7 font-bold text-ink">
              Add Expense · Trip #{itineraryId}
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">Your expenses on this trip so far: {formatMoney(spentSoFar)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>

        <form
          className="flex flex-col gap-4 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmit()
          }}
        >
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <label className="flex max-w-60 flex-col gap-1.5">
            <span className={labelClasses}>
              <span>Amount (₱)</span>
              <span className="text-xs text-amber-800">Required</span>
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(filterAmountInput(e.target.value))}
              placeholder="0.00"
              className={`${fieldClasses} text-right tabular-nums`}
            />
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className={`${labelClasses} w-full pb-1.5`}>
              <span>Category</span>
              <span className="text-xs text-amber-800">Required</span>
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CATEGORIES.map((option) => (
                <label
                  key={option}
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 px-2.5 text-sm font-semibold text-ink ${
                    category === option ? 'border-2 border-primary bg-primary-soft' : 'border border-line-control'
                  }`}
                >
                  <input
                    type="radio"
                    name="expense-category"
                    value={option}
                    checked={category === option}
                    onChange={() => setCategory(option)}
                    className="h-[18px] w-[18px] accent-primary"
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className={labelClasses}>Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              placeholder="e.g. Diesel refill at Panabo, toll at the bypass"
              className={fieldClasses}
            />
          </label>

          <p className="border border-line bg-slate-50 px-3.5 py-3 text-[13px] leading-[18px] text-ink-secondary">
            Shows on your trip card and in the booking for staff.
          </p>
        </form>

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="btn-primary px-6 text-sm">
            {submitting ? 'Saving...' : 'Add Expense'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default AddExpenseModal
