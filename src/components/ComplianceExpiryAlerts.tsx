// ComplianceExpiryAlerts: the notification bell in the dashboard header.
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
import { isStaff } from '../lib/roles'
import { supabase } from '../lib/supabaseClient'

type ComplianceRow = {
  employee_id: number
  full_name: string
  driver_license_expiry_date: string | null
  medical_exam_expiry_date: string | null
}

type ExpiryAlert = {
  employeeName: string
  kind: 'Driver license' | 'Medical exam'
  date: string
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

function ComplianceExpiryAlerts() {
  const { role, employeeId } = useAuth()
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([])
  const [dismissedKeys, setDismissedKeys] = useState<string[]>([])
  // Read and dismissed are separate: opening the panel clears the badge
  // (you've seen them), but the notifications stay in the list until
  // they're individually removed with the X.
  const [readKeys, setReadKeys] = useState<string[]>([])
  const [open, setOpen] = useState(false)

  const loadAlerts = useCallback(async () => {
    if (!isStaff(role) && role !== 'Driver') {
      setAlerts([])
      return
    }

    let query = supabase
      .from('employees')
      .select('employee_id, full_name, driver_license_expiry_date, medical_exam_expiry_date')
      .eq('position', 'Driver')

    if (role === 'Driver') {
      if (!employeeId) {
        setAlerts([])
        return
      }
      query = query.eq('employee_id', employeeId)
    }

    const { data, error } = await query
    if (error || !data) {
      setAlerts([])
      return
    }

    const nextAlerts: ExpiryAlert[] = []
    data.forEach((row: ComplianceRow) => {
      if (row.driver_license_expiry_date) {
        const daysRemaining = daysUntil(row.driver_license_expiry_date)
        if (daysRemaining <= 30) {
          nextAlerts.push({
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
            employeeName: row.full_name,
            kind: 'Medical exam',
            date: row.medical_exam_expiry_date,
            daysRemaining,
          })
        }
      }
    })

    setAlerts(nextAlerts.sort((a, b) => a.daysRemaining - b.daysRemaining))
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
  const unreadCount = visibleAlerts.filter(
    (alert) => !readKeys.includes(alertKey(alert)),
  ).length

  function handleToggle() {
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen) {
      setReadKeys(alerts.map(alertKey))
    }
  }

  // Nothing expiring (or a role that never gets these) -- no bell at all.
  if (alerts.length === 0) return null

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        aria-label="Notifications"
        className="flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <svg width="26" height="26" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 3a4 4 0 0 0-4 4v3l-1.5 2.5h11L14 10V7a4 4 0 0 0-4-4zM8.5 15.5a1.5 1.5 0 0 0 3 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Transparent catcher so clicking anywhere else closes the
              panel, without a document-level listener. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />

          <div className="fixed inset-x-4 top-16 z-40 rounded-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <p className="text-sm font-semibold text-slate-900">
                Compliance expiry notifications
              </p>
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {visibleAlerts.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">
                No notifications.
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {visibleAlerts.map((alert) => (
                  <div
                    key={alertKey(alert)}
                    className="flex items-start gap-2 border-b border-slate-100 px-4 py-3 last:border-b-0"
                  >
                    <div className="flex-1 text-sm">
                      <p className="font-medium text-slate-900">
                        {alert.employeeName}
                      </p>
                      <p className="text-orange-800">
                        {alert.kind}{' '}
                        {alert.daysRemaining < 0 ? 'expired' : 'expires'} on{' '}
                        {alert.date}
                        {alert.daysRemaining >= 0 &&
                          ` (${alert.daysRemaining} day${alert.daysRemaining === 1 ? '' : 's'} remaining)`}
                      </p>
                    </div>
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
