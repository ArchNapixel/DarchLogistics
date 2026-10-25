// TripsView: the "Trips" tab of Bookings & Trips (#16). Every trip, grouped
// under its booking, filtered Active / Delivered / Cancelled, with a search
// box. Clicking a trip opens its full detail on the right (TripDetailPanel:
// details, trip log, documents) -- so trip documents and history aren't
// buried inside the booking. Paged by booking group (10 bookings per page).
// Data: lib/tripList.ts. On a phone the detail shows under the list.
// `switcher` is the page's Bookings / Trips buttons, drawn at the start of
// this tab's controls row (BookingsTripsControls.tsx).
import { useEffect, useState, type ReactNode } from 'react'
import { usePaged } from '../../../lib/usePaged'
import StatusBadge from '../../../components/StatusBadge'
import EmptyState from '../../../components/EmptyState'
import { formatDate, formatSlotShort } from '../../../lib/format'
import { loadTripList, TRIP_STATUS_LABELS, type TripListRow } from '../../../lib/tripList'
import { STORAGE_BADGE, storageState } from '../../../lib/storageDeadline'
import TripDetailPanel from './TripDetailPanel'
import { DetailPane, FilterButtons, ListBox, SearchBox } from './BookingsTripsControls'

const FILTERS = [
  { value: 'Active', label: 'Active' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Cancelled', label: 'Cancelled' },
] as const
type Filter = (typeof FILTERS)[number]['value']

const filterOf = (status: string): Filter =>
  status === 'Delivered' ? 'Delivered' : status === 'Cancelled' ? 'Cancelled' : 'Active'

type Group = { booking_id: number; client_name: string; pickup: string; delivery: string; trips: TripListRow[] }

function TripsView({
  focusTripId,
  onOpenBooking,
  switcher,
}: {
  // From "Find trip" (?view=trips&trip=N): opens that trip on load.
  focusTripId: number | null
  onOpenBooking: (bookingId: number) => void
  switcher: ReactNode
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
  const counts = rows
    ? Object.fromEntries(FILTERS.map((f) => [f.value, all.filter((r) => filterOf(r.status) === f.value).length]))
    : null

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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {switcher}
        <FilterButtons label="Filter trips" options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
        <SearchBox value={search} onChange={setSearch} placeholder="Trip #, booking #, client, place, driver or plate" />
      </div>

      {error ? (
        <p className="text-red-700">{error}</p>
      ) : !rows ? (
        <p className="text-slate-500">Loading trips…</p>
      ) : groups.length === 0 ? (
        <EmptyState message={search ? 'No trips match.' : `No ${filter.toLowerCase()} trips.`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start">
          <ListBox
            pager={paged.pager}
            summary={`${visible.length} ${filter.toLowerCase()} ${visible.length === 1 ? 'trip' : 'trips'}`}
          >
            {paged.rows.map((g) => (
              <div key={g.booking_id} className="border-b border-slate-200">
                <div className="border-b border-slate-300 bg-slate-200 px-4 py-2 text-sm">
                  <span className="font-semibold text-slate-900">
                    Booking #{g.booking_id} · {g.client_name}
                  </span>
                  <span className="block truncate text-slate-600" title={`${g.pickup} → ${g.delivery}`}>
                    {g.pickup} → {g.delivery}
                  </span>
                </div>
                <ul>
                  {g.trips.map((t) => {
                    const active = selected?.itinerary_id === t.itinerary_id
                    const storage = storageState({ deadline: t.storage_deadline, status: t.status, pickedUpAt: null, now })
                    return (
                      <li key={t.itinerary_id} className="border-b border-slate-200 last:border-0">
                        <button
                          type="button"
                          onClick={() => setSelectedId(t.itinerary_id)}
                          aria-current={active || undefined}
                          className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm ${
                            active ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="truncate">
                              <span className="font-semibold text-slate-900">Trip #{t.itinerary_id}</span>
                              <span className="text-slate-600">
                                {' · '}
                                {t.trip_start_at
                                  ? formatSlotShort(t.trip_start_at, t.trip_end_at)
                                  : t.trip_date_from
                                    ? formatDate(t.trip_date_from)
                                    : 'No date'}
                                {' · '}
                                {t.driver ?? 'No driver'}
                              </span>
                              {t.document_count > 0 && (
                                <span className="ml-1 text-xs text-slate-500" title="Documents attached">
                                  📎 {t.document_count}
                                </span>
                              )}
                            </span>
                            {storage && (
                              <span className={`mt-1 block w-fit px-1.5 py-0.5 text-[11px] font-medium ${STORAGE_BADGE[storage].className}`}>
                                {STORAGE_BADGE[storage].label}
                              </span>
                            )}
                          </span>
                          <StatusBadge status={t.status} label={TRIP_STATUS_LABELS[t.status]} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </ListBox>

          {selected && (
            <DetailPane>
              <TripDetailPanel
                key={selected.itinerary_id}
                trip={selected}
                onOpenBooking={onOpenBooking}
                onDocumentCount={setDocumentCount}
              />
            </DetailPane>
          )}
        </div>
      )}
    </div>
  )
}

export default TripsView
