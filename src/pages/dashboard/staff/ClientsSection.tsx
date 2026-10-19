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
import ClientBookingHistoryModal from './ClientBookingHistoryModal'
import { loadCurrentlyDelinquentClients } from '../../../lib/clientDelinquency'
import { confirmDialog } from '../../../components/ConfirmDialog'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import EmptyState from '../../../components/EmptyState'

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
  const [delinquentClientIds, setDelinquentClientIds] = useState<Set<number>>(
    new Set(),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [viewingClient, setViewingClient] = useState<Client | null>(null)

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

    const { clients: delinquentClients, error: delinquentError } =
      await loadCurrentlyDelinquentClients()

    if (delinquentError) {
      setError(delinquentError)
      setLoading(false)
      return
    }

    setDelinquentClientIds(new Set(delinquentClients.map((c) => c.client_id)))
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

  // Delete a client. Same pattern as Employees: Postgres refuses (23503)
  // if bookings, quotes, etc. still point at the client.
  async function handleDelete(client: Client) {
    if (
      !(await confirmDialog({
        title: `Delete ${client.client_name}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return
    }

    setActionError(null)

    // .select() so a silent RLS no-op (0 rows deleted) is caught below.
    const { data, error: deleteError } = await supabase
      .from('clients')
      .delete()
      .eq('client_id', client.client_id)
      .select('client_id')

    if (deleteError) {
      setActionError(
        deleteError.code === '23503'
          ? `Can't delete ${client.client_name} -- they're still referenced elsewhere (e.g. bookings, quotes or a login account). Remove those first, then try again.`
          : deleteError.message,
      )
      return
    }
    if (!data || data.length === 0) {
      setActionError(`Could not delete ${client.client_name} (no permission, or already deleted).`)
      return
    }

    loadClients()
  }

  if (loading) {
    return <p className="text-slate-500">Loading clients...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      <PageHeader title="Clients" subtitle="Client accounts, logins and booking history." />

      {actionError && (
        <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>
      )}

      {clients.length === 0 ? (
        <EmptyState message="No clients yet." hint="These are created automatically when a quote request is approved." className="mt-4" />
      ) : (
        <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
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
                const isDelinquent = delinquentClientIds.has(client.client_id)
                return (
                  <tr
                    key={client.client_id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 text-slate-900">
                      <button
                        onClick={() => setViewingClient(client)}
                        className="font-medium text-slate-900 underline decoration-slate-300 hover:text-slate-700"
                      >
                        {client.client_name}
                      </button>
                      {isDelinquent && (
                        <span className="ml-2"><StatusBadge status="Delinquent" /></span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {client.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {client.phone_number ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={isLinked ? 'Set Up' : 'Not Set Up'} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isLinked && (
                        <button
                          onClick={() => setSelectedClient(client)}
                          className="btn-secondary px-3 py-1.5 text-xs font-medium"
                        >
                          Set Up Account
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(client)}
                        className="ml-2 px-3 py-1.5 text-xs font-medium text-red-700 hover:text-red-900"
                      >
                        Delete
                      </button>
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

      {viewingClient && (
        <ClientBookingHistoryModal
          client={viewingClient}
          onClose={() => setViewingClient(null)}
        />
      )}
    </div>
  )
}

export default ClientsSection
