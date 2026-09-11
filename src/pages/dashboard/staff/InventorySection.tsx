// InventorySection: basic CRUD table for maintenance inventory (tools,
// parts, supplies, equipment). Same list/Add/Edit/Delete pattern as
// EmployeesSection.tsx and FleetSection.tsx -- a separate actionError
// state for delete failures so the list stays visible underneath a
// failed-delete message instead of disappearing.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import AddInventoryItemModal, {
  type EditableInventoryItem,
} from './AddInventoryItemModal'

type InventoryItem = {
  item_id: number
  name: string
  item_type: string
  quantity: number
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
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
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
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    loadItems()
  }, [])

  async function loadItems() {
    setLoading(true)

    const { data, error: loadError } = await supabase
      .from('inventory_items')
      .select('item_id, name, item_type, quantity')
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
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) {
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Inventory</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Add Item
        </button>
      </div>

      {actionError && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {loading && <p className="mt-4 text-slate-500">Loading inventory...</p>}
      {!loading && error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="mt-4 text-slate-500">No inventory items yet.</p>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Quantity</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.item_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">#{item.item_id}</td>
                  <td className="px-4 py-3 text-slate-900">{item.name}</td>
                  <td className="px-4 py-3">
                    <TypeBadge type={item.item_type} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.quantity}</td>
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
        </div>
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
            loadItems()
          }}
        />
      )}
    </div>
  )
}

export default InventorySection
