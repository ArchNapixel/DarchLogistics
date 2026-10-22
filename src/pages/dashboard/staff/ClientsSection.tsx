// ClientsSection: lists every client -- created when staff approve a quote
// (QuoteReviewModal) or when a client signs up at Client Login -- and
// whether they can log in. "Set Up Account" creates a real login for the
// client in one step (SetUpClientAccountModal -> create-user-account Edge
// Function). The Account column reads the client's `users` row:
//   Has login      = a users row linked to a Supabase Auth account
//   Login pending  = an old-style users row with no Auth account yet
//                    (auth_user_id null -- from before the Edge Function)
//   No account     = no users row at all
// "Possible duplicate" marks clients sharing an email or phone with
// another client -- usually someone who signed up themselves after a
// quote had already created their record.
import { useEffect, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import { fetchAll } from '../../../lib/dashboardExpenses'
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

type AccountState = 'login' | 'pending'

function ClientsSection() {
  const [clients, setClients] = useState<Client[]>([])
  // client_id -> 'login' / 'pending'; absent = no account.
  const [accountByClient, setAccountByClient] = useState<Map<number, AccountState>>(new Map())
  const [delinquentClientIds, setDelinquentClientIds] = useState<Set<number>>(
    new Set(),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [viewingClient, setViewingClient] = useState<Client | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)

    // Every page -- Supabase stops at 1000 rows per request.
    const { rows: clientRows, error: clientError } = await fetchAll<Client>((from, to) =>
      supabase
        .from('clients')
        .select('client_id, client_name, email, phone_number')
        .order('client_name', { ascending: true })
        .order('client_id', { ascending: true })
        .range(from, to),
    )

    if (clientError) {
      setError(clientError)
      setLoading(false)
      return
    }

    const { rows: linkedRows, error: linkedError } = await fetchAll<{
      client_id: number
      auth_user_id: string | null
    }>((from, to) =>
      supabase
        .from('users')
        .select('client_id, auth_user_id')
        .not('client_id', 'is', null)
        .range(from, to),
    )

    if (linkedError) {
      setError(linkedError)
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

    // A real login wins over a pending row if a client somehow has both.
    const accounts = new Map<number, AccountState>()
    for (const row of linkedRows) {
      if (row.auth_user_id) accounts.set(row.client_id, 'login')
      else if (!accounts.has(row.client_id)) accounts.set(row.client_id, 'pending')
    }

    setDelinquentClientIds(new Set(delinquentClients.map((c) => c.client_id)))
    setClients(clientRows)
    setAccountByClient(accounts)
    setError(null)
    setLoading(false)
  }

  // Called by the modal after the login was created.
  function handleAccountCreated(clientId: number) {
    setAccountByClient((prev) => new Map(prev).set(clientId, 'login'))
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

  // Emails / phone numbers used by more than one client (case and spaces
  // ignored) -- those clients get a "Possible duplicate" tag.
  const keyCounts = new Map<string, number>()
  const keysOf = (c: Client) =>
    [
      c.email?.trim().toLowerCase() ? `e:${c.email.trim().toLowerCase()}` : null,
      c.phone_number?.replace(/\D/g, '') ? `p:${c.phone_number.replace(/\D/g, '')}` : null,
    ].filter((k): k is string => k !== null)
  for (const c of clients) for (const k of keysOf(c)) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1)
  const isPossibleDuplicate = (c: Client) => keysOf(c).some((k) => (keyCounts.get(k) ?? 0) > 1)

  // Search: name, email or phone (digits only for the phone, so
  // "0966 047" finds 09660475467).
  const query = search.trim().toLowerCase()
  const queryDigits = query.replace(/\D/g, '')
  const visibleClients = !query
    ? clients
    : clients.filter(
        (c) =>
          c.client_name.toLowerCase().includes(query) ||
          (c.email ?? '').toLowerCase().includes(query) ||
          (queryDigits.length > 0 && (c.phone_number ?? '').replace(/\D/g, '').includes(queryDigits)),
      )

  // One page at a time (back to page 1 when the search changes).
  const paged = usePaged(visibleClients, search)
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

      {clients.length > 0 && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or phone"
          aria-label="Search clients"
          className="mt-4 w-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none sm:max-w-sm"
        />
      )}

      {clients.length === 0 ? (
        <EmptyState message="No clients yet." hint="These are created when a quote request is approved or a client signs up." className="mt-4" />
      ) : visibleClients.length === 0 ? (
        <p className="mt-4 text-slate-500">
          No clients match "{search}".{' '}
          <button
            type="button"
            onClick={() => setSearch('')}
            className="font-medium text-slate-700 underline hover:text-slate-900"
          >
            Clear search
          </button>
        </p>
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
              {paged.rows.map((client) => {
                const account = accountByClient.get(client.client_id)
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
                      {isPossibleDuplicate(client) && (
                        <span
                          className="ml-2 bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                          title="Another client has the same email or phone number"
                        >
                          Possible duplicate
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {client.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {client.phone_number ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={account === 'login' ? 'Set Up' : 'Not Set Up'}
                        label={
                          account === 'login'
                            ? 'Has login'
                            : account === 'pending'
                              ? 'Login pending'
                              : 'No account'
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* Only with no users row at all -- a "Login pending"
                          client already has one, and the Edge Function
                          would add a second. */}
                      {account === undefined && (
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
          <Pager {...paged.pager} />
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
