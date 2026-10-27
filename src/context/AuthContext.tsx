// AuthContext: tracks the logged-in Supabase session PLUS that user's
// role/username from the `users` table, in one place. Any component can
// read this via useAuth() instead of re-fetching the session or role
// itself. The provider that fills it in is AuthProvider.tsx (its own file,
// so this one only exports the context, the hook and logOut -- fast
// refresh needs component files to export only components).
import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { showToast } from '../components/Toast'

export type AuthState = {
  session: Session | null
  role: string | null
  username: string | null
  employeeId: number | null
  clientId: number | null
  loading: boolean
  error: string | null
}

export const AuthContext = createContext<AuthState>({
  session: null,
  role: null,
  username: null,
  employeeId: null,
  clientId: null,
  loading: true,
  error: null,
})

export function useAuth() {
  return useContext(AuthContext)
}

// Log out from the public pages (NavBar, login pages, quote page). The
// dashboard has its own handleLogout in DashboardLayout. A failed sign-out
// may leave the session valid, so say so plainly instead of hiding it.
export async function logOut() {
  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error('Sign out failed', error)
    showToast(
      "Logging out didn't fully complete. If you're on a shared computer, " +
        'please close the browser to be safe, then try logging out again.',
      'error',
    )
  }
}
