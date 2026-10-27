// FleetSection: the Fleet page (the canvas's board) -- Trucks / Trailers
// tabs with a plate search, a table, and a side panel for the selected
// vehicle: its details, open work orders and pending maintenance schedules,
// and its last trips (with the driver). Panel buttons: Delete (blocked with a
// clear message if the vehicle is still referenced), Create Work Order,
// Assign Schedule (trucks), Edit. ?tab=Trailers opens the Trailers tab.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePaged } from '../../../lib/usePaged'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { loadPendingMaintenanceSchedules, type PendingMaintenanceSchedule } from '../../../lib/maintenanceSchedules'
import AddTruckModal from './AddTruckModal'
import AddTrailerModal, { type EditableTrailer } from './AddTrailerModal'
import CreateWorkOrderModal, { type PreselectedVehicle } from './CreateWorkOrderModal'
import AssignScheduleModal from './AssignScheduleModal'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { showToast } from '../../../components/Toast'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import EmptyState from '../../../components/EmptyState'
import { formatDate } from '../../../lib/format'

type Truck = {
  plate_number: string
  model: string | null
  year: number | null
  current_status: string | null
  last_service_date: string | null
  current_odometer: number | null
  next_service_date: string | null
}

type Trailer = {
  trailer_id: number
  plate_number: string | null
  trailer_type: string
  registration_number: string | null
  current_status: string | null
  last_maintenance_date: string | null
}

type OpenWorkOrder = {
  work_order_id: number
  work_order_number: string
  plate_number: string | null
  trailer_id: number | null
  maintenance_type: string
  work_order_status: string
}

const TABS = ['Trucks', 'Trailers'] as const
type Tab = (typeof TABS)[number]

const OPEN_WORK_ORDER_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']
const NOT_OPERATIONAL = ['Under Maintenance', 'Out of Service']

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const GROUP = 'mb-2.5 flex justify-between gap-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink'
const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'm-0 text-[15px] leading-[22px] font-medium text-ink'
const FILTER_LABEL = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
const FILTER_CONTROL =
  'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={LABEL}>{label}</dt>
      <dd className={VALUE}>{children || '—'}</dd>
    </div>
  )
}

const trailerName = (t: { trailer_id: number; plate_number: string | null }) => t.plate_number || `Trailer #${t.trailer_id}`

