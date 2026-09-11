import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import CreateWorkOrderModal, { type PreselectedVehicle } from './CreateWorkOrderModal'
import AddTruckModal from './AddTruckModal'
import AddTrailerModal, { type EditableTrailer } from './AddTrailerModal'

type Truck = {
  plate_number: string
  model: string | null
  year: number | null
  current_status: string | null
  last_service_date: string | null
}

type Trailer = {
  trailer_id: number
  plate_number: string | null
  trailer_type: string
  registration_number: string | null
  current_status: string | null
  last_maintenance_date: string | null
}

const STATUS_STYLES: Record<string, string> = {
  Available: 'bg-green-100 text-green-700',
  'In Transit': 'bg-blue-100 text-blue-700',
  'Under Maintenance': 'bg-orange-100 text-orange-700',
  'Out of Service': 'bg-red-100 text-red-700',
}

function FleetStatusBadge({ status }: { status: string | null }) {
  const safeStatus = status ?? 'Available'
  const style = STATUS_STYLES[safeStatus] ?? 'bg-slate-100 text-slate-700'

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style}`}>
      {safeStatus}
    </span>
  )
}

const TABS = ['Trucks', 'Trailers'] as const
type Tab = (typeof TABS)[number]

function FleetSection() {
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab: Tab = requestedTab === 'Trailers' ? 'Trailers' : 'Trucks'

  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workOrderVehicle, setWorkOrderVehicle] = useState<PreselectedVehicle | null>(
    null,
  )
  const [showAddTruck, setShowAddTruck] = useState(false)
  const [showAddTrailer, setShowAddTrailer] = useState(false)
  const [editingTruck, setEditingTruck] = useState<Truck | null>(null)
  const [editingTrailer, setEditingTrailer] = useState<Trailer | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    loadFleet()
  }, [])

  async function handleDeleteTruck(truck: Truck) {
    if (!window.confirm(`Delete truck ${truck.plate_number}? This cannot be undone.`)) {
      return
    }

    setDeletingKey(truck.plate_number)
    setActionError(null)

    const { error: deleteError } = await supabase
      .from('truck_profiles')
      .delete()
      .eq('plate_number', truck.plate_number)

    setDeletingKey(null)

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

    loadFleet()
  }

  async function handleDeleteTrailer(trailer: Trailer) {
    if (
      !window.confirm(
        `Delete trailer ${trailer.plate_number ?? `#${trailer.trailer_id}`}? This cannot be undone.`,
      )
    ) {
      return
    }

    setDeletingKey(`trailer-${trailer.trailer_id}`)
    setActionError(null)

    const { error: deleteError } = await supabase
      .from('trailers')
      .delete()
      .eq('trailer_id', trailer.trailer_id)

    setDeletingKey(null)

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

    loadFleet()
  }

  async function loadFleet() {
    try {
      setLoading(true)
      setError('')

      const { data: truckData, error: truckError } = await supabase
        .from('truck_profiles')
        .select('plate_number, model, year, current_status, last_service_date')
        .order('plate_number', { ascending: true })

      if (truckError) throw truckError

      const { data: trailerData, error: trailerError } = await supabase
        .from('trailers')
        .select(
          'trailer_id, plate_number, trailer_type, registration_number, current_status, last_maintenance_date'
        )
        .order('trailer_id', { ascending: true })

      if (trailerError) throw trailerError

      setTrucks((truckData ?? []) as Truck[])
      setTrailers((trailerData ?? []) as Trailer[])
    } catch (err) {
      console.error('Failed to load fleet:', err)
      setError('Something went wrong while loading the fleet.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Fleet</h2>
        {activeTab === 'Trucks' ? (
          <button
            onClick={() => setShowAddTruck(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Add Truck
          </button>
        ) : (
          <button
            onClick={() => setShowAddTrailer(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Add Trailer
          </button>
        )}
      </div>

      {actionError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="mt-4 flex gap-2 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-6 text-sm text-slate-500">Loading fleet...</div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : activeTab === 'Trucks' ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Plate Number</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Service Date</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trucks.map((truck) => (
                <tr
                  key={truck.plate_number}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">{truck.plate_number}</td>
                  <td className="px-4 py-3 text-slate-600">{truck.model || 'N/A'}</td>
                  <td className="px-4 py-3">
                    <FleetStatusBadge status={truck.current_status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {truck.last_service_date || 'N/A'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() =>
                          setWorkOrderVehicle({
                            type: 'truck',
                            plateNumber: truck.plate_number,
                          })
                        }
                        className="font-medium text-slate-600 hover:text-slate-900"
                      >
                        Create Work Order
                      </button>
                      <button
                        onClick={() => setEditingTruck(truck)}
                        className="font-medium text-slate-600 hover:text-slate-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTruck(truck)}
                        disabled={deletingKey === truck.plate_number}
                        className="font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {deletingKey === truck.plate_number ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Plate Number</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Registration</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {trailers.map((trailer) => (
                <tr
                  key={trailer.trailer_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">
                    {trailer.plate_number || 'N/A'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{trailer.trailer_type}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {trailer.registration_number || 'N/A'}
                  </td>
                  <td className="px-4 py-3">
                    <FleetStatusBadge status={trailer.current_status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() =>
                          setWorkOrderVehicle({
                            type: 'trailer',
                            trailerId: trailer.trailer_id,
                          })
                        }
                        className="font-medium text-slate-600 hover:text-slate-900"
                      >
                        Create Work Order
                      </button>
                      <button
                        onClick={() => setEditingTrailer(trailer)}
                        className="font-medium text-slate-600 hover:text-slate-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTrailer(trailer)}
                        disabled={deletingKey === `trailer-${trailer.trailer_id}`}
                        className="font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        {deletingKey === `trailer-${trailer.trailer_id}`
                          ? 'Deleting...'
                          : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {workOrderVehicle && (
        <CreateWorkOrderModal
          vehicle={workOrderVehicle}
          onClose={() => setWorkOrderVehicle(null)}
          onCreated={() => setWorkOrderVehicle(null)}
        />
      )}

      {(showAddTruck || editingTruck) && (
        <AddTruckModal
          truck={editingTruck ?? undefined}
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
    </div>
  )
}

export default FleetSection