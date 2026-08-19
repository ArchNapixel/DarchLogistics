// EmployeeDashboard: shown to both Driver and Mechanic -- identical view
// for both roles, only the role badge text differs.
import { useAuth } from '../../context/AuthContext'
import RoleBadge from '../../components/RoleBadge'
import MyTasksSection from './employee/MyTasksSection'

function EmployeeDashboard() {
  const { username, role } = useAuth()

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {username}
        </h1>
        <RoleBadge role={role} />
      </div>

      <div className="mt-8">
        <MyTasksSection />
      </div>
    </div>
  )
}

export default EmployeeDashboard
