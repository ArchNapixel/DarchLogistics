// ComplianceExpiryAlerts: the notification bell in the dashboard header.
// Admin and Dispatcher also get trips that are badly overdue here (past
// their end time by more than app_settings.overdue_alert_hours, default 2,
// and not delivered / cancelled), linking to the trip -- so nobody has to
// notice a red badge on the board. It reloads every 5 minutes.
// Surfaces driver licenses and medical exams expiring within 30 days
// (Admin and Dispatcher see every driver, a Driver sees only their own) as a
// dismissible pop-up panel in the upper right, instead of the
// full-width banner strip this used to render under the header.
//
// Opening the panel clears the unread badge; the X on a row removes
// that row from the list. Both are in-memory only, so everything comes
// back on reload while the document is still expiring. Nothing is
// written anywhere -- the employees row is the only source of truth,
// and it's fixed on the Employees page.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import { isAdmin, isStaff } from '../lib/roles'
import { supabase } from '../lib/supabaseClient'
import { formatDate } from '../lib/format'

type ComplianceRow = {
  employee_id: number
  full_name: string
  driver_license_expiry_date: string | null
  medical_exam_expiry_date: string | null
  employment_status_id: number | null
}

type OverdueTrip = {
  tripId: number
  bookingId: number
  hoursOverdue: number
  driver: string | null
}

// Overdue trips are only listed once they're this many hours late
// (Settings: overdue_alert_hours).
const DEFAULT_OVERDUE_ALERT_HOURS = 2
const overdueKey = (t: OverdueTrip) => `trip-${t.tripId}`

type ExpiryAlert = {
  employeeId: number
  employeeName: string
  kind: 'Driver license' | 'Medical exam'
  // null = no licence on record at all (shown as "not on record").
  date: string | null
  daysRemaining: number
}

