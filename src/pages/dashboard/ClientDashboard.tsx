// ClientDashboard: shown to the Client role.
import { useAuth } from '../../context/AuthContext'
import RoleBadge from '../../components/RoleBadge'
import MyBookingsSection from './client/MyBookingsSection'

function ClientDashboard() {
  const { username, role } = useAuth()

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {username}
        </h1>
        <RoleBadge role={role} />
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">My Bookings</h2>
        <div className="mt-4">
          <MyBookingsSection />
        </div>
      </div>
    </div>
  )
}

export default ClientDashboard
