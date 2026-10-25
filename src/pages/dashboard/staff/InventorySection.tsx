// InventorySection: basic CRUD table for maintenance inventory (tools,
// parts, supplies, equipment). Same list/Add/Edit/Delete pattern as
// EmployeesSection.tsx and FleetSection.tsx -- a separate actionError
// state for delete failures so the list stays visible underneath a
// failed-delete message instead of disappearing.
import { useEffect, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import AddInventoryItemModal, {
  type EditableInventoryItem,
} from './AddInventoryItemModal'
import InventoryReportModal from './InventoryReportModal'
import { confirmDialog } from '../../../components/ConfirmDialog'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

type InventoryItem = {
  item_id: number
  name: string
  item_type: string
  quantity: number
  unit_cost: number | null
}

const TYPE_STYLES: Record<string, string> = {
  Tools: 'bg-blue-100 text-blue-700',
  Parts: 'bg-purple-100 text-purple-700',
  Supplies: 'bg-green-100 text-green-700',
  Equipment: 'bg-orange-100 text-orange-700',
  Other: 'bg-gray-100 text-gray-700',
}

function TypeBadge({ type }: { type: string }) {
  const styles = TYPE_STYLES[type] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${styles}`}>
      {type}
    </span>
  )
}

function InventorySection() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    loadItems()
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

    const { error: deleteError } = await supabase
      .from('inventory_items')
      .delete()
      .eq('item_id', item.item_id)

    setDeletingId(null)

    if (deleteError) {
      // '23503' is Postgres's error code for a foreign key violation.
      // Uses a separate actionError state (not the page-load `error`)
      // so a failed delete shows a banner without hiding the whole list.
      if (deleteError.code === '23503') {
        setActionError(
          `Can't delete ${item.name} -- it's still referenced elsewhere. ` +
            `Remove those references first, then try again.`,
        )
      } else {
        setActionError(deleteError.message)
      }
      return
    }

    loadItems()
  }

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(items, '')
  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Parts, tools and supplies in stock."
        actions={<>
          <button
            onClick={() => setShowAdd(true)}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            Add Item
          </button>
          <button
            onClick={() => setShowReport(true)}
            className="border border-line-control px-4 py-2 text-sm font-medium text-ink-metric hover:bg-slate-100 rounded-[2px]"
          >
            Print Inventory Report
          </button>
        </>}
      />

      {actionError && (
        <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {loading && <p className="mt-4 text-slate-500">Loading inventory...</p>}
      {!loading && error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <EmptyState message="No inventory items yet." className="mt-4" />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="mt-4 overflow-x-auto border-2 border-line-card bg-white">
          <table className="w-full text-left text-sm text-ink-metric">
            <thead>
              <tr>
                <th className="px-4 py-2.5">ID</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Quantity</th>
                <th className="px-4 py-2.5">Unit Price</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((item) => (
                <tr
                  key={item.item_id}
                  className="border-b border-slate-200 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">#{item.item_id}</td>
                  <td className="px-4 py-3 text-slate-900">{item.name}</td>
                  <td className="px-4 py-3">
                    <TypeBadge type={item.item_type} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.quantity}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.unit_cost !== null ? (
                      formatMoney(item.unit_cost)
                    ) : (
                      <span className="text-xs font-medium text-amber-700">No price set</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button
                        onClick={() => setEditingItem(item)}
                        className="font-medium text-slate-600 hover:text-slate-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        disabled={deletingId === item.item_id}
                        className="font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {deletingId === item.item_id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager {...paged.pager} />
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
