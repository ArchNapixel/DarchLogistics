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
import { Link } from 'react-router-dom'
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

// One booking of a client (the panel's Bookings list and "Latest booking").
type ClientBooking = {
  booking_id: number
  client_id: number
  booking_date: string
  booking_status: string | null
  rate_of_delivery_service: number | null
}

// A quote of theirs waiting on staff (new, or the client countered).
type OpenQuote = {
  quote_request_id: number
  client_id: number
  reference_code: string | null
  proposed_rate: number | null
  delivery_order_count: number | null
  preferred_pickup_date: string | null
  request_status: string
}

// What a client owes now (Payments Due rules), and whether any of it is past due.
type Balance = { owed: number; overdue: boolean }

// Table spacing from the canvas board: 20px at the edges, 16px between columns.
const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const SUB = 'block truncate text-[13px] leading-[18px] text-ink-muted'
const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'text-[15px] leading-[22px] font-medium text-ink'
const BOOKING_STATUS_LABELS: Record<string, string> = { InProgress: 'In Progress' }

function Chevron({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

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
  const [bookingsByClient, setBookingsByClient] = useState<Map<number, ClientBooking[]>>(new Map())
  const [tripsByBooking, setTripsByBooking] = useState<Map<number, { total: number; delivered: number }>>(new Map())
  const [balanceByClient, setBalanceByClient] = useState<Map<number, Balance>>(new Map())
  const [quotesByClient, setQuotesByClient] = useState<Map<number, OpenQuote[]>>(new Map())
  // The client shown in the right panel (null = first on the page).
  const [paneId, setPaneId] = useState<number | null>(null)

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
    // Bookings (newest first), what each client owes, and quotes waiting on staff.
    const [bookingsResult, dueResult, quotesResult] = await Promise.all([
      fetchAll<ClientBooking>((from, to) =>
        supabase
          .from('bookings')
          .select('booking_id, client_id, booking_date, booking_status, rate_of_delivery_service')
          .order('booking_date', { ascending: false })
          .order('booking_id', { ascending: false })
          .range(from, to),
      ),
      loadPaymentDueReport(undefined, { includeSettled: true }),
      fetchAll<OpenQuote>((from, to) =>
        supabase
          .from('quote_requests')
          .select('quote_request_id, client_id, reference_code, proposed_rate, delivery_order_count, preferred_pickup_date, request_status')
          .in('request_status', ['Pending', 'Countered'])
          .not('client_id', 'is', null)
          .order('created_at', { ascending: false })
          .range(from, to),
      ),
    ])
    const extraError = bookingsResult.error ?? dueResult.error ?? quotesResult.error
    if (extraError) {
      setError(extraError)
      setLoading(false)
      return
    }
    const byClient = new Map<number, ClientBooking[]>()
    for (const b of bookingsResult.rows) byClient.set(b.client_id, [...(byClient.get(b.client_id) ?? []), b])
    const balances = new Map<number, Balance>()
    const trips = new Map<number, { total: number; delivered: number }>()
    for (const r of dueResult.rows) {
      trips.set(r.booking_id, { total: r.total_trips, delivered: r.completed_trips })
      const current = balances.get(r.client_id) ?? { owed: 0, overdue: false }
      balances.set(r.client_id, {
        owed: current.owed + Math.max(r.balance_due, 0),
        overdue: current.overdue || (r.balance_due > 0 && r.days_until_due !== null && r.days_until_due < 0),
      })
    }
    const quotes = new Map<number, OpenQuote[]>()
    for (const q of quotesResult.rows) quotes.set(q.client_id, [...(quotes.get(q.client_id) ?? []), q])
    setBookingsByClient(byClient)
    setTripsByBooking(trips)
    setBalanceByClient(balances)
    setQuotesByClient(quotes)

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
  // Right panel: the clicked client, else the first one on this page.
  const paneClient = paged.rows.find((c) => c.client_id === paneId) ?? paged.rows[0] ?? null
  const paneAccount = paneClient ? accountByClient.get(paneClient.client_id) : undefined
  const paneBookings = paneClient ? (bookingsByClient.get(paneClient.client_id) ?? []) : []
  const paneQuotes = paneClient ? (quotesByClient.get(paneClient.client_id) ?? []) : []
  if (loading) {
    return <p className="text-slate-500">Loading clients...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      <PageHeader title="Clients" subtitle="Client accounts, their bookings and what they owe." />

      {actionError && (
        <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>
      )}

      {/* Tabs on the left, search on the right (one toolbar row) */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex h-11 items-center gap-2.5 rounded-[2px] border px-5 text-sm font-semibold ${
              tab === t ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
            }`}
          >
            {t}
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] px-1.5 text-xs font-bold ${
                tab === t ? 'bg-white text-primary' : 'bg-primary text-white'
              }`}
            >
              {clients.filter((c) => tabOf(c) === t).length}
            </span>
          </button>
        ))}
        {clients.length > 0 && (
          <label className="ml-auto flex w-full items-center gap-3 text-sm font-medium text-ink-secondary sm:w-auto">
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email or phone"
              className="min-h-11 min-w-0 flex-1 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-normal text-ink-metric focus:border-primary sm:w-80 sm:flex-none"
            />
          </label>
        )}
      </div>

      {clients.length === 0 ? (
        <EmptyState message="No clients yet." hint="These are created when a quote request is approved or a client signs up." className="mt-4" />
      ) : tabClients.length === 0 ? (
        <EmptyState
          message={tab === 'Active' ? 'No active clients.' : 'No deactivated clients.'}
          className="mt-4"
        />
      ) : visibleClients.length === 0 ? (
        <p className="mt-4 text-ink-muted">
          No clients match "{search}".{' '}
          <button type="button" onClick={() => setSearch('')} className="font-semibold text-primary underline">
            Clear search
          </button>
        </p>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_640px] xl:items-start">
          <section aria-label="Client list" className="card flex min-h-[calc(100dvh-15rem)] flex-col">
            <div className="flex-1 overflow-x-auto">
              {/* Header row style comes from index.css (thead th). */}
              <table className="w-full min-w-[720px] table-fixed text-left text-sm text-ink-metric">
                <colgroup>
                  {['', '180px', '220px', '170px', '52px'].map((width, i) => (
                    <col key={i} style={width ? { width } : undefined} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className={TH}>Client</th>
                    <th className={TH}>Contact</th>
                    <th className={TH}>Latest Booking</th>
                    <th className={TH}>Balance Due</th>
                    <th className={TH}>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((client) => {
                    const latest = bookingsByClient.get(client.client_id)?.[0]
                    const balance = balanceByClient.get(client.client_id)
                    const active = paneClient?.client_id === client.client_id
                    return (
                      <tr
                        key={client.client_id}
                        onClick={() => setPaneId(client.client_id)}
                        aria-current={active || undefined}
                        className={`h-[60px] cursor-pointer border-b border-slate-200 ${
                          active ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className={TD}>
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-semibold text-ink">{client.client_name}</span>
                            {delinquentClientIds.has(client.client_id) && <StatusBadge status="Delinquent" />}
                            {isPossibleDuplicate(client) && (
                              <span
                                className="rounded-[2px] bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
                                title="Another client has the same email or phone number"
                              >
                                Possible duplicate
                              </span>
                            )}
                          </span>
                          {client.deactivated_at && <span className={SUB}>Deactivated {formatDate(client.deactivated_at)}</span>}
                        </td>
                        <td className={TD}>
                          <span className="block truncate tabular-nums">{client.phone_number ?? '—'}</span>
                          {client.email && <span className={SUB}>{client.email}</span>}
                        </td>
                        <td className={TD}>
                          {latest ? (
                            <>
                              <span className="block font-semibold">Booking #{latest.booking_id}</span>
                              <span className={SUB}>
                                {formatDate(latest.booking_date)} ·{' '}
                                {BOOKING_STATUS_LABELS[latest.booking_status ?? ''] ?? latest.booking_status ?? 'Confirmed'}
                              </span>
                            </>
                          ) : (
                            <span className="text-ink-muted">No bookings yet</span>
                          )}
                        </td>
                        <td className={TD}>
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold tabular-nums">{formatMoney(balance?.owed ?? 0)}</span>
                            {balance && balance.owed > 0 ? (
                              balance.overdue && <StatusBadge status="Overdue" />
                            ) : (
                              (bookingsByClient.get(client.client_id)?.length ?? 0) > 0 && (
                                <StatusBadge status="Paid" label="Paid up" icon />
                              )
                            )}
                          </span>
                        </td>
                        <td className={TD}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setPaneId(client.client_id)
                            }}
                            aria-label={`Open ${client.client_name}`}
                            className="flex h-11 w-11 items-center justify-center text-primary"
                          >
                            <Chevron />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
              <span>
                {paged.pager.pageCount > 1
                  ? `Page ${paged.pager.page + 1} of ${paged.pager.pageCount}`
                  : `${visibleClients.length} ${visibleClients.length === 1 ? 'client' : 'clients'}`}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                  disabled={paged.pager.page === 0}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                  disabled={paged.pager.page >= paged.pager.pageCount - 1}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  Next ›
                </button>
              </span>
            </div>
          </section>

          {paneClient && (
            <aside aria-labelledby="cl-title" className="card flex flex-col xl:sticky xl:top-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 id="cl-title" className="text-lg leading-[26px] font-bold text-ink">
                    {paneClient.client_name}
                  </h2>
                  {delinquentClientIds.has(paneClient.client_id) && <StatusBadge status="Delinquent" />}
                  {paneClient.deactivated_at && <StatusBadge status="Deactivated" />}
                </div>
                {/* Only with no users row at all -- a "Login pending" client
                    already has one, and the Edge Function would add a second. */}
                {paneAccount === undefined && !paneClient.deactivated_at && (
                  <button onClick={() => setSelectedClient(paneClient)} className="btn-secondary px-4 text-sm font-medium">
                    Set Up Account
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-5 px-5 py-4">
                <section>
                  <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink">Contact Details</h3>
                  <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
                    <div>
                      <dt className={LABEL}>Contact Number</dt>
                      <dd className={`${VALUE} tabular-nums`}>{paneClient.phone_number ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className={LABEL}>Email Address</dt>
                      <dd className={`${VALUE} break-words`}>{paneClient.email ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className={LABEL}>Portal Login</dt>
                      <dd className={VALUE}>
                        <StatusBadge
                          status={paneAccount === 'login' ? 'Set Up' : 'Not Set Up'}
                          label={paneAccount === 'login' ? 'Has login' : paneAccount === 'pending' ? 'Login pending' : 'No account'}
                        />
                      </dd>
                    </div>
                    {paneClient.deactivated_at && (
                      <div>
                        <dt className={LABEL}>Deactivated</dt>
                        <dd className={VALUE}>
                          {formatDate(paneClient.deactivated_at)}
                          {paneClient.deactivation_reason && (
                            <span className="block text-[13px] text-ink-muted">{paneClient.deactivation_reason}</span>
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>
                </section>

                {paneQuotes.length > 0 && (
                  <section className="flex flex-wrap items-center justify-between gap-3 border border-amber-600 bg-amber-100 px-4 py-3.5 text-sm text-amber-900">
                    <div>
                      <h3 className="font-bold">
                        {paneQuotes.length} {paneQuotes.length === 1 ? 'quote' : 'quotes'} waiting for review
                      </h3>
                      <p>
                        <span className="font-mono text-[13px] font-semibold">
                          {paneQuotes[0].reference_code ?? `#${paneQuotes[0].quote_request_id}`}
                        </span>
                        {paneQuotes[0].proposed_rate !== null && paneQuotes[0].request_status === 'Countered' && (
                          <> · {formatMoney(paneQuotes[0].proposed_rate)} counter-offer</>
                        )}
                        {paneQuotes[0].delivery_order_count !== null && (
                          <> · {paneQuotes[0].delivery_order_count} {paneQuotes[0].delivery_order_count === 1 ? 'trip' : 'trips'}</>
                        )}
                        {paneQuotes[0].preferred_pickup_date && <> · Pickup {formatDate(paneQuotes[0].preferred_pickup_date)}</>}
                      </p>
                    </div>
                    <Link to="/dashboard/quotations" className="inline-flex min-h-11 items-center gap-2 font-semibold underline">
                      Review quote
                      <Chevron size={16} />
                    </Link>
                  </section>
                )}

                <section>
                  <h3 className="mb-1 text-sm font-semibold text-ink">Bookings</h3>
                  {paneBookings.length === 0 ? (
                    <p className="py-3 text-sm text-ink-muted">No bookings yet.</p>
                  ) : (
                    <table className="w-full text-left text-sm text-ink-metric">
                      <thead>
                        <tr>
                          <th className="px-2 py-2 first:pl-3">Booking</th>
                          <th className="px-2 py-2">Booked</th>
                          <th className="px-2 py-2">Rate</th>
                          <th className="px-2 py-2 last:pr-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paneBookings.slice(0, 6).map((b) => {
                          const t = tripsByBooking.get(b.booking_id)
                          return (
                            <tr key={b.booking_id} className="h-[52px] border-b border-slate-200">
                              <td className="px-2 first:pl-3">
                                <Link to={`/dashboard/bookings?booking=${b.booking_id}`} className="font-semibold text-primary hover:underline">
                                  #{b.booking_id}
                                </Link>
                              </td>
                              <td className="px-2">{formatDate(b.booking_date)}</td>
                              <td className="px-2 tabular-nums">
                                <span className="font-semibold">
                                  {b.rate_of_delivery_service !== null ? formatMoney(b.rate_of_delivery_service) : '—'}
                                </span>
                                {t && <span className="text-[13px] text-ink-muted"> × {t.total}</span>}
                              </td>
                              <td className="px-2 last:pr-3">
                                <StatusBadge
                                  status={b.booking_status ?? 'Confirmed'}
                                  label={BOOKING_STATUS_LABELS[b.booking_status ?? '']}
                                  icon
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
                <span className="text-sm text-ink-secondary">
                  Balance due{' '}
                  <strong className="text-ink tabular-nums">{formatMoney(balanceByClient.get(paneClient.client_id)?.owed ?? 0)}</strong>
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  {paneClient.deactivated_at ? (
                    <button onClick={() => handleSetActive(paneClient, true)} className="btn-secondary px-4 text-sm font-medium">
                      Reactivate
                    </button>
                  ) : (
                    <button onClick={() => handleSetActive(paneClient, false)} className="btn-danger px-4 text-sm">
                      Deactivate…
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setViewingClient(paneClient)}
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline"
                  >
                    All bookings for {paneClient.client_name}
                    <Chevron size={16} />
                  </button>
                </div>
              </div>
            </aside>
          )}
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
