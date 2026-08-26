// HistorySection: "My History" page for Driver/Mechanic -- a table of
// past trips (drivers) or work orders (mechanics).
//
// MOCK DATA -- replace with real Supabase query later. Nothing on this
// page reads from or writes to the database yet.
import { useState } from 'react'

type HistoryStatus = 'Completed' | 'Cancelled'

type HistoryEntry = {
  history_id: number
  date: string
  description: string
  status: HistoryStatus
}

// MOCK DATA -- replace with real Supabase query later.
const MOCK_HISTORY: HistoryEntry[] = [
  {
    history_id: 1,
    date: '2026-08-20',
    description: 'Cavite Warehouse → Batangas Port',
    status: 'Completed',
  },
  {
    history_id: 2,
    date: '2026-08-18',
    description: 'Replaced brake pads — Truck NGP 4521',
    status: 'Completed',
  },
  {
    history_id: 3,
    date: '2026-08-15',
    description: 'Manila South Harbor → Laguna Distribution Center',
    status: 'Completed',
  },
  {
    history_id: 4,
    date: '2026-08-12',
    description: 'Bulacan Cold Storage → Manila Pier 15',
    status: 'Cancelled',
  },
  {
    history_id: 5,
    date: '2026-08-09',
    description: 'Engine oil change — Truck NGP 8873',
    status: 'Completed',
  },
]

const STATUS_STYLES: Record<HistoryStatus, string> = {
  Completed: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

function HistoryStatusBadge({ status }: { status: HistoryStatus }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

function HistorySection() {
  const [history] = useState<HistoryEntry[]>(MOCK_HISTORY)

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">My History</h2>

      {history.length === 0 ? (
        <p className="mt-4 text-slate-500">No past trips or work orders yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr
                  key={entry.history_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-600">{entry.date}</td>
                  <td className="px-4 py-3 text-slate-900">
                    {entry.description}
                  </td>
                  <td className="px-4 py-3">
                    <HistoryStatusBadge status={entry.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default HistorySection
