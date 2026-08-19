// StaffDashboard: shown to both Admin and Dispatcher -- identical view
// for both roles, only the role badge text differs.
import { useAuth } from '../../context/AuthContext'
import RoleBadge from '../../components/RoleBadge'

// Placeholder numbers -- real queries come in a later step.
const summaryCards = [
  { label: 'Pending Quotes', value: '--' },
  { label: 'Active Bookings', value: '--' },
  { label: "Today's Deliveries", value: '--' },
  { label: 'Fleet Size', value: '--' },
]

function StaffDashboard() {
  const { username, role } = useAuth()

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {username}
        </h1>
        <RoleBadge role={role} />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default StaffDashboard
