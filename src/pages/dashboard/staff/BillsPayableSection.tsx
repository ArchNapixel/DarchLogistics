// BillsPayableSection (Admin, Accounting -> Bills Payable): what the company
// owes and spends. A bill is money owed to a creditor (whoever the company
// buys from or pays: parts store, fuel depot, landlord...); a one-off expense is
// a bill marked "already paid" when it's entered. Tabs: Open (unpaid /
// partly paid, soonest due first, overdue in red), Paid, Voided, Creditors.
// Payments can be partial; a wrong payment or bill is voided (reason
// required), never deleted. All writes go through lib/payables.ts; status
// rules and the card totals are in lib/payableTotals.ts.
import { useEffect, useState } from 'react'
import {
  createBill,
  loadBills,
  loadCreditors,
  recordBillPayment,
  saveCreditor,
  voidBill,
  voidBillPayment,
  type Bill,
  type Creditor,
} from '../../../lib/payables'
import {
  BILL_CATEGORIES,
  billRemaining,
  billStatus,
  isOverdue,
  summarizeOpenBills,
  type BillStatus,
} from '../../../lib/payableTotals'
import { PAYMENT_METHODS } from '../../../lib/bookingPayments'
import { toManilaDate } from '../../../lib/payslip'
import { formatDate } from '../../../lib/quoteRequest'
import { promptDialog } from '../../../components/ConfirmDialog'

