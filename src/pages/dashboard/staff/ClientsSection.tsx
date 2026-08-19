// ClientsSection: lists every client (created automatically when staff
// approves a quote -- see QuoteReviewModal) and whether they have a
// login account set up yet. "Set Up Account" creates a pending `users`
// row (no login attached yet); the actual login still has to be created
// manually in Supabase Dashboard -> Authentication -> Users, using the
// same email, and shared with the client directly. The client's own
// first login auto-links the two (see AuthContext.tsx).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import SetUpClientAccountModal from './SetUpClientAccountModal'

type Client = {
  client_id: number
  client_name: string
  email: string | null
  phone_number: string | null
}

function ClientsSection() {
  const [clients, setClients] = useState<Client[]>([])
  const [linkedClientIds, setLinkedClientIds] = useState<Set<number>>(
    new Set(),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)

    const { data: clientRows, error: clientError } = await supabase
      .from('clients')
      .select('client_id, client_name, email, phone_number')
      .order('client_name', { ascending: true })

    if (clientError) {
      setError(clientError.message)
      setLoading(false)
      return
    }

    const { data: linkedRows, error: linkedError } = await supabase
      .from('users')
      .select('client_id')
      .not('client_id', 'is', null)

    if (linkedError) {
      setError(linkedError.message)
      setLoading(false)
      return
    }

    setClients(clientRows)
    setLinkedClientIds(
      new Set(linkedRows.map((row) => row.client_id as number)),
    )
    setError(null)
    setLoading(false)
  }

  // Called by the modal after successfully creating the pending row.
  function handleAccountCreated(clientId: number) {
    setLinkedClientIds((prev) => new Set(prev).add(clientId))
    setSelectedClient(null)
  }

  if (loading) {
    return <p className="text-slate-500">Loading clients...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Clients</h2>

      {clients.length === 0 ? (
        <p className="mt-4 text-slate-500">
          No clients yet -- these are created automatically when a quote
          request is approved.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const isLinked = linkedClientIds.has(client.client_id)
                return (
                  <tr
                    key={client.client_id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 text-slate-900">
                      {client.client_name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {client.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {client.phone_number ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          isLinked
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {isLinked ? 'Set Up' : 'Not Set Up'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isLinked && (
                        <button
                          onClick={() => setSelectedClient(client)}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          Set Up Account
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedClient && (
        <SetUpClientAccountModal
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onCreated={handleAccountCreated}
        />
      )}
    </div>
  )
}

export default ClientsSection
