// StocktakeModal: the Inventory page's "Stocktake" (Admin) -- count the
// shelf, enter what's there, and post every difference in one go.
//   1. Download the count sheet (CSV): item, type, unit and an empty
//      "Counted" column. It does NOT show the system's number on purpose
//      (a "blind" count), so people count instead of confirming.
//   2. Type the counts in here. A blank box = not counted, left alone.
//   3. Post -> post_stock_count. Only items whose count differs are sent;
//      each becomes a 'count' movement (oldest batch first when stock goes
//      down, the listed price when it goes up). If an item's stock changed
//      after this list was loaded (a part was used meanwhile), the DB
//      refuses the whole post and names it -- reload and recount those.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { fetchAll } from '../../../lib/dashboardExpenses'
import { csvField } from '../../../lib/inventoryReport'
import { WHOLE_UNITS, filterQuantity } from '../../../lib/inventoryItemTypes'
import { confirmDialog } from '../../../components/ConfirmDialog'

type CountItem = { item_id: number; name: string; item_type: string; unit: string; quantity: number }

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const TH = 'px-2 py-2.5 first:pl-4 last:pr-4'
const TD = 'px-2 py-1.5 first:pl-4 last:pr-4'

function StocktakeModal({ onClose, onPosted }: { onClose: () => void; onPosted: (message: string) => void }) {
  // The stock each item had when this list loaded -- sent as "expected".
  const [items, setItems] = useState<CountItem[] | null>(null)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchAll<CountItem>((from, to) =>
      supabase
        .from('inventory_items')
        .select('item_id, name, item_type, unit, quantity')
        .is('archived_at', null)
        .order('name', { ascending: true })
        .range(from, to),
    ).then((result) => {
      if (cancelled) return
      if (result.error) setError(result.error)
      setItems(result.rows.map((i) => ({ ...i, quantity: Number(i.quantity) })))
    })
    return () => {
      cancelled = true
    }
  }, [])

  function downloadSheet() {
    if (!items) return
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
    const csv = [
      'Darch Logistics Stocktake Count Sheet',
      `Date: ${today}`,
      '',
      ['Item', 'Type', 'Unit', 'Counted'].map(csvField).join(','),
      ...items.map((i) => [i.name, i.item_type, i.unit, ''].map(csvField).join(',')),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `stocktake-count-sheet_${today}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const counted = (items ?? []).filter((i) => (counts[i.item_id] ?? '') !== '')
  const diffOf = (i: CountItem) => Math.round((Number(counts[i.item_id]) - i.quantity) * 100) / 100
  const differing = counted.filter((i) => diffOf(i) !== 0)

  async function handlePost() {
    setError(null)
    const fraction = counted.find((i) => WHOLE_UNITS.includes(i.unit) && !Number.isInteger(Number(counts[i.item_id])))
    if (fraction) return setError(`${fraction.name}: a count in ${fraction.unit} must be a whole number.`)
    if (counted.length === 0) return setError('Enter at least one count.')
    if (differing.length === 0) {
      onPosted(`Stocktake: all ${counted.length} counted ${counted.length === 1 ? 'item matches' : 'items match'}. Nothing to change.`)
      return
    }

    const up = differing.filter((i) => diffOf(i) > 0).length
    const down = differing.length - up
    if (
      !(await confirmDialog({
        title: 'Post stocktake?',
        message: `${differing.length} ${differing.length === 1 ? 'item differs' : 'items differ'} (${down} lower, ${up} higher). Their stock will be set to what you counted, and each change is recorded in the stock history.`,
        confirmLabel: 'Post count',
      }))
    ) {
      return
    }

    setSaving(true)
    const { error: postError } = await supabase.rpc('post_stock_count', {
      p_counts: differing.map((i) => ({ item_id: i.item_id, expected: i.quantity, counted: Number(counts[i.item_id]) })),
      p_note: note.trim() || null,
    })
    setSaving(false)
    if (postError) return setError(postError.message)
    onPosted(`Stocktake posted: ${differing.length} ${differing.length === 1 ? 'item' : 'items'} corrected.`)
  }

  const term = search.trim().toLowerCase()
  const shown = (items ?? []).filter((i) => !term || i.name.toLowerCase().includes(term))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="stocktake-title" className="card flex max-h-[94vh] w-full max-w-3xl flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="stocktake-title" className="text-xl leading-7 font-bold text-ink">
              Stocktake
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">
              Count the shelf, enter what's there, post the differences. Leave an item blank if you didn't count it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {error && <p className="mb-3 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an item"
              aria-label="Find an item"
              className={`${fieldClasses} max-w-60`}
            />
            <button type="button" onClick={downloadSheet} disabled={!items} className="btn-secondary px-4 text-sm font-medium">
              Download Count Sheet
            </button>
            <span className="text-[13px] text-ink-muted">The sheet doesn't show the system's numbers, so people count what's there.</span>
          </div>

          {items === null ? (
            <p className="text-sm text-ink-muted">Loading...</p>
          ) : (
            <table className="w-full text-left text-sm text-ink-metric">
              <thead>
                <tr>
                  <th className={TH}>Item</th>
                  <th className={`${TH} text-right`}>System</th>
                  <th className={`${TH} w-32`}>Counted</th>
                  <th className={`${TH} text-right`}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const text = counts[i.item_id] ?? ''
                  const diff = text === '' ? null : diffOf(i)
                  return (
                    <tr key={i.item_id} className="border-b border-slate-200">
                      <td className={TD}>
                        <span className="font-semibold text-ink">{i.name}</span>
                        <span className="ml-1.5 text-xs text-ink-muted">{i.item_type}</span>
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        {i.quantity} <span className="text-xs text-ink-muted">{i.unit}</span>
                      </td>
                      <td className={TD}>
                        <input
                          inputMode={WHOLE_UNITS.includes(i.unit) ? 'numeric' : 'decimal'}
                          value={text}
                          aria-label={`Counted ${i.name} (${i.unit})`}
                          onChange={(e) => setCounts((prev) => ({ ...prev, [i.item_id]: filterQuantity(e.target.value, i.unit) }))}
                          className={`${fieldClasses} text-right tabular-nums`}
                        />
                      </td>
                      <td
                        className={`${TD} text-right font-semibold tabular-nums ${
                          diff === null || diff === 0 ? 'text-ink-muted' : diff < 0 ? 'text-red-700' : 'text-green-800'
                        }`}
                      >
                        {diff === null ? '' : diff === 0 ? 'matches' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-6 py-4">
          <input
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional), e.g. month-end count by Juan"
            aria-label="Stocktake note"
            className={`${fieldClasses} min-w-0 flex-1`}
          />
          <span className="text-[13px] text-ink-muted">
            {counted.length} counted · {differing.length} differ
          </span>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void handlePost()} disabled={saving || !items} className="btn-primary px-6 text-sm">
            {saving ? 'Posting...' : 'Post Count'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default StocktakeModal
