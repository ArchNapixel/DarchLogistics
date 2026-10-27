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
import { COMPANY } from '../../../lib/company'
import PageHeader from '../../../components/PageHeader'
import { formatMoney, formatDate } from '../../../lib/format'

function StatementsSection() {
  const today = toManilaDate(new Date())
  const [clients, setClients] = useState<{ client_id: number; client_name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`)
  const [to, setTo] = useState(today)
  // The built statement, tagged with the client + dates it's for --
  // "loading" is just "nothing built for the current pick yet".
  const [result, setResult] = useState<{ key: string; statement: Statement | null; error: string | null } | null>(null)
  // Loading the client list failed.
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
  const ready = !!clientId && !!from && !!to && from <= to
  const key = `${clientId}|${from}|${to}`
  useEffect(() => {
    if (!ready) return
    let ignore = false
    loadStatement(Number(clientId), from, to).then((loaded) => {
      if (ignore) return // a newer pick already replaced this one
      setResult({ key, statement: loaded.statement, error: loaded.error })
    })
    return () => {
      ignore = true
    }
  }, [ready, key, clientId, from, to])
  const current = ready && result?.key === key ? result : null
  const statement = current?.statement ?? null
  const loading = ready && !current
  const shownError =
    error ?? (clientId && from && to && from > to ? '"From" is after "To".' : (current?.error ?? null))

  const clientName = clients.find((c) => String(c.client_id) === clientId)?.client_name ?? ''
  const fieldClass =
    'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'
  const filterLabel = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
  const printIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9V3h12v6 M6 18H4v-7h16v7h-2 M6 14h12v7H6z" />
    </svg>
  )
  const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
  const TD = 'px-2 py-2 first:pl-5 last:pr-5'

  return (
    <div>
      {/* Controls: not printed */}
      <PageHeader
        title="Statements"
        subtitle="Statement of account for one client: every charge and payment, with a running balance."
        actions={
          <div className="flex gap-3">
            <button onClick={() => window.print()} disabled={!statement} className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium">
              {printIcon}
              Print
            </button>
            {/* The browser's print dialog has "Save as PDF". */}
            <button onClick={() => window.print()} disabled={!statement} className="btn-primary flex items-center gap-2 px-5 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v12 M7 10l5 5 5-5 M5 21h14" />
              </svg>
              Save as PDF
            </button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 print:hidden">
        <label className={filterLabel}>
          Client
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={`${fieldClass} w-56`}>
            <option value="">Choose a client...</option>
            {clients.map((c) => (
              <option key={c.client_id} value={c.client_id}>
                {c.client_name}
              </option>
            ))}
          </select>
        </label>
        <label className={filterLabel}>
          From
          <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
        </label>
        <label className={filterLabel}>
          To
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
        </label>
      </div>

      {shownError && <p className="mb-4 text-red-700 print:hidden">{shownError}</p>}
      {!clientId && <p className="text-ink-muted print:hidden">Choose a client to see their statement.</p>}
      {loading && <p className="text-ink-muted print:hidden">Building statement...</p>}

      {statement && !loading && (
        <section aria-label="Statement of account" className="card flex flex-col print:border-0">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-4 print:px-0">
            <div>
              <p className="text-sm font-bold text-ink">{COMPANY.name}</p>
              <p className="text-[13px] text-ink-muted">
                {COMPANY.address} · {COMPANY.phone}
              </p>
              <h2 className="mt-3 text-lg leading-[26px] font-bold text-ink">Statement of Account · {clientName}</h2>
            </div>
            <div className="text-right text-sm text-ink-secondary">
              <p>
                <strong className="text-ink">Period</strong> {formatDate(from)} – {formatDate(to)}
              </p>
              <p>
                <strong className="text-ink">Generated</strong> {formatDate(today)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            {(
              [
                ['Opening balance', statement.opening, ''],
                ['Charges', statement.billed, ''],
                ['Payments', statement.paid, ''],
                ['Closing balance', statement.closing, 'text-primary'],
              ] as const
            ).map(([label, amount, tone]) => (
              <div key={label} className="bg-white px-6 py-3.5">
                <p className="text-sm font-medium text-ink-secondary">{label}</p>
                <p className={`text-[22px] leading-[30px] font-bold tabular-nums ${tone || 'text-ink'}`}>{formatMoney(amount)}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm text-ink-metric">
              <thead>
                <tr>
                  <th className={TH}>Date</th>
                  <th className={TH}>Booking</th>
                  <th className={TH}>Description</th>
                  <th className={`${TH} text-right`}>Charges</th>
                  <th className={`${TH} text-right`}>Payments</th>
                  <th className={`${TH} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="h-12 border-b border-slate-200 font-semibold">
                  <td className={TD} colSpan={5}>
                    Opening balance (as of {formatDate(from)})
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{formatMoney(statement.opening)}</td>
                </tr>
                {statement.lines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-4 text-ink-muted">
                      Nothing was billed or paid in this period.
                    </td>
                  </tr>
                )}
                {statement.lines.map((line, i) => (
                  <tr key={i} className="h-12 border-b border-slate-200 align-top">
                    <td className={`${TD} whitespace-nowrap text-ink-secondary`}>{formatDate(line.date)}</td>
                    <td className={`${TD} text-ink-secondary`}>#{line.booking_id}</td>
                    <td className={TD}>{line.description}</td>
                    <td className={`${TD} text-right tabular-nums`}>{line.amount > 0 ? formatMoney(line.amount) : ''}</td>
                    <td className={`${TD} text-right tabular-nums`}>{line.amount < 0 ? formatMoney(-line.amount) : ''}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{formatMoney(line.balance)}</td>
                  </tr>
                ))}
                <tr className="h-12 border-b border-slate-200 font-semibold">
                  <td className={TD} colSpan={3}>
                    Totals for the period
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{formatMoney(statement.billed)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatMoney(statement.paid)}</td>
                  <td className={TD}></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-slate-50 px-6 py-4">
            <span className="text-sm font-semibold text-ink">
              Closing balance (as of {formatDate(to)}){statement.closing > 0 ? ' — amount due' : ''}
            </span>
            <span className="text-2xl leading-8 font-bold text-ink tabular-nums">{formatMoney(statement.closing)}</span>
          </div>
          {statement.closing < 0 && (
            <p className="px-6 pb-4 text-sm text-ink-secondary">A negative balance means the client has paid ahead (credit).</p>
          )}
        </section>
      )}
    </div>
  )
}

export default StatementsSection
