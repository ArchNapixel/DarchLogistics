// ProtectedRoute: wrap any page with this to require a logged-in user.
// Reads the shared session state from AuthContext (instead of its own
// Supabase calls) so we don't run two auth listeners at once.
// Role-specific access (staff/employee/client) is handled separately
// inside DashboardRouter, since /dashboard is shared by all three tiers.
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  // Don't flash the login page (or the protected content) while we're
  // still checking whether a session exists.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export default ProtectedRoute
