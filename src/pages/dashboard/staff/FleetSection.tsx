// FleetSection: tabbed view of the truck and trailer fleet.
//
// MOCK DATA -- replace with real Supabase query later. Nothing on this
// page reads from or writes to the database yet.
import { useState } from 'react'

type FleetStatus = 'Active' | 'Under Maintenance' | 'Out of Service'

type Truck = {
  truck_id: number
  plate_number: string
  make_model: string
  status: FleetStatus
  last_service_date: string
}

type Trailer = {
  trailer_id: number
  trailer_code: string
  trailer_type: string
  status: FleetStatus
}

// MOCK DATA -- replace with real Supabase query later.
const MOCK_TRUCKS: Truck[] = [
  {
    truck_id: 1,
    plate_number: 'NGP 4521',
    make_model: 'Isuzu Giga 10-Wheeler',
    status: 'Active',
    last_service_date: '2026-07-15',
  },
  {
    truck_id: 2,
    plate_number: 'NGP 8873',
    make_model: 'Hino 500 6-Wheeler',
    status: 'Active',
    last_service_date: '2026-08-02',
  },
  {
    truck_id: 3,
    plate_number: 'NGV 2210',
    make_model: 'Fuso Fighter 8-Wheeler',
    status: 'Under Maintenance',
    last_service_date: '2026-08-20',
  },
  {
    truck_id: 4,
    plate_number: 'NGV 6634',
    make_model: 'Isuzu Forward',
    status: 'Out of Service',
    last_service_date: '2026-05-11',
  },
]

// MOCK DATA -- replace with real Supabase query later.
const MOCK_TRAILERS: Trailer[] = [
  {
    trailer_id: 1,
    trailer_code: 'TRL-001',
    trailer_type: '40ft Flatbed',
    status: 'Active',
  },
  {
    trailer_id: 2,
    trailer_code: 'TRL-002',
    trailer_type: '20ft Container Chassis',
    status: 'Active',
  },
  {
    trailer_id: 3,
    trailer_code: 'TRL-003',
    trailer_type: 'Refrigerated Van',
    status: 'Under Maintenance',
  },
]

const STATUS_STYLES: Record<FleetStatus, string> = {
  Active: 'bg-green-100 text-green-700',
  'Under Maintenance': 'bg-orange-100 text-orange-700',
  'Out of Service': 'bg-red-100 text-red-700',
}

function FleetStatusBadge({ status }: { status: FleetStatus }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

const TABS = ['Trucks', 'Trailers'] as const
type Tab = (typeof TABS)[number]

function FleetSection() {
  const [activeTab, setActiveTab] = useState<Tab>('Trucks')

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

      {activeTab === 'Trucks' ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Plate Number</th>
                <th className="px-4 py-3 font-medium">Make / Model</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Service Date</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_TRUCKS.map((truck) => (
                <tr
                  key={truck.truck_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">
                    {truck.plate_number}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {truck.make_model}
                  </td>
                  <td className="px-4 py-3">
                    <FleetStatusBadge status={truck.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {truck.last_service_date}
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
                <th className="px-4 py-3 font-medium">Trailer Code</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_TRAILERS.map((trailer) => (
                <tr
                  key={trailer.trailer_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">
                    {trailer.trailer_code}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {trailer.trailer_type}
                  </td>
                  <td className="px-4 py-3">
                    <FleetStatusBadge status={trailer.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default FleetSection
