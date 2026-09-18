import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { isAdmin } from '../lib/roles'
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

function ComplianceExpiryAlerts() {
  const { role, employeeId } = useAuth()
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([])

  const loadAlerts = useCallback(async () => {
    if (!isAdmin(role) && role !== 'Driver') {
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

  if (alerts.length === 0) return null

  return (
    <div className="border-b border-orange-200 bg-orange-50 px-6 py-3">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-semibold text-orange-900">
          Compliance expiry notifications
        </p>
        <div className="mt-1 grid gap-1 text-sm text-orange-800">
          {alerts.map((alert) => (
            <p key={`${alert.employeeName}-${alert.kind}`}>
              {alert.employeeName}: {alert.kind} {alert.daysRemaining < 0 ? 'expired' : 'expires'} on {alert.date}
              {alert.daysRemaining >= 0 && ` (${alert.daysRemaining} day${alert.daysRemaining === 1 ? '' : 's'} remaining)`}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ComplianceExpiryAlerts
