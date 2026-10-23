// TopCreditorsCard: dashboard leaderboard of the clients who owe the most.
// Reuses loadPaymentDueReport() (lib/paymentDue.ts) so the balances match
// the Payments Due panel exactly -- we just add up balance_due per client
// and show the biggest few. Outstanding balance is "as of now", so it does
// not follow the dashboard's period dropdown.
import { useEffect, useState } from 'react'
import { loadPaymentDueReport } from '../../../lib/paymentDue'
import { formatMoney } from '../../../lib/format'

const TOP_N = 10

type Creditor = { client_id: number; client_name: string; balance: number }

function TopCreditorsCard({ refreshKey }: { refreshKey: number }) {
  const [creditors, setCreditors] = useState<Creditor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadPaymentDueReport().then(({ rows, error }) => {
      if (error) {
        setError(`Couldn't load balances (${error}).`)
        setLoading(false)
        return
      }
      // Add up each client's balance across all their open bookings
      const byClient = new Map<number, Creditor>()
      rows.forEach((r) => {
        const c = byClient.get(r.client_id) ?? {
          client_id: r.client_id,
          client_name: r.client_name,
          balance: 0,
        }
        c.balance += r.balance_due
        byClient.set(r.client_id, c)
      })
      setError(null)
      setCreditors(
        [...byClient.values()]
          .filter((c) => c.balance > 0)
          .sort((a, b) => b.balance - a.balance)
          .slice(0, TOP_N),
      )
      setLoading(false)
    })
  }, [refreshKey])

  return (
    // Dashed box that fills its parent; the "Top Unpaid Clients" heading is
    // on the dashboard, above this card.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border border-dashed border-slate-300 px-4 py-3">
      {loading && <p className="font-ui text-sm text-neutral-500">Loading...</p>}
      {error && <p className="font-ui text-sm text-red-700">{error}</p>}
      {!loading && !error && creditors.length === 0 && (
        <p className="flex flex-1 items-center gap-2 font-ui text-sm text-slate-700">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-700" aria-hidden="true">
            <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6" />
          </svg>
          No outstanding balances.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {creditors.map((c, i) => (
          <li
            key={c.client_id}
            className="flex items-center justify-between gap-3 border-b border-reports-hairline pb-2 font-ui text-sm last:border-0 last:pb-0"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="font-condensed w-5 text-lg font-semibold text-neutral-400">{i + 1}</span>
              <span className="truncate text-reports-ink">{c.client_name}</span>
            </span>
            <span className="font-condensed text-lg font-semibold text-reports-ink">
              {formatMoney(c.balance)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export default TopCreditorsCard