// The vehicle's last 5 trips (not cancelled), newest first, with the driver
// and the truck/trailer it ran with.
function RecentTrips({ vehicle }: { vehicle: PreselectedVehicle }) {
  const [rows, setRows] = useState<{ id: number; bookingId: number; date: string | null; status: string; text: string }[] | null>(null)
  const key = vehicle.type === 'truck' ? vehicle.plateNumber : vehicle.trailerId

  useEffect(() => {
    let cancelled = false
    async function load() {
      const base = supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, trip_date_from, itinerary_status, plate_number, trailer_id')
        .neq('itinerary_status', 'Cancelled')
      const { data: trips } = await (vehicle.type === 'truck'
        ? base.eq('plate_number', vehicle.plateNumber)
        : base.eq('trailer_id', vehicle.trailerId)
      )
        .order('trip_date_from', { ascending: false })
        .order('itinerary_id', { ascending: false })
        .limit(5)
      const tripIds = (trips ?? []).map((t) => t.itinerary_id)
      const trailerIds = [...new Set((trips ?? []).map((t) => t.trailer_id).filter((id): id is number => id !== null))]
      const [crewResult, trailersResult] = await Promise.all([
        tripIds.length
          ? supabase
              .from('itinerary_crews')
              .select('itinerary_id, employee_id')
              .eq('crew_role', 'Driver')
              .eq('is_active', true)
              .in('itinerary_id', tripIds)
          : Promise.resolve({ data: [] as { itinerary_id: number; employee_id: number }[] }),
        vehicle.type === 'truck' && trailerIds.length
          ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
          : Promise.resolve({ data: [] as { trailer_id: number; plate_number: string | null }[] }),
      ])
      const crew = crewResult.data ?? []
      const driverIds = [...new Set(crew.map((c) => c.employee_id))]
      const { data: people } = driverIds.length
        ? await supabase.from('employees').select('employee_id, full_name').in('employee_id', driverIds)
        : { data: [] as { employee_id: number; full_name: string }[] }
      if (cancelled) return
      const nameById = new Map((people ?? []).map((p) => [p.employee_id, p.full_name]))
      const trailerById = new Map((trailersResult.data ?? []).map((t) => [t.trailer_id, t]))
      setRows(
        (trips ?? []).map((t) => {
          const driverId = crew.find((c) => c.itinerary_id === t.itinerary_id)?.employee_id
          const partner =
            vehicle.type === 'truck'
              ? t.trailer_id !== null
                ? `trailer ${trailerName(trailerById.get(t.trailer_id) ?? { trailer_id: t.trailer_id, plate_number: null })}`
                : null
              : t.plate_number
          return {
            id: t.itinerary_id,
            bookingId: t.booking_id,
            date: t.trip_date_from,
            status: t.itinerary_status,
            text: [driverId !== undefined ? (nameById.get(driverId) ?? 'Driver') : 'No driver yet', partner].filter(Boolean).join(' · '),
          }
        }),
      )
    }
    void load()
    return () => {
      cancelled = true
    }
    // `key` stands for the vehicle (the object itself is rebuilt every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.type, key])

  return (
    <section>
      <h3 className={GROUP}>Recent trips</h3>
      {rows === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No trips yet.</p>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm last:border-0">
            <Link to={`/dashboard/bookings?booking=${r.bookingId}&trip=${r.id}`} className="font-semibold text-primary hover:underline">
              Trip #{r.id}
            </Link>
            <span className="min-w-0 flex-1 truncate text-ink-secondary">
              {formatDate(r.date)} · {r.text}
            </span>
            <StatusBadge status={r.status} />
          </div>
        ))
      )}
    </section>
  )
}

