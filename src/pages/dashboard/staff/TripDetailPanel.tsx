// TripDetailPanel: everything about ONE trip, shown on the right of the
// Trips tab (Bookings & Trips). Route, time slot, crew, vehicles and cargo
// come from the list row (lib/tripList.ts); the rest is loaded here for
// this trip only:
//   - status timeline (dispatch_status_logs, via dispatchStatusLog.ts)
//   - expenses the crew logged (itinerary_expenses)
//   - damage records (delivery_damage_records)
//   - issue reports tied to the trip (issue_reports.itinerary_id)
//   - documents (TripDocuments -- staff can upload/delete here)
// Laid out as three cards: Trip Details, Trip Log, Documents. Missing crew
// or vehicles on a trip that isn't finished show in orange.
// Storage-deadline trips also show met / missed (lib/storageDeadline.ts).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import StatusBadge from '../../../components/StatusBadge'
import TripDocuments from './TripDocuments'
import { formatDate, formatDateTime, formatMoney, formatSlot } from '../../../lib/format'
import { loadDispatchStatusLogForItinerary, type DispatchStatusLogEntry } from '../../../lib/dispatchStatusLog'
import { STORAGE_BADGE, storageState } from '../../../lib/storageDeadline'
import { TRIP_STATUS_LABELS, type TripListRow } from '../../../lib/tripList'

type Extra = {
  log: DispatchStatusLogEntry[]
  expenses: { expense_id: number; amount: number; description: string; category: string | null; created_at: string }[]
  damage: {
    damage_id: number
    damage_description: string
    estimated_damage_cost: number | null
    charge_to: string | null
    damage_status: string | null
  }[]
  issues: { issue_report_id: number; description: string; severity: string | null; reported_at: string; worked_on: boolean | null }[]
}

async function loadExtra(itineraryId: number): Promise<{ extra?: Extra; error?: string }> {
  const [log, expenses, damage, issues] = await Promise.all([
    loadDispatchStatusLogForItinerary(itineraryId),
    supabase
      .from('itinerary_expenses')
      .select('expense_id, amount, description, category, created_at')
      .eq('itinerary_id', itineraryId)
      .order('created_at', { ascending: true }),
    supabase
      .from('delivery_damage_records')
      .select('damage_id, damage_description, estimated_damage_cost, charge_to, damage_status')
      .eq('itinerary_id', itineraryId)
      .order('damage_id', { ascending: true }),
    supabase
      .from('issue_reports')
      .select('issue_report_id, description, severity, reported_at, worked_on')
      .eq('itinerary_id', itineraryId)
      .order('reported_at', { ascending: true }),
  ])
  const error = log.error ?? expenses.error?.message ?? damage.error?.message ?? issues.error?.message
  if (error) return { error }
  return {
    extra: {
      log: log.entries,
      expenses: expenses.data ?? [],
      damage: damage.data ?? [],
      issues: issues.data ?? [],
    },
  }
}

// A bordered card with a title, like the design's Trip Details / Trip Log / Documents.
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-2 border-slate-300 bg-white px-5 py-4">
      <h4 className="text-base font-semibold text-slate-900">{title}</h4>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  )
}

function Info({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-0.5 text-[15px] text-slate-900">{children}</div>
    </div>
  )
}

// One row of the Trip Log card: label on the left, its contents on the right.
function LogRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-slate-200 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <span className="font-semibold text-slate-900">{label}</span>
      <div className="text-slate-700">{children}</div>
    </div>
  )
}

