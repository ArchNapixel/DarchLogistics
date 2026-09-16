// ClientDelinquencySection: three parts --
//  1. Currently delinquent clients (derived from the most recent entry
//     in client_delinquency_log per client), with an "Unmark" action.
//  2. Overdue Risk: clients not currently flagged, but whose balance is
//     overdue past the configurable threshold in Settings
//     (app_settings.delinquency_overdue_days_threshold) -- computed live
//     from paymentDue.ts, nothing is auto-written. "Mark as Delinquent"
//     pre-fills a suggested reason; staff still has to confirm it.
//  3. Full history log underneath, read-only, like the Work Order
//     Acceptance Log.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadCurrentlyDelinquentClients,
  loadOverdueRiskClients,
  loadDelinquencyThresholdDays,
  loadDelinquencyLog,
  markClientDelinquent,
  unmarkClientDelinquent,
  type CurrentDelinquentClient,
  type OverdueRiskClient,
  type DelinquencyLogEntry,
} from '../../../lib/clientDelinquency'

function ClientDelinquencySection() {
  const { employeeId } = useAuth()
  const [delinquent, setDelinquent] = useState<CurrentDelinquentClient[]>([])
  const [overdueRisk, setOverdueRisk] = useState<OverdueRiskClient[]>([])
  const [history, setHistory] = useState<DelinquencyLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyClientId, setBusyClientId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const [thresholdResult, delinquentResult, historyResult] = await Promise.all([
      loadDelinquencyThresholdDays(),
      loadCurrentlyDelinquentClients(),
      loadDelinquencyLog(),
    ])

    if (delinquentResult.error) {
      setError(delinquentResult.error)
      setLoading(false)
      return
    }
    if (historyResult.error) {
      setError(historyResult.error)
      setLoading(false)
      return
    }

    const riskResult = await loadOverdueRiskClients(thresholdResult.days)
    if (riskResult.error) {
      setError(riskResult.error)
      setLoading(false)
      return
    }

    const delinquentClientIds = new Set(delinquentResult.clients.map((c) => c.client_id))

    setDelinquent(delinquentResult.clients)
    setOverdueRisk(riskResult.clients.filter((c) => !delinquentClientIds.has(c.client_id)))
    setHistory(historyResult.entries)
    setError(null)
    setLoading(false)
  }

  async function handleMark(clientId: number, clientName: string, suggestedReason: string) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as done by you. Contact an admin.',
      )
      return
    }

    const reason = window.prompt(`Reason for marking ${clientName} as delinquent?`, suggestedReason)
    if (reason === null) return
    if (!reason.trim()) {
      setActionError('Enter a reason before saving.')
      return
    }

    setBusyClientId(clientId)
    setActionError(null)

    const { error: markError } = await markClientDelinquent({
      clientId,
      reason: reason.trim(),
      changedByEmployeeId: employeeId,
    })

    setBusyClientId(null)

    if (markError) {
      setActionError(markError)
      return
    }

    load()
  }

  async function handleUnmark(clientId: number, clientName: string) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as done by you. Contact an admin.',
      )
      return
    }

    const reason = window.prompt(`Reason for clearing ${clientName}'s delinquent status?`)
    if (reason === null) return
    if (!reason.trim()) {
      setActionError('Enter a reason before saving.')
      return
    }

    setBusyClientId(clientId)
    setActionError(null)

    const { error: unmarkError } = await unmarkClientDelinquent({
      clientId,
      reason: reason.trim(),
      changedByEmployeeId: employeeId,
    })

    setBusyClientId(null)

    if (unmarkError) {
      setActionError(unmarkError)
      return
    }

    load()
  }

  if (loading) {
    return <p className="text-slate-500">Loading client standing...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      {actionError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      <h3 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Currently Delinquent
      </h3>
      {delinquent.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No clients currently flagged.</p>
      ) : (
        <div className="mt-2 grid gap-3">
          {delinquent.map((client) => (
            <div
              key={client.client_id}
              className="rounded-xl border border-red-200 bg-red-50 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">{client.client_name}</p>
                <span className="text-xs text-slate-500">
                  Since {new Date(client.since).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-700">{client.reason}</p>
              <button
                onClick={() => handleUnmark(client.client_id, client.client_name)}
                disabled={busyClientId === client.client_id}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busyClientId === client.client_id ? 'Saving...' : 'Unmark'}
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 className="mt-8 text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Overdue Risk (not yet flagged)
      </h3>
      {overdueRisk.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No clients past the overdue threshold.</p>
      ) : (
        <div className="mt-2 grid gap-3">
          {overdueRisk.map((client) => (
            <div
              key={client.client_id}
              className="rounded-xl border border-amber-200 bg-amber-50 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">{client.client_name}</p>
                <span className="text-xs text-slate-500">
                  Overdue by {client.days_overdue}d (Booking #{client.booking_id})
                </span>
              </div>
              <button
                onClick={() =>
                  handleMark(
                    client.client_id,
                    client.client_name,
                    `Payment overdue by ${client.days_overdue} days`,
                  )
                }
                disabled={busyClientId === client.client_id}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busyClientId === client.client_id ? 'Saving...' : 'Mark as Delinquent'}
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 className="mt-8 text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Full History
      </h3>
      {history.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No history yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">By</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.log_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-900">{entry.client_name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        entry.action === 'Marked'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{entry.reason}</td>
                  <td className="px-4 py-3 text-slate-600">{entry.changed_by_name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(entry.created_at).toLocaleString()}
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

export default ClientDelinquencySection
