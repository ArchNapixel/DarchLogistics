// TripNotifications: the trip bell in the dashboard header for Drivers
// and Helpers. Rows come from `notifications`, written by database
// triggers whenever someone is assigned to a trip, removed from one, or
// their trip's time slot changes (itinerary_crews_notify /
// itineraries_after_reschedule) -- so it works whichever page made the
// change. Each person can only read and mark their own (RLS).
//
// The bell shows the unread count; opening it marks them read
// (read_at). Checks for new ones every minute. Clicking one goes to
// My Schedule. A trip they were removed from can't be opened any more
// (access follows active crew), so that one shows the trip number only.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { formatDateTime } from '../lib/format'
import { fetchNotifications, message, type TripNotification } from '../lib/tripNotifications'

function TripNotifications() {
  const { role, employeeId } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<TripNotification[]>([])
  const [open, setOpen] = useState(false)
  const isCrew = role === 'Driver' || role === 'Helper'

  useEffect(() => {
    if (!isCrew || !employeeId) return
    let cancelled = false
    const load = () =>
      fetchNotifications(employeeId)
        .then((rows) => !cancelled && setItems(rows))
        .catch((e: Error) => console.error('Could not load trip notifications', e))
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isCrew, employeeId])

  if (!isCrew || !employeeId) return null

  const unread = items.filter((n) => n.read_at === null)

  async function toggle() {
    const nextOpen = !open
    setOpen(nextOpen)
    if (!nextOpen || unread.length === 0) return
    // Seen = read. Update the screen straight away; the database follows.
    const readAt = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.read_at === null ? { ...n, read_at: readAt } : n)))
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('employee_id', employeeId)
      .is('read_at', null)
    if (error) console.error('Could not mark notifications read', error)
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={`Trip notifications${unread.length ? `, ${unread.length} unread` : ''}`}
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
              <p className="text-sm font-semibold text-slate-900">Trip notifications</p>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700">
                ✕
              </button>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No notifications yet.</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {items.map((n) => (
                  <li key={n.notification_id} className="border-b border-slate-200 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        navigate('/dashboard/schedule')
                      }}
                      className="block w-full px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <p className={`text-sm ${n.kind === 'removed' ? 'text-slate-600' : 'text-slate-900'}`}>{message(n)}</p>
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

export default TripNotifications
