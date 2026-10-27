// BillingCharges: "Additional charges" on the Billing page (the canvas's
// "Add Charge") -- the booking's extra charges added by hand (waiting time,
// an extra drop, a re-delivery...). Lists them, adds one (description +
// amount), and voids a wrong one (reason required; it stays listed, struck
// through). Approved Client damage is NOT listed here: it comes from Damage
// Charges and is already part of the bill. Saved through lib/bookingCharges.ts;
// `onChanged` tells the page to reload the bill's totals. Not printed.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { addBookingCharge, loadBookingCharges, voidBookingCharge, type BookingCharge } from '../../../lib/bookingCharges'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { promptDialog } from '../../../components/ConfirmDialog'
import { formatDate, formatMoney } from '../../../lib/format'

function BillingCharges({ bookingId, onChanged }: { bookingId: number; onChanged: () => void }) {
  const { employeeId } = useAuth()
  const [charges, setCharges] = useState<BookingCharge[] | null>(null)
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadBookingCharges(bookingId).then((result) => {
      if (cancelled) return
      setCharges(result.charges)
      if (result.error) setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [bookingId, reloadKey])

  async function add() {
    const parsed = parseAmount(amount)
    if (parsed.value === null) return setError(parsed.error ?? 'Enter a valid amount.')
    setSaving(true)
    setError(null)
    const problem = await addBookingCharge({ bookingId, description, amount: parsed.value, createdBy: employeeId })
    setSaving(false)
    if (problem) return setError(problem)
    setDescription('')
    setAmount('')
    setReloadKey((k) => k + 1)
    onChanged()
  }

  async function voidCharge(charge: BookingCharge) {
    const reason = await promptDialog({
      title: 'Void this charge?',
      message: `"${charge.description}" (${formatMoney(charge.amount)}) stays on record but stops counting toward the bill. Why is it being voided?`,
      confirmLabel: 'Void charge',
      danger: true,
    })
    if (reason === null) return
    const problem = await voidBookingCharge(charge.charge_id, reason, employeeId)
    if (problem) return setError(problem)
    setReloadKey((k) => k + 1)
    onChanged()
  }

  const field =
    'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm text-ink-metric placeholder:text-ink-muted focus:border-primary'
  const active = (charges ?? []).filter((c) => !c.voided_at)

  return (
    <section aria-labelledby="charges-h" className="mt-6 border-t border-line pt-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="charges-h" className="text-sm font-semibold text-ink">
          Additional charges
        </h3>
        <span className="text-[13px] text-ink-muted">
          {active.length > 0 ? `${formatMoney(active.reduce((sum, c) => sum + c.amount, 0))} added` : 'None added'}
        </span>
      </div>

      {charges && charges.length > 0 && (
        <ul className="mt-2 text-sm">
          {charges.map((c) => (
            <li key={c.charge_id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 py-2 ${c.voided_at ? 'text-ink-muted' : ''}`}>
              <span className={`flex-1 ${c.voided_at ? 'line-through' : ''}`}>{c.description}</span>
              <span className="text-[13px] text-ink-muted">{formatDate(c.created_at)}</span>
              <span className={`font-semibold tabular-nums ${c.voided_at ? 'line-through' : ''}`}>{formatMoney(c.amount)}</span>
              {c.voided_at ? (
                <span className="w-full text-[13px]">Voided: {c.void_reason}</span>
              ) : (
                <button type="button" onClick={() => voidCharge(c)} className="btn-danger px-3 text-sm">
                  Void
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[13px] text-ink-muted">
        Damage charged to the client (Damage Charges page) is already on the bill above and isn&apos;t listed here.
      </p>

      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium text-ink-secondary">
          What it&apos;s for
          <input
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Waiting time at the port, 3 hours"
            className={field}
          />
        </label>
        <label className="flex w-40 flex-col gap-1.5 text-sm font-medium text-ink-secondary">
          Amount (₱)
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(filterAmountInput(e.target.value))}
            placeholder="0.00"
            className={`${field} tabular-nums`}
          />
        </label>
        <button type="submit" disabled={saving} className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14 M5 12h14" />
          </svg>
          {saving ? 'Adding...' : 'Add Charge'}
        </button>
      </form>
      {error && <p className="mt-2 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
  )
}

export default BillingCharges
