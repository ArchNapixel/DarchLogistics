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
//
// Clients are never deleted -- they're DEACTIVATED (Active / Deactivated
// tabs). The RPC set_client_active() sets clients.deactivated_at and bans
// the client's login in Supabase Auth (auth.users.banned_until), so they
// can't log in until reactivated; their bookings and payments stay.
import { useEffect, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import { fetchAll } from '../../../lib/dashboardExpenses'
import SetUpClientAccountModal from './SetUpClientAccountModal'
import ClientBookingHistoryModal from './ClientBookingHistoryModal'
import { loadCurrentlyDelinquentClients } from '../../../lib/clientDelinquency'
import { confirmDialog, promptDialog } from '../../../components/ConfirmDialog'
import { showToast } from '../../../components/Toast'
import { loadPaymentDueReport } from '../../../lib/paymentDue'
import { formatDate, formatMoney } from '../../../lib/format'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import EmptyState from '../../../components/EmptyState'

type Client = {
  client_id: number
  client_name: string
  email: string | null
  phone_number: string | null
  deactivated_at: string | null
  deactivation_reason: string | null
}

type AccountState = 'login' | 'pending'

const TABS = ['Active', 'Deactivated'] as const
type Tab = (typeof TABS)[number]
const tabOf = (c: Client): Tab => (c.deactivated_at ? 'Deactivated' : 'Active')

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
  const [tab, setTab] = useState<Tab>('Active')

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    setLoading(true)

    // Every page -- Supabase stops at 1000 rows per request.
    const { rows: clientRows, error: clientError } = await fetchAll<Client>((from, to) =>
      supabase
        .from('clients')
        .select('client_id, client_name, email, phone_number, deactivated_at, deactivation_reason')
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

  // Deactivate (reason required) or reactivate a client. Warns first if
  // the client still has an unfinished booking or owes money -- allowed
  // anyway, the bookings and balance stay on record.
  async function handleSetActive(client: Client, active: boolean) {
    setActionError(null)
    let reason: string | null = null

    if (!active) {
      const [openBookings, due] = await Promise.all([
        supabase
          .from('bookings')
          .select('booking_id', { count: 'exact', head: true })
          .eq('client_id', client.client_id)
          .not('booking_status', 'in', '(Delivered,Cancelled)'),
        loadPaymentDueReport(client.client_id),
      ])
      const owed = due.rows.reduce((sum, r) => sum + Math.max(r.balance_due, 0), 0)
      const warnings = [
        openBookings.count ? `${openBookings.count} unfinished booking${openBookings.count === 1 ? '' : 's'}` : null,
        owed > 0 ? `${formatMoney(owed)} still unpaid` : null,
      ].filter(Boolean)

      reason = await promptDialog({
        title: `Deactivate ${client.client_name}?`,
        message:
          (warnings.length > 0 ? `Heads up: ${warnings.join(' and ')}. ` : '') +
          "They won't be able to log in until reactivated. Their bookings and payments stay. Why are they being deactivated?",
        confirmLabel: 'Deactivate',
        danger: true,
      })
      if (reason === null) return
      if (!reason.trim()) {
        showToast('A reason is required.', 'error')
        return
      }
    } else if (
      !(await confirmDialog({
        title: `Reactivate ${client.client_name}?`,
        message: 'They will be able to log in again with their old username and password.',
        confirmLabel: 'Reactivate',
      }))
    ) {
      return
    }

    const { error: rpcError } = await supabase.rpc('set_client_active', {
      p_client_id: client.client_id,
      p_active: active,
      p_reason: reason?.trim() ?? null,
    })
    if (rpcError) {
      setActionError(rpcError.message)
      return
    }
    showToast(active ? `${client.client_name} reactivated.` : `${client.client_name} deactivated.`)
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
  const tabClients = clients.filter((c) => tabOf(c) === tab)
  const visibleClients = !query
    ? tabClients
    : tabClients.filter(
        (c) =>
          c.client_name.toLowerCase().includes(query) ||
          (c.email ?? '').toLowerCase().includes(query) ||
          (queryDigits.length > 0 && (c.phone_number ?? '').replace(/\D/g, '').includes(queryDigits)),
      )

  // One page at a time (back to page 1 when the search changes).
  const paged = usePaged(visibleClients, `${tab}|${search}`)
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

      <div className="mt-4 flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t} <span className="text-xs opacity-70">{clients.filter((c) => tabOf(c) === t).length}</span>
          </button>
        ))}
      </div>

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
      ) : tabClients.length === 0 ? (
        <EmptyState
          message={tab === 'Active' ? 'No active clients.' : 'No deactivated clients.'}
          className="mt-4"
        />
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
                      {client.deactivated_at && (
                        <span className="mt-0.5 block text-xs text-slate-500">
                          Deactivated {formatDate(client.deactivated_at)}
                          {client.deactivation_reason && ` -- ${client.deactivation_reason}`}
                        </span>
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
                      {account === undefined && !client.deactivated_at && (
                        <button
                          onClick={() => setSelectedClient(client)}
                          className="btn-secondary px-3 py-1.5 text-xs font-medium"
                        >
                          Set Up Account
                        </button>
                      )}
                      {client.deactivated_at ? (
                        <button
                          onClick={() => handleSetActive(client, true)}
                          className="ml-2 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900"
                        >
                          Reactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSetActive(client, false)}
                          className="ml-2 px-3 py-1.5 text-xs font-medium text-red-700 hover:text-red-900"
                        >
                          Deactivate
                        </button>
                      )}
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
