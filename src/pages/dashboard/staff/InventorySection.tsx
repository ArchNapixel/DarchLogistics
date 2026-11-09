// InventorySection: the Inventory page (the canvas's board, Admin only) --
// tiles (items tracked, out of stock, stock value, parts cost this month),
// Type / Stock / Search filters, the items table and a side panel for the
// selected item: details, the batches on hand (each delivery keeps its own
// price; the oldest is used first) and its stock history.
//
// Stock never changes by typing over a number. It changes through:
//   Add Item (starting stock)  -> create_inventory_item (AddInventoryItemModal)
//   Receive Stock / Adjust Stock / Set Price -> StockActionModal
//   parts used / returned on work orders     -> the mechanic screens
// and every change is a row in inventory_movements (the history shown here).
// Items are archived, not deleted (Archive only at 0 stock; Restore undoes
// it) -- an item that was ever stocked has history that must stay.
// "Needs price" = added by a mechanic on a job with no price; Set Price
// fixes it and fills in the cost of the uses already recorded.
// Stock value = sum over open batches of quantity x what that batch cost.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import { fetchAll } from '../../../lib/dashboardExpenses'
import { currentReportMonth, loadMaintenanceCostReport } from '../../../lib/maintenanceCostReport'
import { loadOpenLots, loadStockHistory, MOVEMENT_LABELS, type OpenLot, type StockMove } from '../../../lib/inventoryMovements'
import AddInventoryItemModal, { type EditableInventoryItem } from './AddInventoryItemModal'
import StockActionModal, { type StockAction } from './StockActionModal'
import { ITEM_TYPES } from '../../../lib/inventoryItemTypes'
import InventoryReportModal from './InventoryReportModal'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { showToast } from '../../../components/Toast'
import PageHeader from '../../../components/PageHeader'
import EmptyState from '../../../components/EmptyState'
import { formatDate, formatDateTime, formatMoney } from '../../../lib/format'

type InventoryItem = {
  item_id: number
  name: string
  item_type: string
  unit: string
  quantity: number
  unit_cost: number | null
  needs_price: boolean
  archived_at: string | null
}

const STOCK_FILTERS = ['All', 'In stock', 'Out of stock', 'Needs price', 'Archived'] as const
type StockFilter = (typeof STOCK_FILTERS)[number]

const HISTORY_PAGE = 10

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const GROUP = 'mb-2.5 flex justify-between gap-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink'
const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'm-0 text-[15px] leading-[22px] font-medium text-ink'
const FILTER_LABEL = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
const FILTER_CONTROL =
  'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'
const CHIP = 'rounded-[2px] px-2 py-0.5 text-xs font-semibold whitespace-nowrap'

function StockChip({ item }: { item: InventoryItem }) {
  if (item.archived_at) return <span className={`${CHIP} bg-slate-100 text-slate-700`}>Archived</span>
  return item.quantity > 0 ? (
    <span className={`${CHIP} bg-green-100 text-green-800`}>In stock</span>
  ) : (
    <span className={`${CHIP} bg-red-100 text-red-800`}>Out of stock</span>
  )
}

function lotsValue(lots: OpenLot[]): number {
  return lots.reduce((sum, l) => sum + (l.unit_cost ?? 0) * l.qty_remaining, 0)
}