function TripDetailPanel({
  trip,
  onOpenBooking,
  onDocumentCount,
}: {
  trip: TripListRow
  onOpenBooking: (bookingId: number) => void
  // Keeps the 📎 count in the list in step with uploads/deletes here.
  onDocumentCount: (itineraryId: number, count: number) => void
}) {
  const [extra, setExtra] = useState<Extra | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Time the panel opened -- enough for the storage badge (render must stay pure).
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    loadExtra(trip.itinerary_id).then((result) => {
      if (cancelled) return
      setExtra(result.extra ?? null)
      setError(result.error ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [trip.itinerary_id])

  // First time it was logged Picked Up (the log comes newest first).
  const pickedUpAt =
    extra?.log.filter((e) => e.new_status === 'PickedUp').at(-1)?.changed_at ?? null
  const storage = storageState({
    deadline: trip.storage_deadline,
    status: trip.status,
    pickedUpAt,
    now,
  })
  const expenseTotal = (extra?.expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0)
  // Missing crew / vehicles only matter on a trip that still has to run.
  const stillToRun = trip.status !== 'Delivered' && trip.status !== 'Cancelled'
  const missing = stillToRun ? 'font-medium text-orange-700' : 'text-slate-400'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-bold text-slate-900">Trip #{trip.itinerary_id}</h3>
            <StatusBadge status={trip.status} label={TRIP_STATUS_LABELS[trip.status]} icon />
            {storage && (
              <span className={`px-1.5 py-0.5 text-xs font-medium ${STORAGE_BADGE[storage].className}`}>
                {STORAGE_BADGE[storage].label}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Booking #{trip.booking_id} · {trip.client_name}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenBooking(trip.booking_id)}
          className="flex items-center gap-2 border-2 border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Open Booking <span aria-hidden="true">→</span>
        </button>
      </div>

      <Card title="Trip Details">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Info label="Route">
            {trip.pickup} → {trip.delivery}
          </Info>
          <Info label="Time Slot">
            {trip.trip_start_at ? (
              formatSlot(trip.trip_start_at, trip.trip_end_at)
            ) : (
              <span className={missing}>{trip.trip_date_from ? formatDate(trip.trip_date_from) : '—'} · no time set</span>
            )}
          </Info>
          <Info label="Crew">
            {trip.driver ?? <span className={missing}>No driver</span>}
            {trip.helper && <span className="block text-sm text-slate-500">Helper: {trip.helper}</span>}
          </Info>
          <Info label="Truck / Trailer">
            {trip.plate_number || trip.trailer_plate ? (
              <>
                {trip.plate_number ?? <span className={missing}>no truck</span>}
                {' / '}
                {trip.trailer_plate ?? <span className={missing}>no trailer</span>}
              </>
            ) : (
              <span className={missing}>No truck / no trailer</span>
            )}
          </Info>
          {trip.storage_deadline && (
            <Info label="Storage deadline">
              {formatDate(trip.storage_deadline)}, 11:59 PM
              {pickedUpAt && <span className="block text-sm text-slate-500">Picked up {formatDateTime(pickedUpAt)}</span>}
            </Info>
          )}
        </div>
      </Card>

      {/* Cargo gets its own card so it's easy to compare against the quote. */}
      <Card title="Cargo Details">
        <div className="grid gap-4 sm:grid-cols-4">
          <Info label="Cargo Type">
            {trip.cargo.cargo_type === 'Loose' ? 'Loose cargo' : (trip.cargo.cargo_type ?? '—')}
          </Info>
          <Info label="Container / Trailer">
            {[trip.cargo.container_type, trip.cargo.trailer_type?.toLowerCase()].filter(Boolean).join(' ') || '—'}
          </Info>
          <Info label="Weight">
            {trip.cargo.weight != null && trip.cargo.weight > 0 ? `${trip.cargo.weight} t` : '—'}
          </Info>
          <Info label="Description">{trip.cargo.cargo_description || '—'}</Info>
        </div>
      </Card>

      <Card title="Trip Log">
        {error ? (
          <p className="bg-red-50 px-4 py-3 text-red-700">Couldn't load the trip's history ({error}).</p>
        ) : !extra ? (
          <p className="text-slate-500">Loading…</p>
        ) : (
          <div className="-mb-2.5">
            <LogRow label="Status Timeline">
              {extra.log.length === 0 ? (
                'No status changes yet.'
              ) : (
                <ol className="flex flex-col gap-1">
                  {[...extra.log].reverse().map((e) => (
                    <li key={e.log_id} className="flex flex-wrap justify-between gap-x-3">
                      <span className="text-slate-800">
                        {TRIP_STATUS_LABELS[e.previous_status] ?? e.previous_status} →{' '}
                        <span className="font-medium">{TRIP_STATUS_LABELS[e.new_status] ?? e.new_status}</span>
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatDateTime(e.changed_at)} · {e.changed_by_name}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </LogRow>
            <LogRow label="Expenses">
              {extra.expenses.length === 0 ? (
                'None logged.'
              ) : (
                <ul className="flex flex-col gap-1">
                  {extra.expenses.map((e) => (
                    <li key={e.expense_id} className="flex justify-between gap-3">
                      <span>
                        {e.category ? `${e.category} · ` : ''}
                        {e.description}
                      </span>
                      <span className="font-medium text-slate-900">{formatMoney(Number(e.amount))}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 border-t border-slate-100 pt-1 font-semibold text-slate-900">
                    <span>Total</span>
                    <span>{formatMoney(expenseTotal)}</span>
                  </li>
                </ul>
              )}
            </LogRow>
            <LogRow label="Damage">
              {extra.damage.length === 0 ? (
                'None reported.'
              ) : (
                <ul className="flex flex-col gap-1">
                  {extra.damage.map((d) => (
                    <li key={d.damage_id} className="flex flex-wrap justify-between gap-x-3">
                      <span>{d.damage_description}</span>
                      <span className="text-xs text-slate-500">
                        {formatMoney(Number(d.estimated_damage_cost ?? 0))} · {d.charge_to ?? '—'} ·{' '}
                        {d.damage_status ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </LogRow>
            <LogRow label="Issue Reports">
              {extra.issues.length === 0 ? (
                'None for this trip.'
              ) : (
                <ul className="flex flex-col gap-1">
                  {extra.issues.map((i) => (
                    <li key={i.issue_report_id} className="flex flex-wrap justify-between gap-x-3">
                      <span>
                        {i.severity ? `${i.severity} · ` : ''}
                        {i.description}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatDate(i.reported_at)}
                        {i.worked_on ? ' · worked on' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </LogRow>
          </div>
        )}
      </Card>

      <Card title="Documents">
        <TripDocuments itineraryId={trip.itinerary_id} canEdit onCountChange={onDocumentCount} />
      </Card>
    </div>
  )
}

export default TripDetailPanel
