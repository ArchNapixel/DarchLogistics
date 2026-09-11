// MaintenanceSection: overview page for staff -- every work order
// (Active vs Completed tabs, matching the Trucks/Trailers tab pattern
// in FleetSection.tsx), plus a list of mechanics and how many active
// work orders each currently has, so staff can see who's free before
// assigning a new one.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import CreateWorkOrderModal from './CreateWorkOrderModal'

type WorkOrder = {
  work_order_id: number
  work_order_number: string
  vehicle_label: string
  mechanic_name: string
  maintenance_type: string
  work_order_status: string
  scheduled_start_date: string | null
}

type Mechanic = {
  employee_id: number
  full_name: string
  active_work_orders: number
}

const STATUS_STYLES: Record<string, string> = {
  Created: 'bg-gray-100 text-gray-700',
  Scheduled: 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-orange-100 text-orange-700',
  'On Hold': 'bg-yellow-100 text-yellow-700',
  Completed: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

const TABS = ['Active', 'Completed'] as const
type Tab = (typeof TABS)[number]

const ACTIVE_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']

function MaintenanceSection() {
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')

  const [activeTab, setActiveTab] = useState<Tab>(
    requestedTab === 'Completed' ? 'Completed' : 'Active',
  )
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    setActiveTab(requestedTab === 'Completed' ? 'Completed' : 'Active')
  }, [requestedTab])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)

    const { data: orderRows, error: orderError } = await supabase
      .from('work_orders')
      .select(
        'work_order_id, work_order_number, plate_number, trailer_id, assigned_mechanic_id, maintenance_type, work_order_status, scheduled_start_date',
      )
      .order('scheduled_start_date', { ascending: true })

    if (orderError) {
      setError(orderError.message)
      setLoading(false)
      return
    }

    const { data: mechanicRows, error: mechanicError } = await supabase
      .from('employees')
      .select('employee_id, full_name')
      .eq('position', 'Mechanic')
      .order('full_name', { ascending: true })

    if (mechanicError) {
      setError(mechanicError.message)
      setLoading(false)
      return
    }

    const { data: trailerRows, error: trailerError } = await supabase
      .from('trailers')
      .select('trailer_id, plate_number')

    if (trailerError) {
      setError(trailerError.message)
      setLoading(false)
      return
    }

    const mechanicNameById = new Map(
      mechanicRows.map((m) => [m.employee_id, m.full_name]),
    )
    const trailerPlateById = new Map(
      trailerRows.map((t) => [t.trailer_id, t.plate_number]),
    )

    setWorkOrders(
      orderRows.map((row) => ({
        work_order_id: row.work_order_id,
        work_order_number: row.work_order_number,
        vehicle_label: row.plate_number
          ? `Truck: ${row.plate_number}`
          : `Trailer: ${trailerPlateById.get(row.trailer_id) ?? `#${row.trailer_id}`}`,
        mechanic_name: mechanicNameById.get(row.assigned_mechanic_id) ?? '—',
        maintenance_type: row.maintenance_type,
        work_order_status: row.work_order_status,
        scheduled_start_date: row.scheduled_start_date,
      })),
    )

    setMechanics(
      mechanicRows.map((m) => ({
        employee_id: m.employee_id,
        full_name: m.full_name,
        active_work_orders: orderRows.filter(
          (o) =>
            o.assigned_mechanic_id === m.employee_id &&
            ACTIVE_STATUSES.includes(o.work_order_status),
        ).length,
      })),
    )

    setError(null)
    setLoading(false)
  }

  const filteredOrders = workOrders.filter((o) =>
    activeTab === 'Active'
      ? ACTIVE_STATUSES.includes(o.work_order_status)
      : !ACTIVE_STATUSES.includes(o.work_order_status),
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Maintenance</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New Work Order
        </button>
      </div>

      {loading && <p className="mt-4 text-slate-500">Loading maintenance data...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}

      {!loading && !error && (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="flex gap-2 border-b border-slate-200">
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

              {filteredOrders.length === 0 ? (
                <p className="mt-4 text-slate-500">
                  No {activeTab.toLowerCase()} work orders.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Work Order</th>
                        <th className="px-4 py-3 font-medium">Vehicle</th>
                        <th className="px-4 py-3 font-medium">Mechanic</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Scheduled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrders.map((order) => (
                        <tr
                          key={order.work_order_id}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <td className="px-4 py-3 text-slate-900">
                            {order.work_order_number}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {order.vehicle_label}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {order.mechanic_name}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {order.maintenance_type}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={order.work_order_status} />
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {order.scheduled_start_date ?? 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-700">
                Mechanics
              </h3>

              {mechanics.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  No mechanics found. Add one under Employees.
                </p>
              ) : (
                <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {mechanics.map((mechanic) => (
                    <div
                      key={mechanic.employee_id}
                      className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-0"
                    >
                      <span className="text-sm text-slate-900">
                        {mechanic.full_name}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {mechanic.active_work_orders} active
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {showCreate && (
        <CreateWorkOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            loadData()
          }}
        />
      )}
    </div>
  )
}

export default MaintenanceSection