function FleetSection() {
  const { employeeId } = useAuth()
  const [searchParams] = useSearchParams()
  const initialTab: Tab = searchParams.get('tab') === 'Trailers' ? 'Trailers' : 'Trucks'

  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [search, setSearch] = useState('')
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])
  const [workOrders, setWorkOrders] = useState<OpenWorkOrder[]>([])
  const [schedules, setSchedules] = useState<PendingMaintenanceSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [paneTruck, setPaneTruck] = useState<string | null>(null)
  const [paneTrailer, setPaneTrailer] = useState<number | null>(null)
  const [showAddTruck, setShowAddTruck] = useState(false)
  const [showAddTrailer, setShowAddTrailer] = useState(false)
  const [editingTruck, setEditingTruck] = useState<Truck | null>(null)
  const [editingTrailer, setEditingTrailer] = useState<Trailer | null>(null)
  const [createFor, setCreateFor] = useState<PreselectedVehicle | null>(null)
  const [assignFor, setAssignFor] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFleet(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function loadFleet() {
    try {
      setLoading(true)
      setError('')

      const { data: truckData, error: truckError } = await supabase
        .from('truck_profiles')
        .select('plate_number, model, year, current_status, last_service_date, current_odometer, next_service_date')
        .order('plate_number', { ascending: true })
      if (truckError) throw truckError

      const { data: trailerData, error: trailerError } = await supabase
        .from('trailers')
        .select('trailer_id, plate_number, trailer_type, registration_number, current_status, last_maintenance_date')
        .order('trailer_id', { ascending: true })
      if (trailerError) throw trailerError

      const [ordersResult, schedulesResult] = await Promise.all([
        supabase
          .from('work_orders')
          .select('work_order_id, work_order_number, plate_number, trailer_id, maintenance_type, work_order_status')
          .in('work_order_status', OPEN_WORK_ORDER_STATUSES),
        loadPendingMaintenanceSchedules(),
      ])
      if (ordersResult.error) throw ordersResult.error

      setTrucks((truckData ?? []) as Truck[])
      setTrailers((trailerData ?? []) as Trailer[])
      setWorkOrders(ordersResult.data ?? [])
      setSchedules(schedulesResult.schedules)
    } catch (err) {
      console.error('Failed to load fleet:', err)
      setError('Something went wrong while loading the fleet.')
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteTruck(truck: Truck) {
    if (
      !(await confirmDialog({
        title: `Delete truck ${truck.plate_number}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return
    }

    setActionError(null)

    const { error: deleteError } = await supabase.from('truck_profiles').delete().eq('plate_number', truck.plate_number)

    if (deleteError) {
      // '23503' is Postgres's error code for a foreign key violation --
      // e.g. this truck is still referenced by a work order or itinerary.
      // Uses a separate actionError state (not the page-load `error`) so
      // a failed delete shows a banner without hiding the whole list.
      if (deleteError.code === '23503') {
        setActionError(
          `Can't delete truck ${truck.plate_number} -- it's still ` +
            `referenced elsewhere (e.g. a work order or itinerary). ` +
            `Remove those first, then try again.`,
        )
      } else {
        setActionError(deleteError.message)
      }
      return
    }

    setPaneTruck(null)
    loadFleet()
  }

  async function handleDeleteTrailer(trailer: Trailer) {
    if (
      !(await confirmDialog({
        title: `Delete trailer ${trailer.plate_number ?? `#${trailer.trailer_id}`}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return
    }

    setActionError(null)

    const { error: deleteError } = await supabase.from('trailers').delete().eq('trailer_id', trailer.trailer_id)

    if (deleteError) {
      // '23503' is Postgres's error code for a foreign key violation --
      // e.g. this trailer is still referenced by a work order or itinerary.
      // Uses a separate actionError state (not the page-load `error`) so
      // a failed delete shows a banner without hiding the whole list.
      if (deleteError.code === '23503') {
        setActionError(
          `Can't delete trailer ${trailer.plate_number ?? `#${trailer.trailer_id}`} -- ` +
            `it's still referenced elsewhere (e.g. a work order or ` +
            `itinerary). Remove those first, then try again.`,
        )
      } else {
        setActionError(deleteError.message)
      }
      return
    }

    setPaneTrailer(null)
    loadFleet()
  }

  const term = search.trim().toLowerCase()
  const shownTrucks = trucks.filter((t) => t.plate_number.toLowerCase().includes(term))
  const shownTrailers = trailers.filter((t) => trailerName(t).toLowerCase().includes(term))

  // One page at a time (back to page 1 when the filters change).
  const pagedTrucks = usePaged(shownTrucks, `${activeTab}|${search}`)
  const pagedTrailers = usePaged(shownTrailers, `${activeTab}|${search}`)
  const pager = activeTab === 'Trucks' ? pagedTrucks.pager : pagedTrailers.pager
  const truck = pagedTrucks.rows.find((t) => t.plate_number === paneTruck) ?? pagedTrucks.rows[0] ?? null
  const trailer = pagedTrailers.rows.find((t) => t.trailer_id === paneTrailer) ?? pagedTrailers.rows[0] ?? null

  const down = (status: string | null) => NOT_OPERATIONAL.includes(status ?? '')
  const ordersFor = (v: PreselectedVehicle) =>
    workOrders.filter((o) => (v.type === 'truck' ? o.plate_number === v.plateNumber : o.trailer_id === v.trailerId))
  const schedulesFor = (v: PreselectedVehicle) =>
    schedules.filter((s) => (v.type === 'truck' ? s.plate_number === v.plateNumber : s.trailer_id === v.trailerId))
  // Earliest pending schedule (trailers have no service date of their own).
  const nextSchedule = (v: PreselectedVehicle) => schedulesFor(v)[0] ?? null

  const selected: PreselectedVehicle | null =
    activeTab === 'Trucks'
      ? truck
        ? { type: 'truck', plateNumber: truck.plate_number }
        : null
      : trailer
        ? { type: 'trailer', trailerId: trailer.trailer_id }
        : null

  const openCell = (label: string, onOpen: () => void) => (
    <td className={TD}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        aria-label={`Open ${label}`}
        className="flex h-11 w-11 items-center justify-center text-primary"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </td>
  )
  const rowClass = (isSelected: boolean) =>
    `h-[60px] cursor-pointer border-b border-slate-200 ${
      isSelected ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
    }`

  return (
    <div>
      <PageHeader
        title="Fleet"
        subtitle="Truck and trailer records: status, odometer and maintenance dates."
        actions={
          <button
            onClick={() => (activeTab === 'Trucks' ? setShowAddTruck(true) : setShowAddTrailer(true))}
            className="btn-primary flex items-center gap-2 px-5 text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14 M5 12h14" />
            </svg>
            {activeTab === 'Trucks' ? 'Add Truck' : 'Add Trailer'}
          </button>
        }
      />

      {actionError && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Vehicle type" className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`flex h-11 items-center gap-2.5 rounded-[2px] border px-5 text-sm font-semibold ${
                activeTab === tab ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
              }`}
            >
              {tab}
              <span className={`rounded-[2px] px-1.5 text-xs tabular-nums ${activeTab === tab ? 'bg-white/20 text-white' : 'bg-slate-200 text-ink-secondary'}`}>
                {tab === 'Trucks' ? trucks.length : trailers.length}
              </span>
            </button>
          ))}
        </div>
        <label className={FILTER_LABEL}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Plate no."
            className={`${FILTER_CONTROL} w-56 font-normal placeholder:text-ink-muted`}
          />
        </label>
      </div>

      {loading ? (
        <p className="mt-4 text-ink-muted">Loading fleet...</p>
      ) : error ? (
        <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : (activeTab === 'Trucks' ? trucks : trailers).length === 0 ? (
        <EmptyState
          message={activeTab === 'Trucks' ? 'No trucks yet.' : 'No trailers yet.'}
          hint={`Use "Add ${activeTab === 'Trucks' ? 'Truck' : 'Trailer'}" to add one.`}
          className="mt-4"
        />
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px] xl:items-start">
          <section aria-label={activeTab} className="card flex min-h-[calc(100dvh-19rem)] flex-col">
            <div className="flex-1 overflow-x-auto">
              {activeTab === 'Trucks' ? (
                shownTrucks.length === 0 ? (
                  <EmptyState message="No truck matches that plate." className="m-5" />
                ) : (
                  <table className="w-full min-w-[820px] text-left text-sm text-ink-metric">
                    <thead>
                      <tr>
                        <th className={TH}>Plate No.</th>
                        <th className={TH}>Model · Year</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Last Service</th>
                        <th className={`${TH} text-right`}>Odometer</th>
                        <th className={TH}>Next Maintenance</th>
                        <th className={TH}>
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedTrucks.rows.map((t) => {
                        const schedule = nextSchedule({ type: 'truck', plateNumber: t.plate_number })
                        const next = [t.next_service_date, schedule?.due_date].filter((d): d is string => !!d).sort()[0] ?? null
                        return (
                          <tr key={t.plate_number} onClick={() => setPaneTruck(t.plate_number)} className={rowClass(truck?.plate_number === t.plate_number)}>
                            <td className={`${TD} font-semibold ${down(t.current_status) ? 'text-ink-muted' : 'text-ink'}`}>{t.plate_number}</td>
                            <td className={`${TD} ${t.model ? '' : 'text-ink-muted'}`}>
                              {[t.model, t.year].filter(Boolean).join(' · ') || '—'}
                            </td>
                            <td className={TD}>
                              <StatusBadge status={t.current_status ?? 'Available'} icon />
                            </td>
                            <td className={TD}>{formatDate(t.last_service_date)}</td>
                            <td className={`${TD} text-right tabular-nums`}>
                              {t.current_odometer != null ? `${Number(t.current_odometer).toLocaleString()} km` : '—'}
                            </td>
                            <td className={`${TD} ${next ? '' : 'text-ink-muted'}`}>{next ? formatDate(next) : 'Not set'}</td>
                            {openCell(t.plate_number, () => setPaneTruck(t.plate_number))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              ) : shownTrailers.length === 0 ? (
                <EmptyState message="No trailer matches that plate." className="m-5" />
              ) : (
                <table className="w-full min-w-[820px] text-left text-sm text-ink-metric">
                  <thead>
                    <tr>
                      <th className={TH}>Plate No.</th>
                      <th className={TH}>Trailer Type</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Registration No.</th>
                      <th className={TH}>Last Maintenance</th>
                      <th className={TH}>Next Maintenance</th>
                      <th className={TH}>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTrailers.rows.map((t) => {
                      const schedule = nextSchedule({ type: 'trailer', trailerId: t.trailer_id })
                      return (
                        <tr key={t.trailer_id} onClick={() => setPaneTrailer(t.trailer_id)} className={rowClass(trailer?.trailer_id === t.trailer_id)}>
                          <td className={`${TD} font-semibold ${down(t.current_status) ? 'text-ink-muted' : 'text-ink'}`}>{trailerName(t)}</td>
                          <td className={TD}>{t.trailer_type}</td>
                          <td className={TD}>
                            <StatusBadge status={t.current_status ?? 'Available'} icon />
                          </td>
                          <td className={`${TD} ${t.registration_number ? '' : 'text-ink-muted'}`}>{t.registration_number || '—'}</td>
                          <td className={TD}>{formatDate(t.last_maintenance_date)}</td>
                          <td className={`${TD} ${schedule ? '' : 'text-ink-muted'}`}>{schedule ? formatDate(schedule.due_date) : 'Not set'}</td>
                          {openCell(trailerName(t), () => setPaneTrailer(t.trailer_id))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
              <span>
                {activeTab === 'Trucks'
                  ? `${trucks.length} ${trucks.length === 1 ? 'truck' : 'trucks'} · ${trucks.filter((t) => !down(t.current_status)).length} operational`
                  : `${trailers.length} ${trailers.length === 1 ? 'trailer' : 'trailers'} · ${trailers.filter((t) => !down(t.current_status)).length} operational`}
              </span>
              {pager.pageCount > 1 && (
                <span className="flex gap-2">
                  <button type="button" onClick={() => pager.onChange(pager.page - 1)} disabled={pager.page === 0} className="btn-secondary px-3.5 text-sm font-medium">
                    ‹ Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => pager.onChange(pager.page + 1)}
                    disabled={pager.page >= pager.pageCount - 1}
                    className="btn-secondary px-3.5 text-sm font-medium"
                  >
                    Next ›
                  </button>
                </span>
              )}
            </div>
          </section>

          {selected && (
            <aside aria-labelledby="fl-title" className="card flex flex-col xl:sticky xl:top-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
                <h2 id="fl-title" className="text-lg leading-[26px] font-bold text-ink">
                  {selected.type === 'truck' ? truck!.plate_number : trailerName(trailer!)}
                </h2>
                <StatusBadge status={(selected.type === 'truck' ? truck!.current_status : trailer!.current_status) ?? 'Available'} icon />
              </div>

              <div className="flex flex-col gap-[18px] px-5 py-4">
                <section>
                  <h3 className={GROUP}>{selected.type === 'truck' ? 'Truck details' : 'Trailer details'}</h3>
                  {selected.type === 'truck' ? (
                    <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
                      <Field label="Model">{truck!.model}</Field>
                      <Field label="Year Model">{truck!.year}</Field>
                      <Field label="Odometer">{truck!.current_odometer != null ? `${Number(truck!.current_odometer).toLocaleString()} km` : null}</Field>
                      <Field label="Last Service">{truck!.last_service_date ? formatDate(truck!.last_service_date) : null}</Field>
                      <Field label="Next Service">{truck!.next_service_date ? formatDate(truck!.next_service_date) : null}</Field>
                    </dl>
                  ) : (
                    <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
                      <Field label="Trailer Type">{trailer!.trailer_type}</Field>
                      <Field label="Registration No.">{trailer!.registration_number}</Field>
                      <Field label="Last Maintenance">{trailer!.last_maintenance_date ? formatDate(trailer!.last_maintenance_date) : null}</Field>
                    </dl>
                  )}
                </section>

                <section>
                  <h3 className={GROUP}>Maintenance</h3>
                  {ordersFor(selected).length === 0 && schedulesFor(selected).length === 0 ? (
                    <p className="text-sm text-ink-muted">No open work orders or schedules.</p>
                  ) : (
                    <>
                      {ordersFor(selected).map((o) => (
                        <div key={o.work_order_id} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm">
                          <Link to={`/dashboard/maintenance?wo=${o.work_order_id}`} className="font-semibold text-primary hover:underline">
                            {o.work_order_number}
                          </Link>
                          <span className="min-w-0 flex-1 truncate text-ink-secondary">{o.maintenance_type}</span>
                          <StatusBadge status={o.work_order_status} />
                        </div>
                      ))}
                      {schedulesFor(selected).map((s) => (
                        <div key={s.schedule_id} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm">
                          <span className="min-w-0 flex-1 truncate text-ink-secondary">Schedule · {s.maintenance_type}</span>
                          <span className="font-semibold tabular-nums">Due {formatDate(s.due_date)}</span>
                        </div>
                      ))}
                    </>
                  )}
                </section>

                <RecentTrips vehicle={selected} />
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
                <button
                  type="button"
                  onClick={() => void (selected.type === 'truck' ? handleDeleteTruck(truck!) : handleDeleteTrailer(trailer!))}
                  className="btn-danger px-4 text-sm"
                >
                  Delete…
                </button>
                <span className="flex-1" />
                <button type="button" onClick={() => setCreateFor(selected)} className="btn-secondary px-4 text-sm font-medium">
                  Create Work Order
                </button>
                {selected.type === 'truck' && employeeId && (
                  <button type="button" onClick={() => setAssignFor(truck!.plate_number)} className="btn-secondary px-4 text-sm font-medium">
                    Assign Schedule
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (selected.type === 'truck' ? setEditingTruck(truck) : setEditingTrailer(trailer))}
                  className="btn-primary flex items-center gap-2 px-5 text-sm"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" />
                  </svg>
                  Edit
                </button>
              </div>
            </aside>
          )}
        </div>
      )}

      {(showAddTruck || editingTruck) && (
        <AddTruckModal
          truck={editingTruck ?? undefined}
          onDelete={
            editingTruck
              ? () => {
                  const t = editingTruck
                  setEditingTruck(null)
                  handleDeleteTruck(t)
                }
              : undefined
          }
          onClose={() => {
            setShowAddTruck(false)
            setEditingTruck(null)
          }}
          onSaved={() => {
            setShowAddTruck(false)
            setEditingTruck(null)
            loadFleet()
          }}
        />
      )}

      {(showAddTrailer || editingTrailer) && (
        <AddTrailerModal
          trailer={
            editingTrailer
              ? {
                  ...editingTrailer,
                  trailer_type: editingTrailer.trailer_type as EditableTrailer['trailer_type'],
                }
              : undefined
          }
          onDelete={
            editingTrailer
              ? () => {
                  const t = editingTrailer
                  setEditingTrailer(null)
                  handleDeleteTrailer(t)
                }
              : undefined
          }
          onClose={() => {
            setShowAddTrailer(false)
            setEditingTrailer(null)
          }}
          onSaved={() => {
            setShowAddTrailer(false)
            setEditingTrailer(null)
            loadFleet()
          }}
        />
      )}

      {createFor && (
        <CreateWorkOrderModal
          vehicle={createFor}
          onClose={() => setCreateFor(null)}
          onCreated={() => {
            setCreateFor(null)
            showToast('Work order created.')
            loadFleet()
          }}
        />
      )}

      {assignFor && employeeId && (
        <AssignScheduleModal
          employeeId={employeeId}
          plateNumber={assignFor}
          onClose={() => setAssignFor(null)}
          onSaved={() => {
            setAssignFor(null)
            showToast('Schedule assigned.')
            loadFleet()
          }}
        />
      )}
    </div>
  )
}

export default FleetSection
