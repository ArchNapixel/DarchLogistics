// InventorySection: the Inventory page (the canvas's board) -- tiles (items
// tracked, out of stock, stock value, parts cost this month), Type / Stock /
// Search filters, the items table and a side panel for the selected item:
// its details and the completed work orders it was last used on. Add / Edit
// (AddInventoryItemModal) and Delete work as before (a delete that's blocked
// by a reference shows a message and keeps the list). Stock only changes
// through Add / Edit and parts used on work orders -- there's no separate
// stock-adjustment log or reorder level.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import { currentReportMonth, loadMaintenanceCostReport } from '../../../lib/maintenanceCostReport'
import AddInventoryItemModal, { type EditableInventoryItem } from './AddInventoryItemModal'
import { ITEM_TYPES } from '../../../lib/inventoryItemTypes'
import InventoryReportModal from './InventoryReportModal'
import { confirmDialog } from '../../../components/ConfirmDialog'
import PageHeader from '../../../components/PageHeader'
import EmptyState from '../../../components/EmptyState'
import { formatDate, formatMoney } from '../../../lib/format'

type InventoryItem = {
  item_id: number
  name: string
  item_type: string
  quantity: number
  unit_cost: number | null
}

const STOCK_FILTERS = ['All', 'In stock', 'Out of stock'] as const
type StockFilter = (typeof STOCK_FILTERS)[number]

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const GROUP = 'mb-2.5 flex justify-between gap-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink'
const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'm-0 text-[15px] leading-[22px] font-medium text-ink'
const FILTER_LABEL = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
const FILTER_CONTROL =
  'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'

function StockChip({ quantity }: { quantity: number }) {
  return quantity > 0 ? (
    <span className="rounded-[2px] bg-green-100 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-green-800">In stock</span>
  ) : (
    <span className="rounded-[2px] bg-red-100 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-red-800">Out of stock</span>
  )
}

// The last 5 completed work orders this item was used on.
function RecentUse({ itemId }: { itemId: number }) {
  const [rows, setRows] = useState<{ key: string; workOrderId: number; number: string; date: string; quantity: number }[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: used } = await supabase
        .from('work_order_parts_used')
        .select('completion_id, quantity')
        .eq('item_id', itemId)
        .order('completion_id', { ascending: false })
        .limit(5)
      const completionIds = (used ?? []).map((u) => u.completion_id)
      const { data: completions } = completionIds.length
        ? await supabase.from('work_order_completions').select('completion_id, work_order_id, completed_at').in('completion_id', completionIds)
        : { data: [] as { completion_id: number; work_order_id: number; completed_at: string }[] }
      const orderIds = [...new Set((completions ?? []).map((c) => c.work_order_id))]
      const { data: orders } = orderIds.length
        ? await supabase.from('work_orders').select('work_order_id, work_order_number').in('work_order_id', orderIds)
        : { data: [] as { work_order_id: number; work_order_number: string }[] }
      if (cancelled) return
      const completionById = new Map((completions ?? []).map((c) => [c.completion_id, c]))
      const numberById = new Map((orders ?? []).map((o) => [o.work_order_id, o.work_order_number]))
      setRows(
        (used ?? []).flatMap((u, i) => {
          const c = completionById.get(u.completion_id)
          if (!c) return []
          return [
            {
              key: `${u.completion_id}-${i}`,
              workOrderId: c.work_order_id,
              number: numberById.get(c.work_order_id) ?? `Work order #${c.work_order_id}`,
              date: c.completed_at,
              quantity: Number(u.quantity),
            },
          ]
        }),
      )
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [itemId])

  return (
    <section>
      <h3 className={GROUP}>Recently used on</h3>
      {rows === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Not used on a completed work order yet.</p>
      ) : (
        rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm last:border-0">
            <Link to={`/dashboard/maintenance?tab=Completed&wo=${r.workOrderId}`} className="font-semibold text-primary hover:underline">
              {r.number}
            </Link>
            <span className="flex-1 text-ink-secondary">{formatDate(r.date)}</span>
            <span className="font-semibold tabular-nums">× {r.quantity}</span>
          </div>
        ))
      )}
    </section>
  )
}

