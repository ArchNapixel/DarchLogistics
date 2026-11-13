// TruckMaintenanceMonitoringSection: Truck Monitoring (Maintenance ->
// Truck Monitoring, the canvas's board). One screen for "which trucks can
// run": fleet tiles, the Trucks table (status, odometer, next PMS bar,
// last trips, next
// maintenance), Alerts worked out from data the app already keeps (truck /
// trailer not operational, service date due, a schedule due soon, a work
// order past its scheduled date) and the Odometer panel. Each delivered
// trip's km are added to the truck's odometer automatically when it's
// marked Delivered (lib/odometer.ts); the panel lists any trip that wasn't
// counted, takes the real reading off the dashboard, and shows the log.
// Maintenance schedules (and Assign Schedule) moved to the Maintenance
// page's Schedules tab.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import {
  ODOMETER_SOURCE_LABELS,
  loadOdometerLog,
  loadUncountedTrips,
  recordOdometerReading,
  recordTripKm,
  type OdometerLogEntry,
} from '../../../lib/odometer'
import type { DeliveredTrip } from '../../../lib/odometerRules'
import { showToast } from '../../../components/Toast'
import {
  formatScheduleDueDate,
  loadPendingMaintenanceSchedules,
  type PendingMaintenanceSchedule,
} from '../../../lib/maintenanceSchedules'
import { toManilaDate } from '../../../lib/payslip'
import { filterAmountInput } from '../../../lib/amountInput'
import CreateWorkOrderModal, { type PreselectedVehicle } from './CreateWorkOrderModal'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate, formatDateTime } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import PmsProgress from '../../../components/PmsProgress'
import { loadPmsSettings } from '../../../lib/odometer'
import {
  DEFAULT_PMS_DUE_SOON_KM,
  DEFAULT_PMS_INTERVAL_KM,
  byPmsUrgency,
  pmsStatus,
  type PmsSettings,
} from '../../../lib/pms'

type Truck = {
  plate_number: string
  model: string | null
  current_status: string | null
  current_odometer: number | null
  last_pms_odometer: number | null
  next_service_date: string | null
}

type Trailer = { trailer_id: number; plate_number: string | null; current_status: string | null }

type RecentTrip = { itinerary_id: number; plate_number: string; trip_date_from: string | null }

type OpenWorkOrder = {
  work_order_id: number
  work_order_number: string
  plate_number: string | null
  trailer_id: number | null
  maintenance_type: string
  work_order_status: string
  scheduled_start_date: string | null
  pms_target_km: number | null
}

type Alert = {
  key: string
  title: string
  detail: string
  tone: 'bad' | 'warn'
  // Where the alert's button goes: an open work order, a schedule list, or
  // "Create Work Order" for that vehicle.
  action: { kind: 'link'; label: string; to: string } | { kind: 'create'; vehicle: PreselectedVehicle }
}

// Same open statuses as the Maintenance page.
const OPEN_WORK_ORDER_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']
const NOT_OPERATIONAL = ['Under Maintenance', 'Out of Service']
// A service date / schedule this close counts as an alert.
const DUE_SOON_DAYS = 14

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const PANEL_HEAD = 'flex min-h-[56px] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-5 py-3'