function daysUntil(date: string) {
  return Math.ceil(
    (new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86400000,
  )
}

// One employee can have both kinds expiring, so the name alone isn't
// unique enough to dismiss a single notification by.
function alertKey(alert: ExpiryAlert) {
  return `${alert.employeeName}-${alert.kind}`
}

// One notification's text: a link when `to` is given, else a plain block.
function Wrapper({
  to,
  onNavigate,
  children,
}: {
  to: string | null
  onNavigate: () => void
  children: React.ReactNode
}) {
  return to ? (
    <Link to={to} onClick={onNavigate} className="block flex-1 text-sm hover:bg-slate-50">
      {children}
    </Link>
  ) : (
    <div className="flex-1 text-sm">{children}</div>
  )
}

function ComplianceExpiryAlerts() {
  const { role, employeeId } = useAuth()
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([])
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([])
  // Read and dismissed are separate: opening the panel clears the badge
  // (you've seen them), but the notifications stay in the list until
  // they're individually removed with the X.
  const [readKeys, setReadKeys] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [overdue, setOverdue] = useState<OverdueTrip[]>([])

  // Staff only: trips more than `overdue_alert_hours` past their end time.
  const loadOverdue = useCallback(async () => {
    if (!isStaff(role)) return
    const { data: setting } = await supabase
      .from('app_settings')
      .select('setting_value')
      .eq('setting_key', 'overdue_alert_hours')
      .maybeSingle()
    const hours = Number(setting?.setting_value) > 0 ? Number(setting?.setting_value) : DEFAULT_OVERDUE_ALERT_HOURS
    const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
    const { data: trips } = await supabase
      .from('itineraries')
      .select('itinerary_id, booking_id, trip_end_at')
      .or('itinerary_status.is.null,itinerary_status.not.in.(Delivered,Cancelled)')
      .not('trip_end_at', 'is', null)
      .lt('trip_end_at', cutoff)
      .order('trip_end_at')
      .limit(50)
    if (!trips || trips.length === 0) {
      setOverdue([])
      return
    }
    const { data: crew } = await supabase
      .from('itinerary_crews')
      .select('itinerary_id, employee_id')
      .eq('crew_role', 'Driver')
      .eq('is_active', true)
      .in('itinerary_id', trips.map((t) => t.itinerary_id))
    const driverIds = [...new Set((crew ?? []).map((c) => c.employee_id))]
    const { data: people } = driverIds.length
      ? await supabase.from('employees').select('employee_id, full_name').in('employee_id', driverIds)
      : { data: [] as { employee_id: number; full_name: string }[] }
    const nameById = new Map((people ?? []).map((p) => [p.employee_id, p.full_name]))
    const driverOf = new Map((crew ?? []).map((c) => [c.itinerary_id, nameById.get(c.employee_id) ?? null]))
    setOverdue(
      trips.map((t) => ({
        tripId: t.itinerary_id,
        bookingId: t.booking_id,
        hoursOverdue: Math.floor((Date.now() - new Date(t.trip_end_at as string).getTime()) / 3_600_000),
        driver: driverOf.get(t.itinerary_id) ?? null,
      })),
    )
  }, [role])

  useEffect(() => {
    if (!isStaff(role)) return
    const first = window.setTimeout(() => void loadOverdue(), 0)
    const every = window.setInterval(() => void loadOverdue(), 5 * 60_000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(every)
    }
  }, [loadOverdue, role])

  const loadAlerts = useCallback(async () => {
    if (!isStaff(role) && role !== 'Driver') {
      setAlerts([])
      return
    }

    let query = supabase
      .from('employees')
      .select('employee_id, full_name, driver_license_expiry_date, medical_exam_expiry_date, employment_status_id')
      .eq('position', 'Driver')

    if (role === 'Driver') {
      if (!employeeId) {
        setAlerts([])
        return
      }
      query = query.eq('employee_id', employeeId)
    }

    const [{ data, error }, statuses] = await Promise.all([
      query,
      supabase.from('employment_status').select('status_id, status_name'),
    ])
    if (error || !data) {
      setAlerts([])
      return
    }
    // Deactivated / Terminated drivers don't drive any more -- no alerts.
    const inactiveIds = new Set(
      (statuses.data ?? [])
        .filter((s) => s.status_name === 'Deactivated' || s.status_name === 'Terminated')
        .map((s) => s.status_id),
    )

    const nextAlerts: ExpiryAlert[] = []
    data.forEach((row: ComplianceRow) => {
      if (row.employment_status_id !== null && inactiveIds.has(row.employment_status_id)) return
      // No licence on record at all is worse than one expiring soon.
      if (!row.driver_license_expiry_date) {
        nextAlerts.push({
          employeeId: row.employee_id,
          employeeName: row.full_name,
          kind: 'Driver license',
          date: null,
          daysRemaining: -Infinity,
        })
      }
      if (row.driver_license_expiry_date) {
        const daysRemaining = daysUntil(row.driver_license_expiry_date)
        if (daysRemaining <= 30) {
          nextAlerts.push({
            employeeId: row.employee_id,
            employeeName: row.full_name,
            kind: 'Driver license',
            date: row.driver_license_expiry_date,
            daysRemaining,
          })
        }
      }
      if (row.medical_exam_expiry_date) {
        const daysRemaining = daysUntil(row.medical_exam_expiry_date)
        if (daysRemaining <= 30) {
          nextAlerts.push({
            employeeId: row.employee_id,
            employeeName: row.full_name,
            kind: 'Medical exam',
            date: row.medical_exam_expiry_date,
            daysRemaining,
          })
        }
      }
    })

    // Missing first (-Infinity), then soonest; a plain subtraction of two
    // -Infinity values would be NaN.
    setAlerts(nextAlerts.sort((a, b) => (a.daysRemaining === b.daysRemaining ? 0 : a.daysRemaining - b.daysRemaining)))
  }, [employeeId, role])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAlerts()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAlerts])

  const visibleAlerts = alerts.filter(
    (alert) => !dismissedKeys.includes(alertKey(alert)),
  )
  const visibleOverdue = overdue.filter((t) => !dismissedKeys.includes(overdueKey(t)))
  const unreadCount =
    visibleAlerts.filter((alert) => !readKeys.includes(alertKey(alert))).length +
    visibleOverdue.filter((t) => !readKeys.includes(overdueKey(t))).length

  function handleToggle() {
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen) {
      setReadKeys([...alerts.map(alertKey), ...overdue.map(overdueKey)])
    }
  }

  // Nothing expiring (or a role that never gets these) -- no bell at all.
  if (alerts.length === 0 && overdue.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        aria-label="Notifications"
        className="flex h-11 w-11 items-center justify-center text-ink-secondary hover:bg-slate-100 hover:text-ink"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z M10 21h4" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute right-0.5 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-[2px] bg-orange-700 px-1 text-[11px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Transparent catcher so clicking anywhere else closes the
              panel, without a document-level listener. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />

          <div className="card fixed inset-x-4 top-16 z-40 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <p className="text-sm font-semibold text-slate-900">
                Notifications
              </p>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {visibleAlerts.length === 0 && visibleOverdue.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">
                No notifications.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {visibleOverdue.map((trip) => (
                  <div key={overdueKey(trip)} className="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
                    <Link
                      to={`/dashboard/bookings?booking=${trip.bookingId}&trip=${trip.tripId}`}
                      onClick={() => setOpen(false)}
                      className="block flex-1 text-sm hover:bg-slate-50"
                    >
                      <p className="font-medium text-slate-900">
                        Trip #{trip.tripId} · Booking #{trip.bookingId}
                      </p>
                      <p className="text-red-700">
                        {trip.hoursOverdue}+ {trip.hoursOverdue === 1 ? 'hour' : 'hours'} overdue
                        {trip.driver ? ` · ${trip.driver}` : ' · no driver'}
                      </p>
                    </Link>
                    <button
                      onClick={() => setDismissedKeys((prev) => [...prev, overdueKey(trip)])}
                      aria-label="Dismiss notification"
                      className="text-slate-400 hover:text-slate-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {visibleAlerts.map((alert) => (
                  <div
                    key={alertKey(alert)}
                    className="flex items-start gap-2 border-b border-slate-200 px-4 py-3 last:border-b-0"
                  >
                    {/* Admin: the notice opens that employee's edit form on the
                        Employees page, where the date is fixed. Dispatcher/Driver
                        can't edit it, so for them it stays plain text. */}
                    <Wrapper
                      to={isAdmin(role) ? `/dashboard/employees?employee=${alert.employeeId}` : null}
                      onNavigate={() => setOpen(false)}
                    >
                      <p className="font-medium text-slate-900">
                        {alert.employeeName}
                      </p>
                      <p className="text-orange-800">
                        {alert.date === null ? (
                          <>{alert.kind} not on record -- add it on the Employees page</>
                        ) : (
                          <>
                            {alert.kind}{' '}
                            {alert.daysRemaining < 0 ? 'expired' : 'expires'} on{' '}
                            {formatDate(alert.date)}
                            {alert.daysRemaining >= 0 &&
                              ` (${alert.daysRemaining} day${alert.daysRemaining === 1 ? '' : 's'} remaining)`}
                          </>
                        )}
                      </p>
                      {isAdmin(role) && (
                        <p className="mt-0.5 text-xs font-medium text-slate-600 underline">
                          Open employee to update →
                        </p>
                      )}
                    </Wrapper>
                    <button
                      onClick={() =>
                        setDismissedKeys((prev) => [...prev, alertKey(alert)])
                      }
                      aria-label="Dismiss notification"
                      className="text-slate-400 hover:text-slate-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default ComplianceExpiryAlerts