function InventorySection() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [partsCost, setPartsCost] = useState<number | null>(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [stockFilter, setStockFilter] = useState<StockFilter>('All')
  const [search, setSearch] = useState('')
  const [paneId, setPaneId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadItems()
      // The tile just shows "—" if the cost report can't load.
      void loadMaintenanceCostReport(currentReportMonth()).then((r) =>
        setPartsCost(r.error ? null : r.workOrders.reduce((sum, w) => sum + w.total, 0)),
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function loadItems() {
    setLoading(true)

    const { data, error: loadError } = await supabase
      .from('inventory_items')
      .select('item_id, name, item_type, quantity, unit_cost')
      .order('name', { ascending: true })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setItems(data)
    setError(null)
    setLoading(false)
  }

  async function handleDelete(item: InventoryItem) {
    if (
      !(await confirmDialog({
        title: `Delete ${item.name}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return
    }

    setDeletingId(item.item_id)
    setActionError(null)

    const { error: deleteError } = await supabase.from('inventory_items').delete().eq('item_id', item.item_id)

    setDeletingId(null)

    if (deleteError) {
      // '23503' is Postgres's error code for a foreign key violation.
      // Uses a separate actionError state (not the page-load `error`)
      // so a failed delete shows a banner without hiding the whole list.
      if (deleteError.code === '23503') {
        setActionError(
          `Can't delete ${item.name} -- it's still referenced elsewhere. ` + `Remove those references first, then try again.`,
        )
      } else {
        setActionError(deleteError.message)
      }
      return
    }

    setPaneId(null)
    loadItems()
  }

  const term = search.trim().toLowerCase()
  const shown = items.filter(
    (item) =>
      (!typeFilter || item.item_type === typeFilter) &&
      (stockFilter === 'All' || (stockFilter === 'In stock' ? item.quantity > 0 : item.quantity <= 0)) &&
      (!term || item.name.toLowerCase().includes(term) || String(item.item_id) === term.replace(/^#/, '')),
  )
  const outOfStock = items.filter((item) => item.quantity <= 0).length
  const stockValue = items.reduce((sum, item) => sum + (item.unit_cost ?? 0) * Math.max(0, item.quantity), 0)
  const unpriced = items.filter((item) => item.unit_cost === null && item.quantity > 0).length

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(shown, `${typeFilter}|${stockFilter}|${search}`)
  const pane = paged.rows.find((item) => item.item_id === paneId) ?? paged.rows[0] ?? null

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Parts, tools and supplies on hand. Parts used on work orders are taken out automatically."
        actions={
          <>
            <button type="button" onClick={() => setShowReport(true)} className="btn-secondary px-4 text-sm font-medium">
              Inventory Report
            </button>
            <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 px-5 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14 M5 12h14" />
              </svg>
              Add Item
            </button>
          </>
        }
      />

      <section aria-label="Stock totals" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Items tracked', value: String(items.length) },
          { label: 'Out of stock', value: String(outOfStock), bad: outOfStock > 0 },
          { label: 'Stock value', value: formatMoney(stockValue), note: unpriced > 0 ? `${unpriced} in-stock ${unpriced === 1 ? 'item has' : 'items have'} no price` : undefined },
          { label: 'Parts cost, this month', value: partsCost === null ? '—' : formatMoney(partsCost) },
        ].map((tile) => (
          <div key={tile.label} className="card px-[18px] py-3">
            <p className="text-sm font-medium text-ink-secondary">{tile.label}</p>
            <p className={`text-[26px] leading-[34px] font-bold tracking-[-0.01em] tabular-nums ${tile.bad ? 'text-red-700' : 'text-ink'}`}>
              {loading ? '…' : tile.value}
            </p>
            {tile.note && !loading && <p className="text-[13px] text-amber-700">{tile.note}</p>}
          </div>
        ))}
      </section>

      {actionError && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className={FILTER_LABEL}>
          Type
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${FILTER_CONTROL} w-40`}>
            <option value="">All types</option>
            {ITEM_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className={FILTER_LABEL}>
          Stock
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)} className={`${FILTER_CONTROL} w-40`}>
            {STOCK_FILTERS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className={FILTER_LABEL}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Item name or ID"
            className={`${FILTER_CONTROL} w-60 font-normal placeholder:text-ink-muted`}
          />
        </label>
      </div>

      {loading && <p className="mt-4 text-ink-muted">Loading inventory...</p>}
      {!loading && error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState message="No inventory items yet." hint='Use "Add Item" to add one.' className="mt-4" />}

      {!loading && !error && items.length > 0 && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
          <section aria-label="Items" className="card flex min-h-[calc(100dvh-26rem)] flex-col">
            <div className="flex-1 overflow-x-auto">
              {shown.length === 0 ? (
                <EmptyState message="No items match the current filters." className="m-5" />
              ) : (
                <table className="w-full min-w-[720px] text-left text-sm text-ink-metric">
                  <thead>
                    <tr>
                      <th className={TH}>Item ID</th>
                      <th className={TH}>Item Name</th>
                      <th className={TH}>Type</th>
                      <th className={`${TH} text-right`}>On Hand</th>
                      <th className={`${TH} text-right`}>Unit Cost</th>
                      <th className={TH}>Stock</th>
                      <th className={TH}>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.rows.map((item) => {
                      const selected = pane?.item_id === item.item_id
                      return (
                        <tr
                          key={item.item_id}
                          onClick={() => setPaneId(item.item_id)}
                          aria-current={selected || undefined}
                          className={`h-[60px] cursor-pointer border-b border-slate-200 ${
                            selected ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className={`${TD} text-ink-muted tabular-nums`}>#{item.item_id}</td>
                          <td className={`${TD} font-semibold text-ink`}>{item.name}</td>
                          <td className={TD}>{item.item_type}</td>
                          <td className={`${TD} text-right font-semibold tabular-nums ${item.quantity <= 0 ? 'text-red-700' : ''}`}>{item.quantity}</td>
                          <td className={`${TD} text-right tabular-nums`}>
                            {item.unit_cost !== null ? formatMoney(item.unit_cost) : <span className="text-xs font-medium text-amber-700">No price set</span>}
                          </td>
                          <td className={TD}>
                            <StockChip quantity={item.quantity} />
                          </td>
                          <td className={TD}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setPaneId(item.item_id)
                              }}
                              aria-label={`Open ${item.name}`}
                              className="flex h-11 w-11 items-center justify-center text-primary"
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M9 6l6 6-6 6" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
              <span>
                {shown.length} of {items.length} items
              </span>
              {paged.pager.pageCount > 1 && (
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                    disabled={paged.pager.page === 0}
                    className="btn-secondary px-3.5 text-sm font-medium"
                  >
                    ‹ Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                    disabled={paged.pager.page >= paged.pager.pageCount - 1}
                    className="btn-secondary px-3.5 text-sm font-medium"
                  >
                    Next ›
                  </button>
                </span>
              )}
            </div>
          </section>

          {pane && (
            <aside aria-labelledby="inv-title" className="card flex flex-col xl:sticky xl:top-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
                <h2 id="inv-title" className="text-lg leading-[26px] font-bold text-ink">
                  {pane.name}
                </h2>
                <StockChip quantity={pane.quantity} />
              </div>
              <div className="flex flex-col gap-[18px] px-5 py-4">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
                  <div>
                    <dt className={LABEL}>Item ID</dt>
                    <dd className={VALUE}>#{pane.item_id}</dd>
                  </div>
                  <div>
                    <dt className={LABEL}>Type</dt>
                    <dd className={VALUE}>{pane.item_type}</dd>
                  </div>
                  <div>
                    <dt className={LABEL}>On hand</dt>
                    <dd className={`${VALUE} tabular-nums`}>{pane.quantity}</dd>
                  </div>
                  <div>
                    <dt className={LABEL}>Unit cost</dt>
                    <dd className={`${VALUE} tabular-nums`}>{pane.unit_cost !== null ? formatMoney(pane.unit_cost) : 'No price set'}</dd>
                  </div>
                  <div className="col-span-full">
                    <dt className={LABEL}>Stock value</dt>
                    <dd className={`${VALUE} tabular-nums`}>
                      {pane.unit_cost !== null ? formatMoney(pane.unit_cost * Math.max(0, pane.quantity)) : '—'}
                    </dd>
                  </div>
                </dl>
                <RecentUse itemId={pane.item_id} />
                <p className="text-[13px] text-ink-muted">
                  To restock or correct the count, use Edit. Parts a mechanic logs on a work order are taken out of stock right away.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
                <button type="button" onClick={() => void handleDelete(pane)} disabled={deletingId === pane.item_id} className="btn-danger px-4 text-sm">
                  {deletingId === pane.item_id ? 'Deleting...' : 'Delete…'}
                </button>
                <span className="flex-1" />
                <button type="button" onClick={() => setEditingItem(pane)} className="btn-primary flex items-center gap-2 px-5 text-sm">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" />
                  </svg>
                  Edit
                </button>
              </div>
            </aside>
          )}
        </div>
      )}

      {showReport && <InventoryReportModal onClose={() => setShowReport(false)} />}

      {(showAdd || editingItem) && (
        <AddInventoryItemModal
          item={editingItem as EditableInventoryItem | undefined}
          onClose={() => {
            setShowAdd(false)
            setEditingItem(null)
          }}
          onSaved={() => {
            setShowAdd(false)
            setEditingItem(null)
            loadItems()
          }}
        />
      )}
    </div>
  )
}

export default InventorySection
