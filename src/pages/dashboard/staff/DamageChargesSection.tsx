import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import ReportDamageModal from './ReportDamageModal'

type DamageCharge = {
  damage_id: number
  booking_id: number
  client_name: string
  route: string
  damage_description: string
  estimated_damage_cost: number | null
  charge_to: 'Client' | 'Company'
  damage_status: string
  created_at: string | null
}

function formatMoney(value: number | null) {
  return value === null ? '—' : `₱${value.toLocaleString()}`
}

function DamageChargesSection() {
  const { employeeId } = useAuth()
  const [damageCharges, setDamageCharges] = useState<DamageCharge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [showReport, setShowReport] = useState(false)

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

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Damage Charges</h2>
          <p className="mt-1 text-sm text-slate-500">
            Review reported delivery damage and decide whether the cost is charged to the client or the company.
            Client charges are added to that booking's balance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowReport(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Report Damage
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {loading && <p className="mt-4 text-slate-500">Loading damage reports...</p>}
      {!loading && !error && damageCharges.length === 0 && (
        <p className="mt-4 text-slate-500">
          No delivery damage has been reported. Use Report Damage above, or record it when
          marking a trip delivered on the Dispatch Board.
        </p>
      )}
      {!loading && damageCharges.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Booking</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Damage</th>
                <th className="px-4 py-3 font-medium">Estimated cost</th>
                <th className="px-4 py-3 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody>
              {damageCharges.map((damage) => (
                <tr key={damage.damage_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-900">#{damage.booking_id}</td>
                  <td className="px-4 py-3 text-slate-900">{damage.client_name}</td>
                  <td className="px-4 py-3 text-slate-600">{damage.route}</td>
                  <td className="max-w-xs px-4 py-3 text-slate-600">{damage.damage_description}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{formatMoney(damage.estimated_damage_cost)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => approveCharge(damage, 'Client')}
                        disabled={savingId === damage.damage_id}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${damage.damage_status === 'Approved' && damage.charge_to === 'Client' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                      >
                        Client
                      </button>
                      <button
                        type="button"
                        onClick={() => approveCharge(damage, 'Company')}
                        disabled={savingId === damage.damage_id}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${damage.damage_status === 'Approved' && damage.charge_to === 'Company' ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                      >
                        Company
                      </button>
                      <span className="text-xs text-slate-500">{damage.damage_status}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showReport && (
        <ReportDamageModal
          onClose={() => setShowReport(false)}
          onReported={() => {
            setShowReport(false)
            loadDamageCharges()
          }}
        />
      )}
    </div>
  )
}

export default DamageChargesSection