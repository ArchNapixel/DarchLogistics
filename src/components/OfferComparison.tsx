// OfferComparison: the last two price proposals on a quote side by side
// (rate per trip, pickup date, deadline), with whatever changed
// highlighted -- staff see it on a client's counter-offer, the client sees
// it on our new offer after their counter. lib/quoteOffers.ts offerChanges
// decides what changed.
import { formatDate, formatMoney } from '../lib/format'
import { offerChanges, type QuoteOfferRow } from '../lib/quoteOffers'

type Terms = Pick<QuoteOfferRow, 'rate' | 'pickup_date' | 'deadline_date'>

function OfferComparison({
  before,
  now,
  beforeLabel,
  nowLabel,
}: {
  before: Terms
  now: Terms
  beforeLabel: string
  nowLabel: string
}) {
  const changed = offerChanges(before, now)!
  const rows = [
    ['Rate per trip', changed.rate, before.rate != null ? formatMoney(before.rate) : '—', now.rate != null ? formatMoney(now.rate) : '—'],
    ['Pickup date', changed.pickup, before.pickup_date ? formatDate(before.pickup_date) : '—', now.pickup_date ? formatDate(now.pickup_date) : '—'],
    ['Deadline', changed.deadline, before.deadline_date ? formatDate(before.deadline_date) : '—', now.deadline_date ? formatDate(now.deadline_date) : '—'],
  ] as const
  const nothingChanged = !changed.rate && !changed.pickup && !changed.deadline

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-500">
        <tr>
          <th className="py-1 font-medium" />
          <th className="py-1 font-medium">{beforeLabel}</th>
          <th className="py-1 font-medium">{nowLabel}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, isChanged, was, is]) => (
          <tr key={label} className="border-t border-slate-200">
            <td className="py-1.5 pr-2 text-slate-600">{label}</td>
            <td className={`py-1.5 pr-2 tabular-nums ${isChanged ? 'text-slate-500 line-through' : 'text-slate-700'}`}>{was}</td>
            <td className="py-1.5 tabular-nums">
              {isChanged ? (
                <span className="bg-amber-200 px-1.5 py-0.5 font-semibold text-slate-900">
                  {is} <span className="text-xs font-medium text-amber-900">changed</span>
                </span>
              ) : (
                <span className="text-slate-700">{is}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      {nothingChanged && (
        <tfoot>
          <tr>
            <td colSpan={3} className="pt-1 text-xs text-slate-500">
              Same terms as before.
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}

export default OfferComparison
