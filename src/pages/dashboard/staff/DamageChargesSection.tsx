// DamageChargesSection: Damage Charges page (Dispatcher + Admin; the
// canvas's Dispatcher Damage board). Damage recorded on delivered trips --
// from Mark Delivered on the Dispatch Board or the Report Damage form beside
// the table -- and who pays for it: Client (added to the client's bill on
// top of the delivery amount) or Company (a company cost). Picking one
// approves the record. Search by booking # or client, 10 rows a page.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import ReportDamageForm from './ReportDamageForm'
import PageHeader from '../../../components/PageHeader'
import { formatDate, formatMoney } from '../../../lib/format'
import { usePaged } from '../../../lib/usePaged'

type DamageCharge = {
  damage_id: number
  itinerary_id: number
  booking_id: number
  client_name: string
  route: string
  damage_description: string
  estimated_damage_cost: number | null
  charge_to: 'Client' | 'Company'
  damage_status: string
  created_at: string | null
}

function DamageChargesSection() {
  const { employeeId } = useAuth()
  const [damageCharges, setDamageCharges] = useState<DamageCharge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    loadDamageCharges()
  }, [])

  async function loadDamageCharges() {
    setLoading(true)
    setError(null)

    const { data: damageRows, error: damageError } = await supabase
      .from('delivery_damage_records')
      .select(
        'damage_id, itinerary_id, damage_description, estimated_damage_cost, charge_to, damage_status, created_at',
      )
      .order('created_at', { ascending: false })

    if (damageError) {
      setError(damageError.message)
      setLoading(false)
      return
    }

    if (damageRows.length === 0) {
      setDamageCharges([])
      setLoading(false)
      return
    }

    // Damage is reported per trip when it's marked Delivered on the
    // Dispatch Board (MarkDeliveredModal).
    const itineraryIds = Array.from(new Set(damageRows.map((row) => row.itinerary_id)))
    const { data: itineraryRows, error: itineraryError } = await supabase
      .from('itineraries')
      .select('itinerary_id, booking_id, place_of_pickup_id, place_of_delivery_id')
      .in('itinerary_id', itineraryIds)

    if (itineraryError) {
      setError(itineraryError.message)
      setLoading(false)
      return
    }

    const bookingIds = itineraryRows.map((row) => row.booking_id)
    const placeIds = Array.from(
      new Set(
        itineraryRows.flatMap((row) => [
          row.place_of_pickup_id,
          row.place_of_delivery_id,
        ]),
      ),
    )

    const [bookingsResult, placesResult] = await Promise.all([
      supabase.from('bookings').select('booking_id, client_id').in('booking_id', bookingIds),
      supabase.from('places').select('place_id, place_name').in('place_id', placeIds),
    ])
    // Only the clients these damage records belong to.
    const clientIds = Array.from(new Set((bookingsResult.data ?? []).map((row) => row.client_id)))
    const clientsResult = await supabase
      .from('clients')
      .select('client_id, client_name')
      .in('client_id', clientIds)

    const lookupError =
      bookingsResult.error ?? clientsResult.error ?? placesResult.error
    if (lookupError) {
      setError(lookupError.message)
      setLoading(false)
      return
    }

    const itineraryById = new Map(itineraryRows.map((row) => [row.itinerary_id, row]))
    const bookingById = new Map(
      (bookingsResult.data ?? []).map((row) => [row.booking_id, row]),
    )
    const clientNameById = new Map(
      (clientsResult.data ?? []).map((row) => [row.client_id, row.client_name]),
    )
    const placeNameById = new Map(
      (placesResult.data ?? []).map((row) => [row.place_id, row.place_name]),
    )

    setDamageCharges(
      damageRows.flatMap((row) => {
        const itinerary = itineraryById.get(row.itinerary_id)
        const booking = itinerary ? bookingById.get(itinerary.booking_id) : undefined

        if (!itinerary || !booking) {
          return []
        }

        return [{
          damage_id: row.damage_id,
          itinerary_id: row.itinerary_id,
          booking_id: itinerary.booking_id,
          client_name: clientNameById.get(booking.client_id) ?? '—',
          route: `${placeNameById.get(itinerary.place_of_pickup_id) ?? '—'} → ${placeNameById.get(itinerary.place_of_delivery_id) ?? '—'}`,
          damage_description: row.damage_description,
          estimated_damage_cost: row.estimated_damage_cost,
          charge_to: row.charge_to === 'Company' ? 'Company' : 'Client',
          damage_status: row.damage_status ?? 'Reported',
          created_at: row.created_at,
        }]
      }),
    )
    setLoading(false)
  }

  async function approveCharge(damage: DamageCharge, chargeTo: 'Client' | 'Company') {
    if (!employeeId) {
      setError('Your account is not linked to an employee record.')
      return
    }

    setSavingId(damage.damage_id)
    setError(null)

    // .select() so a silent RLS no-op shows as an error, not fake success.
    const { data: updated, error: updateError } = await supabase
      .from('delivery_damage_records')
      .update({
        charge_to: chargeTo,
        damage_status: 'Approved',
        approved_by: employeeId,
        approved_at: new Date().toISOString(),
      })
      .eq('damage_id', damage.damage_id)
      .select('damage_id')
      .maybeSingle()

    setSavingId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }
    if (!updated) {
      setError('The decision was not saved -- you may not have permission, or the record was removed. Reload the page.')
      return
    }

    setDamageCharges((current) =>
      current.map((item) =>
        item.damage_id === damage.damage_id
          ? { ...item, charge_to: chargeTo, damage_status: 'Approved' }
          : item,
      ),
    )
  }

  // Booking # (with or without "#") or client name.
  const query = search.trim().toLowerCase().replace(/^#/, '')
  const visible = query
    ? damageCharges.filter((d) => String(d.booking_id) === query || d.client_name.toLowerCase().includes(query))
    : damageCharges
  const paged = usePaged(visible, query)

  const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
  const TD = 'px-2 py-2 first:pl-5 last:pr-5'
  const segButton = (on: boolean) =>
    `min-h-11 flex-1 border px-3 text-sm font-semibold disabled:opacity-50 ${
      on ? 'relative border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-50'
    }`

  return (
    <div>
      <PageHeader
        title="Damage Charges"
        subtitle="Damage recorded on delivered trips, and who pays for it."
        actions={
          <label className="flex items-center gap-2.5 text-sm font-medium text-ink-secondary">
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Booking or client"
              className="min-h-11 w-60 rounded-[2px] border border-line-control bg-white px-3 text-sm text-ink-metric placeholder:text-ink-muted focus:border-primary"
            />
          </label>
        }
      />

      {error && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start">
        <section aria-label="Damage charges" className="card flex min-w-0 flex-col">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] table-fixed text-left text-sm text-ink-muted">
              <colgroup>
                {['150px', '120px', '', '', '120px', '230px'].map((width, i) => (
                  <col key={i} style={width ? { width } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className={TH}>Booking</th>
                  <th className={TH}>Client</th>
                  <th className={TH}>Route</th>
                  <th className={TH}>Damage</th>
                  <th className={`${TH} text-right`}>Est. Cost</th>
                  <th className={TH}>Who Pays</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-ink-muted">
                      Loading damage reports...
                    </td>
                  </tr>
                ) : paged.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center">
                      <p className="font-semibold text-ink">{query ? 'No damage matches that search.' : 'No delivery damage has been reported.'}</p>
                      {!query && (
                        <p className="mt-1 text-[13px] text-ink-muted">Use Report Damage, or record it when marking a trip delivered on the Dispatch Board.</p>
                      )}
                    </td>
                  </tr>
                ) : (
                  paged.rows.map((damage) => {
                    const decided = damage.damage_status === 'Approved'
                    return (
                      <tr key={damage.damage_id} className="h-[68px] border-b border-slate-200">
                        <td className={TD}>
                          <span className="block font-semibold text-ink-metric">Booking #{damage.booking_id}</span>
                          <span className="block text-[13px] leading-[18px]">
                            Trip #{damage.itinerary_id}
                            {damage.created_at ? ` · ${formatDate(damage.created_at)}` : ''}
                          </span>
                        </td>
                        <td className={`${TD} truncate`} title={damage.client_name}>
                          {damage.client_name}
                        </td>
                        <td className={TD}>
                          <span className="line-clamp-2" title={damage.route}>
                            {damage.route}
                          </span>
                        </td>
                        <td className={TD}>
                          <span className="line-clamp-2" title={damage.damage_description}>
                            {damage.damage_description}
                          </span>
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{formatMoney(damage.estimated_damage_cost)}</td>
                        <td className={TD}>
                          <div role="group" aria-label={`Who pays for booking #${damage.booking_id}`} className="flex">
                            <button
                              type="button"
                              aria-pressed={decided && damage.charge_to === 'Client'}
                              onClick={() => approveCharge(damage, 'Client')}
                              disabled={savingId === damage.damage_id}
                              className={segButton(decided && damage.charge_to === 'Client')}
                            >
                              Client
                            </button>
                            <button
                              type="button"
                              aria-pressed={decided && damage.charge_to === 'Company'}
                              onClick={() => approveCharge(damage, 'Company')}
                              disabled={savingId === damage.damage_id}
                              className={`-ml-px ${segButton(decided && damage.charge_to === 'Company')}`}
                            >
                              Company
                            </button>
                          </div>
                          {!decided && <span className="mt-1 block text-xs font-medium text-amber-800">Not decided yet</span>}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {paged.pager.pageCount > 1 && (
            <div className="flex min-h-[60px] items-center justify-between gap-3 border-t border-line px-5 py-2 text-sm text-ink-secondary">
              <span>
                Page {paged.pager.page + 1} of {paged.pager.pageCount}
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
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <ReportDamageForm onReported={() => void loadDamageCharges()} />
          <section aria-labelledby="wp-h" className="card px-5 py-3.5 text-sm">
            <h2 id="wp-h" className="mb-1 font-semibold text-ink">
              Who pays
            </h2>
            <div className="flex flex-col gap-0.5 border-b border-slate-200 py-2.5">
              <strong className="text-ink">Client</strong>
              <span className="text-ink-secondary">Added to the client's bill on top of the delivery amount.</span>
            </div>
            <div className="flex flex-col gap-0.5 pt-2.5">
              <strong className="text-ink">Company</strong>
              <span className="text-ink-secondary">Recorded as a company cost.</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default DamageChargesSection