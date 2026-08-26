// AddExpenseModal: lets a driver log an expense against one specific trip.
// Same modal shell/style as ReportIssueModal -- form first, then a "done"
// confirmation state.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function AddExpenseModal({
  itineraryId,
  onClose,
}: {
  itineraryId: number
  onClose: () => void
}) {
  const { employeeId } = useAuth()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit() {
    const amountValue = Number(amount)
    if (!amount || amountValue <= 0) {
      setError('Enter an amount greater than 0.')
      return
    }
    if (!description.trim()) {
      setError('Enter a description for this expense.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase
      .from('itinerary_expenses')
      .insert({
        itinerary_id: itineraryId,
        employee_id: employeeId,
        amount: amountValue,
        description,
      })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        {done ? (
          <>
            <h3 className="text-lg font-bold text-slate-900">Expense added</h3>
            <p className="mt-3 text-sm text-slate-600">
              Your trip expense has been recorded.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-slate-900">Add Expense</h3>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-4 grid gap-4">
              <label className={labelClasses}>
                Amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Description
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Fuel, toll fee, parking..."
                  className={fieldClasses}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Add Expense'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AddExpenseModal
