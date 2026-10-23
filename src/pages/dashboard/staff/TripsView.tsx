// TripsView: the "Trips" tab of Bookings & Trips (#16). Every trip, grouped
// under its booking, filtered Active / Delivered / Cancelled, with a search
// box. Clicking a trip opens its full detail on the right (TripDetailPanel:
// status timeline, expenses, damage, issue reports, documents) -- so trip
// documents and history aren't buried inside the booking any more.
// Paged by booking group (10 bookings per page). Data: lib/tripList.ts.
// On a phone the detail shows under the list instead of beside it.
import { useEffect, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import StatusBadge from '../../../components/StatusBadge'
import EmptyState from '../../../components/EmptyState'
import { formatDate, formatSlot } from '../../../lib/format'
import { loadTripList, TRIP_STATUS_LABELS, type TripListRow } from '../../../lib/tripList'
import { STORAGE_BADGE, storageState } from '../../../lib/storageDeadline'
import TripDetailPanel from './TripDetailPanel'

const FILTERS = ['Active', 'Delivered', 'Cancelled'] as const
type Filter = (typeof FILTERS)[number]

const filterOf = (status: string): Filter =>
  status === 'Delivered' ? 'Delivered' : status === 'Cancelled' ? 'Cancelled' : 'Active'

type Group = { booking_id: number; client_name: string; pickup: string; delivery: string; trips: TripListRow[] }

function TripsView({
  focusTripId,
  onOpenBooking,
}: {
  // From "Find trip #" (?view=trips&trip=N): opens that trip on load.
  focusTripId: number | null
  onOpenBooking: (bookingId: number) => void
}) {
  const [rows, setRows] = useState<TripListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('Active')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Load time -- enough for the storage badges (render must stay pure).
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    loadTripList().then((result) => {
      if (cancelled) return
      setRows(result.rows)
      setError(result.error)
      // Find trip: jump to its filter and narrow the list to it.
      const trip = focusTripId ? result.rows.find((r) => r.itinerary_id === focusTripId) : undefined
      if (trip) {
        setFilter(filterOf(trip.status))
        setSearch(String(trip.itinerary_id))
        setSelectedId(trip.itinerary_id)
      }
    })
    return () => {
      cancelled = true
    }
  }, [focusTripId])

  // Digits only = a trip or booking number, matched exactly; anything else
  // matches client, places, crew or plates.
  const query = search.trim().toLowerCase().replace(/^#/, '')
  const matches = (r: TripListRow) =>
    !query ||
    (/^\d+$/.test(query)
      ? r.itinerary_id === Number(query) || r.booking_id === Number(query)
      : [r.client_name, r.pickup, r.delivery, r.driver, r.helper, r.plate_number, r.trailer_plate].some((t) =>
          t?.toLowerCase().includes(query),
        ))

  const all = rows ?? []
  const visible = all.filter((r) => filterOf(r.status) === filter && matches(r))

  // Newest booking first, its trips in trip order.
  const groupMap = new Map<number, Group>()
  for (const r of visible) {
    const g = groupMap.get(r.booking_id) ?? {
      booking_id: r.booking_id,
      client_name: r.client_name,
      pickup: r.pickup,
      delivery: r.delivery,
      trips: [],
    }
    g.trips.push(r)
    groupMap.set(r.booking_id, g)
  }
  const groups = [...groupMap.values()].sort((a, b) => b.booking_id - a.booking_id)
  for (const g of groups) g.trips.sort((a, b) => a.itinerary_id - b.itinerary_id)

  const paged = usePaged(groups, `${filter}|${search}`)
  const pageTrips = paged.rows.flatMap((g) => g.trips)
  const selected = all.find((r) => r.itinerary_id === selectedId) ?? pageTrips[0] ?? null

  function setDocumentCount(itineraryId: number, count: number) {
    setRows((prev) => prev?.map((r) => (r.itinerary_id === itineraryId ? { ...r, document_count: count } : r)) ?? prev)
  }

  if (error) return <p className="text-red-700">{error}</p>
  if (!rows) return <p className="text-slate-500">Loading trips…</p>

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter trips" className="flex">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`border px-3 py-1.5 text-sm font-medium [&:not(:first-child)]:-ml-px ${
                filter === f
                  ? 'relative border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {f}
              <span className="ml-1.5 text-xs opacity-70">{all.filter((r) => filterOf(r.status) === f).length}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Trip #, booking #, client, place, driver or plate"
          aria-label="Search trips"
          className="min-w-0 flex-1 border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none sm:max-w-sm"
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState message={search ? 'No trips match.' : `No ${filter.toLowerCase()} trips.`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
          <div>
            <div className="flex flex-col gap-3">
              {paged.rows.map((g) => (
                <div key={g.booking_id} className="border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs">
                    <span className="font-semibold text-slate-900">Booking #{g.booking_id}</span>{' '}
                    <span className="text-slate-700">· {g.client_name}</span>
                    <span className="block truncate text-slate-500" title={`${g.pickup} → ${g.delivery}`}>
                      {g.pickup} → {g.delivery}
                    </span>
                  </div>
                  <ul>
                    {g.trips.map((t) => {
                      const active = selected?.itinerary_id === t.itinerary_id
                      const storage = storageState({ deadline: t.storage_deadline, status: t.status, pickedUpAt: null, now })
                      return (
                        <li key={t.itinerary_id} className="border-b border-slate-100 last:border-0">
                          <button
                            type="button"
                            onClick={() => setSelectedId(t.itinerary_id)}
                            aria-current={active || undefined}
                            className={`block w-full px-4 py-2.5 text-left text-sm ${
                              active ? 'bg-slate-100 shadow-[inset_3px_0_0_var(--color-slate-900)]' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900">
                                Trip #{t.itinerary_id}
                                {t.document_count > 0 && (
                                  <span className="ml-2 text-xs font-normal text-slate-500" title="Documents attached">
                                    📎 {t.document_count}
                                  </span>
                                )}
                              </span>
                              <StatusBadge status={t.status} label={TRIP_STATUS_LABELS[t.status]} />
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {t.trip_start_at
                                ? formatSlot(t.trip_start_at, t.trip_end_at)
                                : t.trip_date_from
                                  ? formatDate(t.trip_date_from)
                                  : 'No date'}
                              {' · '}
                              {t.driver ?? 'No driver'}
                              {t.plate_number ? ` · ${t.plate_number}` : ''}
                            </span>
                            {storage && (
                              <span className={`mt-1 inline-block px-1.5 py-0.5 text-[11px] font-medium ${STORAGE_BADGE[storage].className}`}>
                                {STORAGE_BADGE[storage].label}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <Pager {...paged.pager} />
          </div>

          {/* Scrolls on its own if long, so the list stays in place. */}
          {selected && (
            <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
              <TripDetailPanel
                key={selected.itinerary_id}
                trip={selected}
                onOpenBooking={onOpenBooking}
                onDocumentCount={setDocumentCount}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TripsView
