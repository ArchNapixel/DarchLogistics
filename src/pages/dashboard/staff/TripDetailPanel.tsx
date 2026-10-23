// TripDetailPanel: everything about ONE trip, shown on the right of the
// Trips tab (Bookings & Trips). Route, time slot, crew and vehicles come
// from the list row (lib/tripList.ts); the rest is loaded here for this
// trip only:
//   - status timeline (dispatch_status_logs, via dispatchStatusLog.ts)
//   - expenses the crew logged (itinerary_expenses)
//   - damage records (delivery_damage_records)
//   - issue reports tied to the trip (issue_reports.itinerary_id)
//   - documents (TripDocuments -- staff can upload/delete here)
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h4>
      <div className="mt-2 text-sm">{children}</div>
    </section>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <div className="text-slate-900">{children}</div>
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

  return (
    <div className="border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Trip #{trip.itinerary_id}</h3>
          <p className="mt-0.5 text-sm text-slate-600">
            Booking #{trip.booking_id} · {trip.client_name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={trip.status} label={TRIP_STATUS_LABELS[trip.status]} />
          {storage && (
            <span className={`px-1.5 py-0.5 text-xs font-medium ${STORAGE_BADGE[storage].className}`}>
              {STORAGE_BADGE[storage].label}
            </span>
          )}
          <button
            type="button"
            onClick={() => onOpenBooking(trip.booking_id)}
            className="border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Open booking
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Info label="Route">
          {trip.pickup} → {trip.delivery}
        </Info>
        <Info label="Time slot">
          {trip.trip_start_at
            ? formatSlot(trip.trip_start_at, trip.trip_end_at)
            : `${trip.trip_date_from ? formatDate(trip.trip_date_from) : '—'} (no time set)`}
        </Info>
        <Info label="Crew">
          {trip.driver ?? <span className="text-slate-400">No driver</span>}
          {trip.helper && <span className="block text-xs text-slate-500">Helper: {trip.helper}</span>}
        </Info>
        <Info label="Truck / trailer">
          {trip.plate_number ?? <span className="text-slate-400">No truck</span>}
          {' / '}
          {trip.trailer_plate ?? <span className="text-slate-400">no trailer</span>}
        </Info>
        {trip.storage_deadline && (
          <Info label="Storage deadline">
            {formatDate(trip.storage_deadline)}, 11:59 PM
            {pickedUpAt && <span className="block text-xs text-slate-500">Picked up {formatDateTime(pickedUpAt)}</span>}
          </Info>
        )}
      </div>

      {error ? (
        <p className="mt-5 bg-red-50 px-4 py-3 text-sm text-red-700">Couldn't load the trip's history ({error}).</p>
      ) : !extra ? (
        <p className="mt-5 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <Section title="Status timeline">
            {extra.log.length === 0 ? (
              <p className="text-slate-500">No status changes yet.</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
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
          </Section>

          <Section title={`Expenses${extra.expenses.length ? ` · ${formatMoney(expenseTotal)}` : ''}`}>
            {extra.expenses.length === 0 ? (
              <p className="text-slate-500">None logged.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {extra.expenses.map((e) => (
                  <li key={e.expense_id} className="flex justify-between gap-3">
                    <span className="text-slate-700">
                      {e.category ? `${e.category} · ` : ''}
                      {e.description}
                    </span>
                    <span className="font-medium text-slate-900">{formatMoney(Number(e.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Damage">
            {extra.damage.length === 0 ? (
              <p className="text-slate-500">None reported.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {extra.damage.map((d) => (
                  <li key={d.damage_id} className="flex flex-wrap justify-between gap-x-3">
                    <span className="text-slate-700">{d.damage_description}</span>
                    <span className="text-xs text-slate-500">
                      {formatMoney(Number(d.estimated_damage_cost ?? 0))} · {d.charge_to ?? '—'} ·{' '}
                      {d.damage_status ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Issue reports">
            {extra.issues.length === 0 ? (
              <p className="text-slate-500">None for this trip.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {extra.issues.map((i) => (
                  <li key={i.issue_report_id} className="flex flex-wrap justify-between gap-x-3">
                    <span className="text-slate-700">
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
          </Section>
        </>
      )}

      <Section title="Documents">
        <TripDocuments itineraryId={trip.itinerary_id} canEdit onCountChange={onDocumentCount} />
      </Section>
    </div>
  )
}

export default TripDetailPanel