// One item's stock history, newest first, with "Show older".
// `refreshKey` changes after a stock action, so it reloads.
function StockHistory({ item, refreshKey }: { item: InventoryItem; refreshKey: number }) {
  const [limit, setLimit] = useState(HISTORY_PAGE)
  // Stored with the key it was loaded for -- "loading" = no result for the
  // current key yet (see "Loading derived, not set" in CLAUDE.md).
  const [result, setResult] = useState<{ key: string; moves: StockMove[]; more: boolean; error: string | null } | null>(null)
  const key = `${item.item_id}|${limit}|${refreshKey}`

  useEffect(() => {
    let cancelled = false
    void loadStockHistory(item.item_id, limit).then((r) => {
      if (!cancelled) setResult({ key, ...r })
    })
    return () => {
      cancelled = true
    }
  }, [item.item_id, limit, refreshKey, key])

  const current = result?.key === key ? result : null

  return (
    <section>
      <h3 className={GROUP}>Stock history</h3>
      {current === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : current.error ? (
        <p className="text-sm text-red-700">{current.error}</p>
      ) : current.moves.length === 0 ? (
        <p className="text-sm text-ink-muted">No stock changes recorded yet.</p>
      ) : (
        <>
          {current.moves.map((m) => (
            <div key={m.movement_id} className="border-b border-slate-200 py-2 text-sm last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-ink">{MOVEMENT_LABELS[m.reason] ?? m.reason}</span>
                <span className={`font-semibold tabular-nums ${m.qty_change < 0 ? 'text-red-700' : 'text-green-800'}`}>
                  {m.qty_change > 0 ? '+' : '−'}
                  {Math.abs(m.qty_change)} {item.unit}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-secondary">
                <span>{formatDateTime(m.created_at)}</span>
                <span>· {m.by}</span>
                {m.unit_cost !== null && <span>· {formatMoney(m.unit_cost)} each</span>}
                {m.work_order_id !== null && (
                  <Link
                    to={`/dashboard/maintenance?${m.work_order_closed ? 'tab=Completed&' : ''}wo=${m.work_order_id}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    · {m.work_order_number}
                  </Link>
                )}
              </div>
              {m.note && <p className="text-[13px] text-ink-muted">{m.note}</p>}
            </div>
          ))}
          {current.more && (
            <button type="button" onClick={() => setLimit((n) => n + HISTORY_PAGE)} className="btn-secondary mt-2 px-4 text-sm font-medium">
              Show older
            </button>
          )}
        </>
      )}
    </section>
  )
}

function InventorySection() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [lots, setLots] = useState<OpenLot[]>([])
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
  const [stockAction, setStockAction] = useState<{ item: InventoryItem; action: StockAction } | null>(null)
  const [archivingId, setArchivingId] = useState<number | null>(null)
  const [historyKey, setHistoryKey] = useState(0)

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

    const [itemsResult, lotsResult] = await Promise.all([
      fetchAll<InventoryItem>((from, to) =>
        supabase
          .from('inventory_items')
          .select('item_id, name, item_type, unit, quantity, unit_cost, needs_price, archived_at')
          .order('name', { ascending: true })
          .range(from, to),
      ),
      loadOpenLots(),
    ])

    const loadError = itemsResult.error ?? lotsResult.error
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setItems(
      itemsResult.rows.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        unit_cost: item.unit_cost === null ? null : Number(item.unit_cost),
      })),
    )
    setLots(lotsResult.lots)
    setError(null)
    setLoading(false)
  }

  async function handleArchive(item: InventoryItem, archive: boolean) {
    setActionError(null)
    if (archive && item.quantity > 0) {
      setActionError(
        `${item.name} still has ${item.quantity} ${item.unit} on hand. Use Adjust Stock to take it to 0 first (e.g. Damaged / Lost / Count correction).`,
      )
      return
    }
    if (
      archive &&
      !(await confirmDialog({
        title: `Archive ${item.name}?`,
        message: 'It disappears from the lists and mechanics can no longer pick it. Its history is kept, and Restore brings it back.',
        confirmLabel: 'Archive',
      }))
    ) {
      return
    }

    setArchivingId(item.item_id)
    const { error: archiveError } = await supabase.rpc('set_item_archived', {
      p_item_id: item.item_id,
      p_archived: archive,
    })
    setArchivingId(null)

    if (archiveError) {
      setActionError(archiveError.message)
      return
    }
    showToast(archive ? `${item.name} archived.` : `${item.name} restored.`)
    void loadItems()
  }

  const lotsByItem = new Map<number, OpenLot[]>()
  for (const lot of lots) {
    lotsByItem.set(lot.item_id, [...(lotsByItem.get(lot.item_id) ?? []), lot])
  }

  const active = items.filter((item) => !item.archived_at)
  const term = search.trim().toLowerCase()
  const shown = (stockFilter === 'Archived' ? items.filter((item) => item.archived_at) : active).filter(
    (item) =>
      (!typeFilter || item.item_type === typeFilter) &&
      (stockFilter === 'All' ||
        stockFilter === 'Archived' ||
        (stockFilter === 'In stock' && item.quantity > 0) ||
        (stockFilter === 'Out of stock' && item.quantity <= 0) ||
        (stockFilter === 'Needs price' && item.needs_price)) &&
      (!term || item.name.toLowerCase().includes(term) || String(item.item_id) === term.replace(/^#/, '')),
  )
  const outOfStock = active.filter((item) => item.quantity <= 0).length
  const stockValue = lotsValue(lots)
  // ₱0 is flagged like no price (almost always a price nobody set)
  const unpricedLots = lots.filter((l) => l.unit_cost === null || l.unit_cost === 0).length
  const needsPrice = active.filter((item) => item.needs_price).length

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(shown, `${typeFilter}|${stockFilter}|${search}`)
  const pane = paged.rows.find((item) => item.item_id === paneId) ?? paged.rows[0] ?? null
  const paneLots = pane ? (lotsByItem.get(pane.item_id) ?? []) : []

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Parts, tools and supplies on hand. Parts used on work orders are taken out automatically, oldest batch first."
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
          {
            label: 'Items tracked',
            value: String(active.length),
            note: needsPrice > 0 ? `${needsPrice} ${needsPrice === 1 ? 'needs' : 'need'} a price` : undefined,
          },
          { label: 'Out of stock', value: String(outOfStock), bad: outOfStock > 0 },
          {
            label: 'Stock value',
            value: formatMoney(stockValue),
            note:
              unpricedLots > 0
                ? `${unpricedLots} ${unpricedLots === 1 ? 'batch has' : 'batches have'} no price or ₱0`
                : undefined,
          },
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
      {!loading && !error && items.length === 0 && <EmptyState message="No inventory items yet." className="mt-4" />}

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
                      <th className={`${TH} text-right`}>Listed Price</th>
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
                          <td className={`${TD} text-right font-semibold tabular-nums ${item.quantity <= 0 ? 'text-red-700' : ''}`}>
                            {item.quantity} <span className="text-xs font-medium text-ink-muted">{item.unit}</span>
                          </td>
                          <td className={`${TD} text-right tabular-nums`}>
                            {item.needs_price || item.unit_cost === null ? (
                              <span className={`${CHIP} bg-amber-100 text-amber-800`}>Needs price</span>
                            ) : (
                              formatMoney(item.unit_cost)
                            )}
                          </td>
                          <td className={TD}>
                            <StockChip item={item} />
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
                {shown.length} of {stockFilter === 'Archived' ? items.length - active.length : active.length} items
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
                <StockChip item={pane} />
                {pane.needs_price && <span className={`${CHIP} bg-amber-100 text-amber-800`}>Needs price</span>}
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
                    <dd className={`${VALUE} tabular-nums`}>
                      {pane.quantity} {pane.unit}
                    </dd>
                  </div>
                  <div>
                    <dt className={LABEL}>Listed price (latest)</dt>
                    <dd className={`${VALUE} tabular-nums`}>
                      {pane.unit_cost !== null && !pane.needs_price ? formatMoney(pane.unit_cost) : 'Needs price'}
                    </dd>
                  </div>
                  <div className="col-span-full">
                    <dt className={LABEL}>Stock value (what the batches on hand cost)</dt>
                    <dd className={`${VALUE} tabular-nums`}>{formatMoney(lotsValue(paneLots))}</dd>
                  </div>
                </dl>

                <section>
                  <h3 className={GROUP}>
                    <span>Batches on hand</span>
                    <span className="text-[13px] font-medium text-ink-muted">Oldest used first</span>
                  </h3>
                  {paneLots.length === 0 ? (
                    <p className="text-sm text-ink-muted">Nothing on hand.</p>
                  ) : (
                    paneLots.map((lot, i) => (
                      <div key={lot.lot_id} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm last:border-0">
                        <span className="text-ink-secondary">
                          {formatDate(lot.received_at)}
                          {i === 0 && paneLots.length > 1 && <span className="ml-2 text-[13px] font-semibold text-primary">next to use</span>}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {lot.qty_remaining} {pane.unit} @ {lot.unit_cost !== null ? formatMoney(lot.unit_cost) : 'no price'}
                        </span>
                      </div>
                    ))
                  )}
                </section>

                <StockHistory item={pane} refreshKey={historyKey} />
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
                {pane.archived_at ? (
                  <button
                    type="button"
                    onClick={() => void handleArchive(pane, false)}
                    disabled={archivingId === pane.item_id}
                    className="btn-secondary px-4 text-sm font-medium"
                  >
                    {archivingId === pane.item_id ? 'Restoring...' : 'Restore'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleArchive(pane, true)}
                      disabled={archivingId === pane.item_id}
                      className="btn-secondary px-4 text-sm font-medium"
                    >
                      {archivingId === pane.item_id ? 'Archiving...' : 'Archive'}
                    </button>
                    <span className="flex-1" />
                    <button type="button" onClick={() => setStockAction({ item: pane, action: 'adjust' })} className="btn-secondary px-4 text-sm font-medium">
                      Adjust Stock
                    </button>
                    <button type="button" onClick={() => setStockAction({ item: pane, action: 'receive' })} className="btn-secondary px-4 text-sm font-medium">
                      Receive Stock
                    </button>
                  </>
                )}
                {pane.needs_price && !pane.archived_at ? (
                  <button type="button" onClick={() => setStockAction({ item: pane, action: 'price' })} className="btn-primary px-5 text-sm">
                    Set Price
                  </button>
                ) : (
                  <button type="button" onClick={() => setEditingItem(pane)} className="btn-primary flex items-center gap-2 px-5 text-sm">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" />
                    </svg>
                    Edit
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {showReport && <InventoryReportModal onClose={() => setShowReport(false)} />}

      {stockAction && (
        <StockActionModal
          item={stockAction.item}
          action={stockAction.action}
          onClose={() => setStockAction(null)}
          onSaved={(message) => {
            setStockAction(null)
            showToast(message)
            setHistoryKey((k) => k + 1)
            void loadItems()
          }}
        />
      )}

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
            void loadItems()
          }}
        />
      )}
    </div>
  )
}

export default InventorySection
