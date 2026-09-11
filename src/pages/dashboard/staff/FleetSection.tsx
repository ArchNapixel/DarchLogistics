import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import CreateWorkOrderModal from './CreateWorkOrderModal'

type Truck = {
  plate_number: string
  model: string | null
  current_status: string | null
  last_service_date: string | null
}

type Trailer = {
  trailer_id: number
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
  const [activeTab, setActiveTab] = useState<Tab>('Trucks')
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workOrderTruck, setWorkOrderTruck] = useState<string | null>(null)

  useEffect(() => {
    async function loadFleet() {
      try {
        setLoading(true)
        setError('')

        const { data: truckData, error: truckError } = await supabase
          .from('truck_profiles')
          .select('plate_number, model, current_status, last_service_date')
          .order('plate_number', { ascending: true })

        if (truckError) throw truckError

        const { data: trailerData, error: trailerError } = await supabase
          .from('trailers')
          .select(
            'trailer_id, trailer_type, registration_number, current_status, last_maintenance_date'
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

    loadFleet()
  }, [])

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Fleet</h2>

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
                    <button
                      onClick={() => setWorkOrderTruck(truck.plate_number)}
                      className="font-medium text-slate-600 hover:text-slate-900"
                    >
                      Create Work Order
                    </button>
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
                <th className="px-4 py-3 font-medium">Trailer ID</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Registration</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {trailers.map((trailer) => (
                <tr
                  key={trailer.trailer_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">{trailer.trailer_id}</td>
                  <td className="px-4 py-3 text-slate-600">{trailer.trailer_type}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {trailer.registration_number || 'N/A'}
                  </td>
                  <td className="px-4 py-3">
                    <FleetStatusBadge status={trailer.current_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {workOrderTruck && (
        <CreateWorkOrderModal
          plateNumber={workOrderTruck}
          onClose={() => setWorkOrderTruck(null)}
          onCreated={() => setWorkOrderTruck(null)}
        />
      )}
    </div>
  )
}

export default FleetSection