const daysUntil = (date: string, today: string) =>
  Math.round((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000)

const km = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} km`

// Odometer panel: trips whose km weren't counted (count one / all, oldest
// first), the real reading off a truck's dashboard, and the latest entries.
function OdometerPanel({
  trucks,
  uncounted,
  entries,
  onChanged,
}: {
  trucks: Truck[]
  uncounted: DeliveredTrip[]
  entries: OdometerLogEntry[]
  onChanged: () => void
}) {
  const [plate, setPlate] = useState('')
  const [reading, setReading] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [readingError, setReadingError] = useState<string | null>(null)
  const [counting, setCounting] = useState<number | 'all' | null>(null)
  const [tripErrors, setTripErrors] = useState<Record<number, string>>({})
  const pagedEntries = usePaged(entries, '', 8)
  const current = trucks.find((t) => t.plate_number === plate)?.current_odometer ?? null

  async function saveReading() {
    const value = Number(reading)
    if (!plate) return setReadingError('Pick a truck.')
    if (reading.trim() === '' || !Number.isFinite(value) || value < 0) return setReadingError('Enter the reading on the dashboard, in km.')
    setSaving(true)
    setReadingError(null)
    const saveError = await recordOdometerReading(plate, value, note)
    setSaving(false)
    if (saveError) return setReadingError(saveError)
    showToast(`${plate}'s odometer is now ${km(value)}.`)
    setReading('')
    setNote('')
    onChanged()
  }

  // Counts trips one at a time, oldest first: a trip's drive out depends on
  // where the truck's previous trip ended.
  async function count(trips: DeliveredTrip[], which: number | 'all') {
    setCounting(which)
    const errors: Record<number, string> = {}
    let done = 0
    for (const trip of trips) {
      const result = await recordTripKm(trip.itinerary_id)
      if ('error' in result) errors[trip.itinerary_id] = result.error
      else done++
    }
    setCounting(null)
    setTripErrors(errors)
    if (done > 0) showToast(`${done} ${done === 1 ? 'trip' : 'trips'} added to the odometer.`)
    if (done > 0) onChanged()
  }

  const field = 'min-h-11 rounded-[2px] border border-line-control bg-white px-3 text-sm focus:border-primary'

  return (
    <section aria-labelledby="odo-h" className="card flex flex-col">
      <div className={PANEL_HEAD}>
        <h2 id="odo-h" className="text-base font-semibold text-ink">
          Odometer
        </h2>
        <span className="text-[13px] text-ink-muted">Trip km are added when a trip is marked Delivered.</span>
      </div>

      {/* Real reading off the dashboard -- always wins over the estimates. */}
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4">
        <h3 className="text-sm font-semibold text-ink">Enter a real reading</h3>
        {readingError && <p className="bg-red-50 px-3 py-2 text-sm text-red-700">{readingError}</p>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-secondary">
            Truck
            <select value={plate} onChange={(e) => setPlate(e.target.value)} className={`${field} w-40`}>
              <option value="">Pick a truck</option>
              {trucks.map((t) => (
                <option key={t.plate_number} value={t.plate_number}>
                  {t.plate_number}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink-secondary">
            Reading (km)
            <input
              inputMode="decimal"
              value={reading}
              onChange={(e) => setReading(filterAmountInput(e.target.value))}
              className={`${field} w-32 tabular-nums`}
            />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm font-medium text-ink-secondary">
            Note <span className="sr-only">(optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className={`${field} placeholder:text-ink-muted`} />
          </label>
          <button type="button" onClick={() => void saveReading()} disabled={saving} className="btn-primary px-4 text-sm">
            {saving ? 'Saving...' : 'Save Reading'}
          </button>
        </div>
        {plate && current !== null && (
          <p className="text-[13px] text-ink-muted">
            The system has {km(Number(current))} for {plate}. A real reading replaces it, even if lower.
          </p>
        )}
      </div>

      {uncounted.length > 0 && (
        <div className="flex flex-col border-b border-line">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-ink">Trips not counted yet · {uncounted.length}</h3>
            <button
              type="button"
              onClick={() => void count(uncounted, 'all')}
              disabled={counting !== null}
              className="btn-secondary px-4 text-sm font-medium"
            >
              {counting === 'all' ? 'Counting...' : 'Count All'}
            </button>
          </div>
          <ul>
            {uncounted.map((trip) => (
              <li key={trip.itinerary_id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <strong className="font-semibold text-ink">{trip.plate_number}</strong>
                  <span className="text-ink-muted"> · Trip #{trip.itinerary_id} · delivered {formatDateTime(trip.delivered_at)}</span>
                  {tripErrors[trip.itinerary_id] && <span className="block text-[13px] text-red-700">{tripErrors[trip.itinerary_id]}</span>}
                </span>
                <button
                  type="button"
                  // Earlier uncounted trips of the same truck go first.
                  onClick={() =>
                    void count(
                      uncounted.filter((t) => t.plate_number === trip.plate_number && t.delivered_at <= trip.delivered_at),
                      trip.itinerary_id,
                    )
                  }
                  disabled={counting !== null}
                  className="btn-secondary px-4 text-sm font-medium"
                >
                  {counting === trip.itinerary_id ? 'Counting...' : 'Count'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col">
        <h3 className="px-5 pt-4 pb-2 text-sm font-semibold text-ink">Latest entries</h3>
        {entries.length === 0 ? (
          <EmptyState message="No odometer entries yet." className="mx-5 mb-5" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm text-ink-metric">
              <thead>
                <tr>
                  <th className={TH}>When</th>
                  <th className={TH}>Truck · What</th>
                  <th className={`${TH} text-right`}>Added</th>
                  <th className={`${TH} text-right`}>Reading</th>
                </tr>
              </thead>
              <tbody>
                {pagedEntries.rows.map((e) => (
                  <tr key={e.log_id} className="border-b border-slate-200">
                    <td className={`${TD} text-[13px] whitespace-nowrap`}>{formatDateTime(e.recorded_at)}</td>
                    <td className={TD}>
                      <span className="block font-semibold text-ink">
                        {e.plate_number} · {ODOMETER_SOURCE_LABELS[e.source]}
                        {e.itinerary_id !== null && ` #${e.itinerary_id}`}
                      </span>
                      {e.source === 'trip' && (
                        <span className="block text-[12px] text-ink-muted">
                          out {e.out_km} + trip {e.trip_km} + back {e.back_km}
                        </span>
                      )}
                      {e.note && <span className="block text-[12px] text-ink-muted">{e.note}</span>}
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap tabular-nums ${e.km_added !== null && e.km_added < 0 ? 'text-amber-800' : ''}`}>
                      {e.km_added === null ? '—' : `${e.km_added > 0 ? '+' : ''}${km(e.km_added)}`}
                    </td>
                    <td className={`${TD} text-right font-semibold whitespace-nowrap tabular-nums`}>{km(e.reading)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager {...pagedEntries.pager} />
          </div>
        )}
      </div>
    </section>
  )
}

function TruckMaintenanceMonitoringSection() {
  const today = toManilaDate(new Date())
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])
  const [trips, setTrips] = useState<RecentTrip[]>([])
  const [workOrders, setWorkOrders] = useState<OpenWorkOrder[]>([])
  const [schedules, setSchedules] = useState<PendingMaintenanceSchedule[]>([])
  const [uncounted, setUncounted] = useState<DeliveredTrip[]>([])
  const [odometerLog, setOdometerLog] = useState<OdometerLogEntry[]>([])
  const [pmsSettings, setPmsSettings] = useState<PmsSettings>({
    intervalKm: DEFAULT_PMS_INTERVAL_KM,
    dueSoonKm: DEFAULT_PMS_DUE_SOON_KM,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createFor, setCreateFor] = useState<PreselectedVehicle | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const [trucksResult, trailersResult, tripsResult, ordersResult, schedulesResult, uncountedResult, logResult, pms] = await Promise.all([
      supabase
        .from('truck_profiles')
        .select('plate_number, model, current_status, current_odometer, last_pms_odometer, next_service_date')
        .eq('is_active', true)
        .order('plate_number'),
      supabase.from('trailers').select('trailer_id, plate_number, current_status').eq('is_active', true).order('trailer_id'),
      // Newest trips first -- the table shows each truck's last two.
      supabase
        .from('itineraries')
        .select('itinerary_id, plate_number, trip_date_from')
        .not('plate_number', 'is', null)
        .neq('itinerary_status', 'Cancelled')
        .order('trip_date_from', { ascending: false })
        .order('itinerary_id', { ascending: false })
        .limit(300),
      supabase
        .from('work_orders')
        .select('work_order_id, work_order_number, plate_number, trailer_id, maintenance_type, work_order_status, scheduled_start_date, pms_target_km')
        .in('work_order_status', OPEN_WORK_ORDER_STATUSES),
      loadPendingMaintenanceSchedules(),
      loadUncountedTrips(),
      loadOdometerLog(),
      loadPmsSettings(),
    ])
    const loadError =
      trucksResult.error?.message ??
      trailersResult.error?.message ??
      tripsResult.error?.message ??
      ordersResult.error?.message ??
      schedulesResult.error ??
      uncountedResult.error ??
      logResult.error
    if (loadError) setError(loadError)
    setUncounted(uncountedResult.trips)
    setOdometerLog(logResult.entries)
    setPmsSettings(pms)
    setTrucks(trucksResult.data ?? [])
    setTrailers(trailersResult.data ?? [])
    setTrips((tripsResult.data ?? []) as RecentTrip[])
    setWorkOrders(ordersResult.data ?? [])
    setSchedules(schedulesResult.schedules)
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const down = (status: string | null) => NOT_OPERATIONAL.includes(status ?? '')
  const trucksDown = trucks.filter((t) => down(t.current_status))
  const trailersDown = trailers.filter((t) => down(t.current_status))
  const trailerName = (t: { trailer_id: number; plate_number: string | null }) => t.plate_number ?? `Trailer #${t.trailer_id}`
  const openOrderFor = (match: (o: OpenWorkOrder) => boolean) =>
    workOrders.filter(match).sort((a, b) => b.work_order_id - a.work_order_id)[0]

  // Alerts, worst first.
  const alerts: Alert[] = []
  for (const t of trucksDown) {
    const order = openOrderFor((o) => o.plate_number === t.plate_number)
    alerts.push({
      key: `truck-${t.plate_number}`,
      title: `${t.plate_number} not operational`,
      detail: order ? `${t.current_status} · ${order.work_order_number}, ${order.maintenance_type}` : `${t.current_status} · no open work order`,
      tone: 'bad',
      action: order
        ? { kind: 'link', label: 'Open Work Order', to: `/dashboard/maintenance?wo=${order.work_order_id}` }
        : { kind: 'create', vehicle: { type: 'truck', plateNumber: t.plate_number } },
    })
  }
  for (const t of trailersDown) {
    const order = openOrderFor((o) => o.trailer_id === t.trailer_id)
    alerts.push({
      key: `trailer-${t.trailer_id}`,
      title: `Trailer ${trailerName(t)} not operational`,
      detail: order ? `${t.current_status} · ${order.work_order_number}, ${order.maintenance_type}` : `${t.current_status} · no open work order`,
      tone: 'bad',
      action: order
        ? { kind: 'link', label: 'Open Work Order', to: `/dashboard/maintenance?wo=${order.work_order_id}` }
        : { kind: 'create', vehicle: { type: 'trailer', trailerId: t.trailer_id } },
    })
  }
  for (const o of workOrders) {
    if ((o.work_order_status === 'Created' || o.work_order_status === 'Scheduled') && o.scheduled_start_date && o.scheduled_start_date < today) {
      const vehicle = o.plate_number ?? trailerName(trailers.find((t) => t.trailer_id === o.trailer_id) ?? { trailer_id: o.trailer_id ?? 0, plate_number: null })
      alerts.push({
        key: `wo-${o.work_order_id}`,
        title: `${o.work_order_number} not started`,
        detail: `${vehicle} · ${o.maintenance_type} · scheduled ${formatDate(o.scheduled_start_date)}`,
        tone: 'warn',
        action: { kind: 'link', label: 'Open Work Order', to: `/dashboard/maintenance?wo=${o.work_order_id}` },
      })
    }
  }
  for (const t of trucks) {
    if (!t.next_service_date || down(t.current_status)) continue
    const days = daysUntil(t.next_service_date, today)
    if (days > DUE_SOON_DAYS) continue
    alerts.push({
      key: `service-${t.plate_number}`,
      title: `${t.plate_number} service ${days < 0 ? 'overdue' : 'due soon'}`,
      detail: `Next service date ${formatDate(t.next_service_date)}${days < 0 ? ` (${-days} days ago)` : days === 0 ? ' (today)' : ` (in ${days} days)`}`,
      tone: days < 0 ? 'bad' : 'warn',
      action: { kind: 'create', vehicle: { type: 'truck', plateNumber: t.plate_number } },
    })
  }
  for (const s of schedules) {
    const due = formatScheduleDueDate(s.due_date)
    if (due.tone === 'upcoming') continue
    alerts.push({
      key: `schedule-${s.schedule_id}`,
      title: `${s.vehicle_label.replace(/^(Truck|Trailer): /, '')} · ${s.maintenance_type}`,
      detail: `Maintenance schedule · ${due.label}`,
      tone: due.tone === 'overdue' ? 'bad' : 'warn',
      action: { kind: 'link', label: 'Open Schedules', to: '/dashboard/maintenance?tab=Schedules' },
    })
  }
  alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1))

  // A truck's next maintenance: its next service date or its earliest
  // pending schedule, whichever comes first.
  function nextMaintenance(t: Truck): { date: string; what: string } | null {
    const options = [
      ...(t.next_service_date ? [{ date: t.next_service_date, what: 'Service' }] : []),
      ...schedules.filter((s) => s.plate_number === t.plate_number).map((s) => ({ date: s.due_date, what: s.maintenance_type })),
    ].sort((a, b) => a.date.localeCompare(b.date))
    return options[0] ?? null
  }

  // PMS cycle per truck; the table lists the truck nearest its PMS first.
  const pmsOf = (t: Truck) =>
    pmsStatus(
      t.current_odometer != null ? Number(t.current_odometer) : null,
      t.last_pms_odometer != null ? Number(t.last_pms_odometer) : null,
      pmsSettings,
    )
  const trucksByPms = [...trucks].sort((a, b) => byPmsUrgency(pmsOf(a), pmsOf(b)))
  const trucksDueForPms = trucks.filter((t) => {
    const stage = pmsOf(t)?.stage
    return stage === 'soon' || stage === 'due'
  })
  const pagedTrucks = usePaged(trucksByPms, '')

  return (
    <div>
      <PageHeader
        title="Truck Monitoring"
        subtitle="Which trucks can run, how close each one is to its PMS, odometer readings and maintenance alerts."
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
            </svg>
            Refresh
          </button>
        }
      />
      {error && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section aria-label="Fleet status" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[
          { label: 'Trucks operational', value: trucks.length - trucksDown.length, of: trucks.length },
          { label: 'Trucks not operational', value: trucksDown.length, bad: trucksDown.length > 0 },
          { label: 'Trailers operational', value: trailers.length - trailersDown.length, of: trailers.length },
          { label: 'Trips not counted on odometer', value: uncounted.length, bad: uncounted.length > 0 },
          { label: 'Trucks due for PMS', value: trucksDueForPms.length, bad: trucksDueForPms.length > 0 },
        ].map((tile) => (
          <div key={tile.label} className="card px-[18px] py-3.5">
            <p className="text-sm font-medium text-ink-secondary">{tile.label}</p>
            <p className={`text-[28px] leading-9 font-bold tracking-[-0.01em] tabular-nums ${tile.bad ? 'text-red-700' : 'text-ink'}`}>
              {loading || tile.value === null ? '…' : tile.value}
              {tile.of !== undefined && !loading && <span className="ml-1.5 text-base font-medium text-ink-muted">of {tile.of}</span>}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="trucks-h" className="card">
            <div className={PANEL_HEAD}>
              <h2 id="trucks-h" className="text-base font-semibold text-ink">
                Trucks
              </h2>
              <Link to="/dashboard/fleet" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                Open Fleet
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14 M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
            {loading ? (
              <p className="px-5 py-4 text-ink-muted">Loading trucks...</p>
            ) : trucks.length === 0 ? (
              <EmptyState message="No trucks yet." className="m-5" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm text-ink-metric">
                  <thead>
                    <tr>
                      <th className={TH}>Plate No.</th>
                      <th className={TH}>Status</th>
                      <th className={`${TH} text-right`}>Odometer</th>
                      <th className={`${TH} w-48`}>Next PMS</th>
                      <th className={TH}>Last Trips</th>
                      <th className={TH}>Next Maintenance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTrucks.rows.map((t) => {
                      const last = trips.filter((trip) => trip.plate_number === t.plate_number).slice(0, 2)
                      const next = nextMaintenance(t)
                      const overdue = next ? next.date < today : false
                      const pms = pmsOf(t)
                      const pmsOrder = workOrders.find((o) => o.plate_number === t.plate_number && o.pms_target_km !== null)
                      return (
                        <tr key={t.plate_number} className="h-[60px] border-b border-slate-200">
                          <td className={`${TD} font-semibold ${down(t.current_status) ? 'text-ink-muted' : 'text-ink'}`}>{t.plate_number}</td>
                          <td className={TD}>
                            <StatusBadge status={t.current_status ?? 'Available'} icon />
                          </td>
                          <td className={`${TD} text-right tabular-nums`}>
                            {t.current_odometer != null ? `${Number(t.current_odometer).toLocaleString()} km` : '—'}
                          </td>
                          <td className={`${TD} py-3`}>
                            {pms && <span className="mb-1 block text-[12px] text-ink-muted">at {pms.nextAt.toLocaleString()} km</span>}
                            <PmsProgress status={pms} settings={pmsSettings} plate={t.plate_number} />
                            {pmsOrder && (
                              <Link
                                to={`/dashboard/maintenance?wo=${pmsOrder.work_order_id}`}
                                className="mt-1 block text-[12px] font-semibold text-primary underline"
                              >
                                PMS work order · {pmsOrder.work_order_status}
                              </Link>
                            )}
                          </td>
                          <td className={`${TD} ${last.length ? '' : 'text-ink-muted'}`}>
                            {last.length === 0
                              ? 'No recent trips'
                              : `${last.length === 1 ? 'Trip' : 'Trips'} ${last.map((trip) => `#${trip.itinerary_id}`).join(', ')} · ${formatDate(last[0].trip_date_from)}`}
                          </td>
                          <td className={`${TD} ${next ? (overdue ? 'font-semibold text-red-700' : '') : 'text-ink-muted'}`}>
                            {next ? (
                              <>
                                {formatDate(next.date)}
                                <span className="block text-[13px] font-normal text-ink-muted">{next.what}</span>
                              </>
                            ) : (
                              'Not set'
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <Pager {...pagedTrucks.pager} />
              </div>
            )}
          </section>

          <section aria-labelledby="alerts-h" className="card">
            <div className={PANEL_HEAD}>
              <h2 id="alerts-h" className="text-base font-semibold text-ink">
                Alerts
              </h2>
            </div>
            {loading ? (
              <p className="px-5 py-4 text-ink-muted">Loading alerts...</p>
            ) : alerts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">No alerts. Every truck and trailer is good to go.</p>
            ) : (
              <ul>
                {alerts.map((alert) => (
                  <li
                    key={alert.key}
                    className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 last:border-0 ${
                      alert.tone === 'bad' ? 'shadow-[inset_4px_0_0_#b91c1c]' : 'shadow-[inset_4px_0_0_#d97706]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 text-sm">
                      <strong className="block font-semibold text-ink">{alert.title}</strong>
                      <span className="text-ink-muted">{alert.detail}</span>
                    </span>
                    {alert.action.kind === 'link' ? (
                      <Link to={alert.action.to} className="btn-secondary inline-flex items-center px-4 text-sm font-medium">
                        {alert.action.label}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCreateFor((alert.action as { vehicle: PreselectedVehicle }).vehicle)}
                        className="btn-secondary px-4 text-sm font-medium"
                      >
                        Create Work Order
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {loading ? (
          <section className="card px-5 py-4 text-ink-muted">Loading odometer...</section>
        ) : (
          <OdometerPanel trucks={trucks} uncounted={uncounted} entries={odometerLog} onChanged={() => void load()} />
        )}
      </div>

      {createFor && (
        <CreateWorkOrderModal
          vehicle={createFor}
          onClose={() => setCreateFor(null)}
          onCreated={() => {
            setCreateFor(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

export default TruckMaintenanceMonitoringSection
