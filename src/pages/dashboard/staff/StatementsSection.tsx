// StatementsSection (Admin, Accounting -> Statements): a printable Statement
// of Account for one client and period -- opening balance, what was billed
// (delivered trips, adjustments), what was paid, closing balance. Pick a
// client and dates, then Print (the browser's print dialog -- choose "Save
// as PDF" to keep a copy). The sidebar/header are hidden when printing
// (print: classes in DashboardLayout). Ledger math: lib/statementTotals.ts.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { loadStatement, type Statement } from '../../../lib/statement'
import { toManilaDate } from '../../../lib/payslip'

function formatMoney(value: number): string {
  return `${value < 0 ? '-' : ''}₱${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function StatementsSection() {
  const today = toManilaDate(new Date())
  const [clients, setClients] = useState<{ client_id: number; client_name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  const [statement, setStatement] = useState<Statement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Client choices (everyone, A-Z). Loaded once.
  useEffect(() => {
    supabase
      .from('clients')
      .select('client_id, client_name')
      .order('client_name')
      .then(({ data, error: clientsError }) => {
        if (clientsError) setError(clientsError.message)
        else setClients(data ?? [])
      })
  }, [])

  // Rebuild whenever the client or dates change (and all three are filled).
  useEffect(() => {
    if (!clientId || !from || !to) {
      setStatement(null)
      return
    }
    if (from > to) {
      setError('"From" is after "To".')
      setStatement(null)
      return
    }

    let ignore = false
    setLoading(true)
    loadStatement(Number(clientId), from, to).then((result) => {
      if (ignore) return // a newer pick already replaced this one
      setStatement(result.statement)
      setError(result.error)
      setLoading(false)
    })
    return () => {
      ignore = true
    }
  }, [clientId, from, to])

  const clientName = clients.find((c) => String(c.client_id) === clientId)?.client_name ?? ''
  const fieldClass = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900'

  return (
    <div>
      {/* Controls: not printed */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h2 className="text-xl font-bold text-slate-900">Statements of Account</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} className={fieldClass}>
            <option value="">Choose a client...</option>
            {clients.map((c) => (
              <option key={c.client_id} value={c.client_id}>{c.client_name}</option>
            ))}
          </select>
          <label htmlFor="stmt-from" className="text-sm font-medium text-slate-700">From</label>
          <input id="stmt-from" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
          <label htmlFor="stmt-to" className="text-sm font-medium text-slate-700">To</label>
          <input id="stmt-to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
          <button
            onClick={() => window.print()}
            disabled={!statement}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Print
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-red-700 print:hidden">{error}</p>}
      {!clientId && <p className="mt-4 text-slate-500 print:hidden">Choose a client to see their statement.</p>}
      {loading && <p className="mt-4 text-slate-500 print:hidden">Building statement...</p>}

      {statement && !loading && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:mt-0 print:border-0 print:p-0 print:shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Darch Logistics</p>
              <h3 className="text-lg font-bold text-slate-900">Statement of Account</h3>
            </div>
            <div className="text-right text-sm text-slate-600">
              <p className="font-semibold text-slate-900">{clientName}</p>
              <p>{from} to {to}</p>
              <p className="text-xs">Prepared {today}</p>
            </div>
          </div>

          <table className="mt-5 w-full text-left text-sm">
            <thead className="border-b border-slate-300 text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Booking</th>
                <th className="py-2 pr-3 font-medium">Description</th>
                <th className="py-2 pr-3 text-right font-medium">Billed</th>
                <th className="py-2 pr-3 text-right font-medium">Paid</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100 font-medium text-slate-900">
                <td className="py-2 pr-3" colSpan={5}>Opening balance (as of {from})</td>
                <td className="py-2 text-right">{formatMoney(statement.opening)}</td>
              </tr>
              {statement.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-slate-500">Nothing was billed or paid in this period.</td>
                </tr>
              )}
              {statement.lines.map((line, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{line.date}</td>
                  <td className="py-2 pr-3 text-slate-600">#{line.booking_id}</td>
                  <td className="py-2 pr-3 text-slate-900">{line.description}</td>
                  <td className="py-2 pr-3 text-right text-slate-900">{line.amount > 0 ? formatMoney(line.amount) : ''}</td>
                  <td className="py-2 pr-3 text-right text-slate-900">{line.amount < 0 ? formatMoney(-line.amount) : ''}</td>
                  <td className="py-2 text-right text-slate-900">{formatMoney(line.balance)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-300 font-semibold text-slate-900">
                <td className="py-2 pr-3" colSpan={3}>Totals for the period</td>
                <td className="py-2 pr-3 text-right">{formatMoney(statement.billed)}</td>
                <td className="py-2 pr-3 text-right">{formatMoney(statement.paid)}</td>
                <td className="py-2"></td>
              </tr>
              <tr className="font-bold text-slate-900">
                <td className="py-2 pr-3" colSpan={5}>Closing balance (as of {to}) — amount due</td>
                <td className="py-2 text-right">{formatMoney(statement.closing)}</td>
              </tr>
            </tbody>
          </table>
          {statement.closing < 0 && (
            <p className="mt-2 text-sm text-slate-600">A negative balance means the client has paid ahead (credit).</p>
          )}
        </div>
      )}
    </div>
  )
}

export default StatementsSection
