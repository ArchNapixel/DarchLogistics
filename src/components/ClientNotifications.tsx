// ClientNotifications: the bell in the client portal's header -- "Booking
// #12 was updated: ..." when staff change a booking (lib/clientNotifications.ts).
// Same look as the drivers' TripNotifications: unread count on the bell,
// opening it marks them read, checks again every minute, clicking one
// opens My Bookings.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatDateTime } from '../lib/format'
import {
  fetchClientNotifications,
  markClientNotificationsRead,
  type ClientNotification,
} from '../lib/clientNotifications'

function ClientNotifications() {
  const { role, clientId } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<ClientNotification[]>([])
  const [open, setOpen] = useState(false)
  const isClient = role === 'Client' && clientId !== null

  useEffect(() => {
    if (!isClient || clientId === null) return
    let cancelled = false
    const load = () =>
      fetchClientNotifications(clientId)
        .then((rows) => !cancelled && setItems(rows))
        .catch((e: Error) => console.error('Could not load booking notifications', e))
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isClient, clientId])

  if (!isClient || clientId === null) return null

  const unread = items.filter((n) => n.read_at === null)

  async function toggle() {
    const nextOpen = !open
    setOpen(nextOpen)
    if (!nextOpen || unread.length === 0 || clientId === null) return
    // Seen = read. Update the screen straight away; the database follows.
    const readAt = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.read_at === null ? { ...n, read_at: readAt } : n)))
    const error = await markClientNotificationsRead(clientId, readAt)
    if (error) console.error('Could not mark notifications read', error)
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={`Booking updates${unread.length ? `, ${unread.length} unread` : ''}`}
        className="relative flex h-11 w-11 items-center justify-center text-ink-secondary hover:bg-slate-100 hover:text-ink"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z M10 21h4" />
        </svg>
        {unread.length > 0 && (
          <span className="absolute right-0.5 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-[2px] bg-red-700 px-1 text-[11px] font-bold text-white">
            {unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="card fixed inset-x-4 top-16 z-40 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <p className="text-sm font-semibold text-slate-900">Booking updates</p>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700">
                ✕
              </button>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No updates yet.</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {items.map((n) => (
                  <li key={n.notification_id} className="border-b border-slate-200 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        navigate('/dashboard/bookings')
                      }}
                      className="block w-full px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <p className="text-sm text-slate-900">{n.message}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(n.created_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ClientNotifications
