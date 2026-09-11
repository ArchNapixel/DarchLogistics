// DashboardRouter: renders at "/dashboard/*". Picks which set of routes
// to show based on the logged-in user's role (isStaff / isEmployee from
// src/lib/roles.ts), then defines only the sub-pages valid for that tier.
//
// This is what enforces tier protection beyond login: e.g. an Employee
// has no "quotations" route in their tree, so typing /dashboard/quotations
// directly falls through to the catch-all and bounces back to /dashboard.
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { isStaff, isEmployee } from '../../lib/roles'
import DashboardLayout from '../../components/DashboardLayout'
import StaffDashboard from './StaffDashboard'
import EmployeeDashboard from './EmployeeDashboard'
import ClientDashboard from './ClientDashboard'
import QuoteRequestsSection from './staff/QuoteRequestsSection'
import ClientsSection from './staff/ClientsSection'
import BookingsSection from './staff/BookingsSection'
import DispatchBoardSection from './staff/DispatchBoardSection'
import FleetSection from './staff/FleetSection'
import MaintenanceSection from './staff/MaintenanceSection'
import EmployeesSection from './staff/EmployeesSection'
import PayrollSection from './staff/PayrollSection'
import ReportsSection from './staff/ReportsSection'
import HistorySection from './employee/HistorySection'

const staffLinks = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'Quotations', to: '/dashboard/quotations' },
  { label: 'Bookings', to: '/dashboard/bookings' },
  { label: 'Clients', to: '/dashboard/clients' },
  { label: 'Dispatch Board', to: '/dashboard/dispatch' },
  { label: 'Fleet', to: '/dashboard/fleet' },
  { label: 'Maintenance', to: '/dashboard/maintenance' },
  { label: 'Employees', to: '/dashboard/employees' },
  { label: 'Payroll', to: '/dashboard/payroll' },
  { label: 'Reports', to: '/dashboard/reports' },
]

const employeeLinks = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'My History', to: '/dashboard/history' },
]

function CenteredMessage({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <p className="text-slate-500">{text}</p>
    </div>
  )
}

function DashboardRouter() {
  const { role, loading, error } = useAuth()

  if (loading) {
    return <CenteredMessage text="Loading your dashboard..." />
  }

  if (error) {
    return <CenteredMessage text={error} />
  }

  if (isStaff(role)) {
    return (
      <Routes>
        <Route element={<DashboardLayout sidebarLinks={staffLinks} />}>
          <Route index element={<StaffDashboard />} />
          <Route path="quotations" element={<QuoteRequestsSection />} />
          <Route path="bookings" element={<BookingsSection />} />
          <Route path="clients" element={<ClientsSection />} />
          <Route path="dispatch" element={<DispatchBoardSection />} />
          <Route path="fleet" element={<FleetSection />} />
          <Route path="maintenance" element={<MaintenanceSection />} />
          <Route path="employees" element={<EmployeesSection />} />
          <Route path="payroll" element={<PayrollSection />} />
          <Route path="reports" element={<ReportsSection />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    )
  }

  if (isEmployee(role)) {
    return (
      <Routes>
        <Route element={<DashboardLayout sidebarLinks={employeeLinks} />}>
          <Route index element={<EmployeeDashboard />} />
          <Route path="history" element={<HistorySection />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    )
  }

  if (role === 'Client') {
    return (
      <Routes>
        <Route element={<DashboardLayout sidebarLinks={[]} />}>
          <Route index element={<ClientDashboard />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    )
  }

  // Unknown/missing role -- friendly error instead of a crash.
  return (
    <CenteredMessage text="We couldn't determine your account type. Please contact an admin." />
  )
}

export default DashboardRouter