function formatMoney(value: number): string {
  return `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_STYLES: Record<BillStatus, string> = {
  Unpaid: 'bg-amber-100 text-amber-800',
  Partial: 'bg-blue-100 text-blue-700',
  Paid: 'bg-green-100 text-green-700',
  Voided: 'bg-slate-100 text-slate-500',
}

type Tab = 'open' | 'paid' | 'voided' | 'creditors'

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900'
const labelClass = 'block text-xs font-medium text-slate-600'

function BillsPayableSection() {
  const today = toManilaDate(new Date())
  const [tab, setTab] = useState<Tab>('open')
  const [bills, setBills] = useState<Bill[]>([])
  const [creditors, setCreditors] = useState<Creditor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [openBillId, setOpenBillId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState<Bill | null>(null)
  const [editingCreditor, setEditingCreditor] = useState<Creditor | 'new' | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [billResult, creditorResult] = await Promise.all([loadBills(), loadCreditors()])
    const loadError = billResult.error ?? creditorResult.error
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }
    setBills(billResult.bills)
    setCreditors(creditorResult.creditors)
    setError(null)
    setLoading(false)
  }

  async function handleVoidBill(bill: Bill) {
    const reason = await promptDialog({
      title: `Void bill #${bill.bill_id}`,
      message: `${bill.description} (${formatMoney(bill.amount)}). It stays on record but stops counting. Why is it being voided?`,
      confirmLabel: 'Void bill',
      danger: true,
    })
    if (reason === null) return
    if (!reason.trim()) {
      setActionError('Enter a reason to void a bill.')
      return
    }
    setActionError(null)
    const voidError = await voidBill(bill.bill_id, reason)
    if (voidError) {
      setActionError(voidError)
      return
    }
    load()
  }

  async function handleVoidPayment(bill: Bill, paymentId: number, amount: number) {
    const reason = await promptDialog({
      title: 'Void payment',
      message: `${formatMoney(amount)} paid on bill #${bill.bill_id}. The bill's balance goes back up. Why is it being voided?`,
      confirmLabel: 'Void payment',
      danger: true,
    })
    if (reason === null) return
    if (!reason.trim()) {
      setActionError('Enter a reason to void a payment.')
      return
    }
    setActionError(null)
    const voidError = await voidBillPayment(paymentId, reason)
    if (voidError) {
      setActionError(voidError)
      return
    }
    load()
  }

  const byTab = (t: Tab) =>
    bills.filter((b) => {
      const status = billStatus(b)
      if (t === 'open') return status === 'Unpaid' || status === 'Partial'
      if (t === 'paid') return status === 'Paid'
      return status === 'Voided'
    })
  // Open bills: soonest due first (no due date last); the others newest first.
  const visible =
    tab === 'open'
      ? [...byTab('open')].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
      : byTab(tab)
  const totals = summarizeOpenBills(bills, today)

  const tabs: [Tab, string][] = [
    ['open', `Open (${byTab('open').length})`],
    ['paid', `Paid (${byTab('paid').length})`],
    ['voided', `Voided (${byTab('voided').length})`],
    ['creditors', `Creditors (${creditors.length})`],
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-slate-900">Bills Payable</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setEditingCreditor('new')}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Add creditor
          </button>
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Add bill / expense
          </button>
        </div>
      </div>

      {actionError && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>
      )}
      {loading && <p className="mt-4 text-slate-500">Loading bills...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}

      {!loading && !error && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Owed (open bills)" value={formatMoney(totals.open)} note={`${totals.count} bill${totals.count === 1 ? '' : 's'}`} />
            <Card label="Overdue" value={formatMoney(totals.overdue)} danger={totals.overdue > 0} />
            <Card label="Due in 7 days" value={formatMoney(totals.dueSoon)} />
            <Card
              label="Paid this month"
              value={formatMoney(
                bills
                  .flatMap((b) => b.payments)
                  .filter((p) => !p.voided_at && p.paid_on.slice(0, 7) === today.slice(0, 7))
                  .reduce((s, p) => s + p.amount, 0),
              )}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tab === key ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'creditors' ? (
            <CreditorsTable creditors={creditors} onEdit={setEditingCreditor} />
          ) : visible.length === 0 ? (
            <p className="mt-4 text-slate-500">Nothing in this tab.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Bill date</th>
                    <th className="px-4 py-3 font-medium">Creditor</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Description</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-right font-medium">Remaining</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((bill) => {
                    const status = billStatus(bill)
                    const overdue = isOverdue(bill, today)
                    const activePayments = bill.payments.filter((p) => !p.voided_at)
                    const expanded = openBillId === bill.bill_id
                    return (
                      <BillRows
                        key={bill.bill_id}
                        bill={bill}
                        status={status}
                        overdue={overdue}
                        expanded={expanded}
                        onToggle={() => setOpenBillId(expanded ? null : bill.bill_id)}
                        onPay={() => setPaying(bill)}
                        onVoid={activePayments.length === 0 && status !== 'Voided' ? () => handleVoidBill(bill) : null}
                        onVoidPayment={(id, amount) => handleVoidPayment(bill, id, amount)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {adding && (
        <AddBillModal
          creditors={creditors}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            load()
          }}
        />
      )}
      {paying && (
        <PayBillModal
          bill={paying}
          onClose={() => setPaying(null)}
          onSaved={() => {
            setPaying(null)
            load()
          }}
        />
      )}
      {editingCreditor && (
        <CreditorModal
          creditor={editingCreditor === 'new' ? null : editingCreditor}
          onClose={() => setEditingCreditor(null)}
          onSaved={() => {
            setEditingCreditor(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function BillRows({
  bill,
  status,
  overdue,
  expanded,
  onToggle,
  onPay,
  onVoid,
  onVoidPayment,
}: {
  bill: Bill
  status: BillStatus
  overdue: boolean
  expanded: boolean
  onToggle: () => void
  onPay: () => void
  onVoid: (() => void) | null
  onVoidPayment: (paymentId: number, amount: number) => void
}) {
  const open = status === 'Unpaid' || status === 'Partial'
  return (
    <>
      <tr className={`border-b border-slate-100 align-top ${status === 'Voided' ? 'text-slate-400' : ''}`}>
        <td className="whitespace-nowrap px-4 py-3">{formatDate(bill.bill_date)}</td>
        <td className="px-4 py-3">{bill.creditor_name ?? '—'}</td>
        <td className="px-4 py-3">{bill.category}</td>
        <td className="px-4 py-3">
          <p className={status === 'Voided' ? '' : 'text-slate-900'}>{bill.description}</p>
          {bill.reference_no && <p className="text-xs">Ref: {bill.reference_no}</p>}
          {bill.voided_at && <p className="text-xs">Voided: {bill.void_reason}</p>}
        </td>
        <td className={`whitespace-nowrap px-4 py-3 ${overdue ? 'font-medium text-red-700' : ''}`}>
          {bill.due_date ? formatDate(bill.due_date) : '—'}
          {overdue && <p className="text-xs">Overdue</p>}
        </td>
        <td className={`whitespace-nowrap px-4 py-3 text-right ${status === 'Voided' ? 'line-through' : ''}`}>
          {formatMoney(bill.amount)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
          {open ? formatMoney(billRemaining(bill)) : '—'}
        </td>
        <td className="px-4 py-3">
          <span className={`px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>{status}</span>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            {open && (
              <button onClick={onPay} className="rounded-lg bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700">
                Pay
              </button>
            )}
            {bill.payments.length > 0 && (
              <button onClick={onToggle} aria-expanded={expanded} className="text-slate-700 hover:underline">
                Payments ({bill.payments.length})
              </button>
            )}
            {onVoid && (
              <button onClick={onVoid} className="text-red-700 hover:underline">
                Void
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={9} className="px-4 py-3">
            <div className="flex flex-col gap-2 text-sm">
              {bill.payments.map((p) => (
                <div
                  key={p.bill_payment_id}
                  className={`flex flex-wrap items-center justify-between gap-2 ${p.voided_at ? 'text-slate-400' : 'text-slate-700'}`}
                >
                  <span>
                    {formatDate(p.paid_on)} · {p.method}
                    {p.reference_no && ` · Ref ${p.reference_no}`}
                    {p.note && ` · ${p.note}`}
                    {p.voided_at && ` · Voided: ${p.void_reason}`}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={`font-medium ${p.voided_at ? 'line-through' : 'text-slate-900'}`}>
                      {formatMoney(p.amount)}
                    </span>
                    {!p.voided_at && (
                      <button
                        onClick={() => onVoidPayment(p.bill_payment_id, p.amount)}
                        className="text-xs font-medium text-red-700 hover:underline"
                      >
                        Void
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function CreditorsTable({
  creditors,
  onEdit,
}: {
  creditors: Creditor[]
  onEdit: (creditor: Creditor) => void
}) {
  if (creditors.length === 0) {
    return <p className="mt-4 text-slate-500">No creditors yet. Use "Add creditor" above.</p>
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Creditor</th>
            <th className="px-4 py-3 font-medium">Contact person</th>
            <th className="px-4 py-3 font-medium">Phone</th>
            <th className="px-4 py-3 font-medium">TIN</th>
            <th className="px-4 py-3 font-medium">Note</th>
            <th className="px-4 py-3 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {creditors.map((s) => (
            <tr key={s.creditor_id} className="border-b border-slate-100">
              <td className="px-4 py-3 text-slate-900">{s.creditor_name}</td>
              <td className="px-4 py-3 text-slate-600">{s.contact_person ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{s.phone ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{s.tin_number ?? '—'}</td>
              <td className="px-4 py-3 text-slate-600">{s.note ?? '—'}</td>
              <td className="px-4 py-3">
                <button onClick={() => onEdit(s)} className="text-xs font-medium text-slate-700 hover:underline">
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function AddBillModal({
  creditors,
  onClose,
  onSaved,
}: {
  creditors: Creditor[]
  onClose: () => void
  onSaved: () => void
}) {
  const today = toManilaDate(new Date())
  const [creditorId, setCreditorId] = useState('')
  const [category, setCategory] = useState<string>(BILL_CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [amountText, setAmountText] = useState('')
  const [billDate, setBillDate] = useState(today)
  const [dueDate, setDueDate] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [note, setNote] = useState('')
  const [paidNow, setPaidNow] = useState(false)
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const amount = Number(amountText)
  let inputError: string | null = null
  if (!description.trim()) inputError = 'Enter a description.'
  else if (amountText === '' || !Number.isFinite(amount) || amount <= 0) inputError = 'Enter an amount greater than zero.'
  else if (billDate > today) inputError = "The bill date can't be in the future."
  else if (dueDate && dueDate < billDate) inputError = "The due date can't be before the bill date."

  async function save() {
    if (inputError) {
      setSaveError(inputError)
      return
    }
    setSaving(true)
    setSaveError(null)
    const createError = await createBill({
      category,
      description: description.trim(),
      amount,
      creditorId: creditorId ? Number(creditorId) : null,
      billDate,
      dueDate: paidNow ? '' : dueDate,
      referenceNo,
      note,
      paidNow,
      method,
    })
    setSaving(false)
    if (createError) {
      setSaveError(createError)
      return
    }
    onSaved()
  }

  return (
    <Modal title="Add bill / expense" onClose={onClose}>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="bill-creditor">Creditor (optional)</label>
          <select id="bill-creditor" value={creditorId} onChange={(e) => setCreditorId(e.target.value)} className={inputClass}>
            <option value="">No creditor / walk-in</option>
            {creditors.map((s) => (
              <option key={s.creditor_id} value={s.creditor_id}>{s.creditor_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="bill-category">Category</label>
          <select id="bill-category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {BILL_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="bill-description">Description</label>
          <input id="bill-description" type="text" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="bill-amount">Amount (₱)</label>
          <input
            id="bill-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ''))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="bill-date">Bill date</label>
          <input id="bill-date" type="date" max={today} value={billDate} onChange={(e) => setBillDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="bill-ref">Reference / receipt no. (optional)</label>
          <input id="bill-ref" type="text" maxLength={50} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={inputClass} />
        </div>
        {!paidNow && (
          <div>
            <label className={labelClass} htmlFor="bill-due">Due date (optional)</label>
            <input id="bill-due" type="date" min={billDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="bill-note">Note (optional)</label>
          <input id="bill-note" type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
          <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} />
          Already paid in full (a one-off expense)
        </label>
        {paidNow && (
          <div className="mt-2">
            <label className={labelClass} htmlFor="bill-method">Paid by</label>
            <select id="bill-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {saveError && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}

      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
        <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {saving ? 'Saving...' : paidNow ? 'Save expense' : 'Save bill'}
        </button>
      </div>
    </Modal>
  )
}

function PayBillModal({ bill, onClose, onSaved }: { bill: Bill; onClose: () => void; onSaved: () => void }) {
  const today = toManilaDate(new Date())
  const remaining = billRemaining(bill)
  const [amountText, setAmountText] = useState(String(remaining))
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0])
  const [paidOn, setPaidOn] = useState(today)
  const [referenceNo, setReferenceNo] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const amount = Number(amountText)
  let inputError: string | null = null
  if (amountText === '' || !Number.isFinite(amount) || amount <= 0) inputError = 'Enter an amount greater than zero.'
  else if (amount > remaining) inputError = `Can't pay more than the ${formatMoney(remaining)} still owed.`
  else if (paidOn > today) inputError = "The payment date can't be in the future."

  async function save() {
    if (inputError) {
      setSaveError(inputError)
      return
    }
    setSaving(true)
    setSaveError(null)
    const payError = await recordBillPayment({ billId: bill.bill_id, amount, method, paidOn, referenceNo, note })
    setSaving(false)
    if (payError) {
      setSaveError(payError)
      return
    }
    onSaved()
  }

  return (
    <Modal title={`Pay bill #${bill.bill_id}`} onClose={onClose}>
      <p className="mt-1 text-sm text-slate-600">
        {bill.description}
        {bill.creditor_name && ` · ${bill.creditor_name}`} · {formatMoney(remaining)} still owed
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="pay-bill-amount">Amount paid (₱)</label>
          <input
            id="pay-bill-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ''))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="pay-bill-method">Paid by</label>
          <select id="pay-bill-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="pay-bill-date">Date paid</label>
          <input id="pay-bill-date" type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pay-bill-ref">Reference no. (optional)</label>
          <input id="pay-bill-ref" type="text" maxLength={50} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="pay-bill-note">Note (optional)</label>
          <input id="pay-bill-note" type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </div>
      </div>
      {inputError && amountText !== '' && <p className="mt-2 text-xs text-red-700">{inputError}</p>}
      {saveError && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
        <button onClick={save} disabled={saving || !!inputError} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Record payment'}
        </button>
      </div>
    </Modal>
  )
}

function CreditorModal({
  creditor,
  onClose,
  onSaved,
}: {
  creditor: Creditor | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(creditor?.creditor_name ?? '')
  const [contact, setContact] = useState(creditor?.contact_person ?? '')
  const [phone, setPhone] = useState(creditor?.phone ?? '')
  const [tin, setTin] = useState(creditor?.tin_number ?? '')
  const [note, setNote] = useState(creditor?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) {
      setSaveError('Enter the creditor name.')
      return
    }
    setSaving(true)
    setSaveError(null)
    const creditorError = await saveCreditor({
      creditor_id: creditor?.creditor_id,
      creditor_name: name,
      contact_person: contact,
      phone,
      tin_number: tin,
      note,
    })
    setSaving(false)
    if (creditorError) {
      setSaveError(creditorError)
      return
    }
    onSaved()
  }

  return (
    <Modal title={creditor ? `Edit ${creditor.creditor_name}` : 'Add creditor'} onClose={onClose}>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="cred-name">Creditor name</label>
          <input id="cred-name" type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cred-contact">Contact person (optional)</label>
          <input id="cred-contact" type="text" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cred-phone">Phone (optional)</label>
          <input id="cred-phone" type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9+()\- ]/g, ''))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cred-tin">TIN (optional)</label>
          <input id="cred-tin" type="text" maxLength={30} value={tin} onChange={(e) => setTin(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cred-note">Note (optional)</label>
          <input id="cred-note" type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </div>
      </div>
      {saveError && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
        <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save creditor'}
        </button>
      </div>
    </Modal>
  )
}

function Card({ label, value, note, danger }: { label: string; value: string; note?: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${danger ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

export default BillsPayableSection
