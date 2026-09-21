// AuthContext: tracks the logged-in Supabase session PLUS that user's
// role/username from the `users` table, in one place. Any component can
// read this via useAuth() instead of re-fetching the session or role
// itself.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

// employees.employment_status_id has no foreign key at the database
// level (same as everywhere else it's read, e.g. EmployeesSection.tsx),
// so this is two lookups rather than one embedded select: the
// employee's current status_id, then whether that id's name is
// "Deactivated". Runs on every login/session-restore, not just once, so
// a deactivated employee is signed back out even if they still have a
// valid cached session from before they were deactivated.
async function isEmployeeDeactivated(employeeId: number): Promise<boolean> {
  const { data: employee } = await supabase
    .from('employees')
    .select('employment_status_id')
    .eq('employee_id', employeeId)
    .single()

  if (!employee || employee.employment_status_id === null) return false

  const { data: status } = await supabase
    .from('employment_status')
    .select('status_name')
    .eq('status_id', employee.employment_status_id)
    .single()

  return status?.status_name === 'Deactivated'
}

type AuthState = {
  session: Session | null
  role: string | null
  username: string | null
  employeeId: number | null
  clientId: number | null
  loading: boolean
  error: string | null
}

const AuthContext = createContext<AuthState>({
  session: null,
  role: null,
  username: null,
  employeeId: null,
  clientId: null,
  loading: true,
  error: null,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    role: null,
    username: null,
    employeeId: null,
    clientId: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    // onAuthStateChange fires immediately with the current session (or
    // null) as soon as we subscribe, so we don't need a separate
    // getSession() call -- this one listener covers first load, login,
    // logout, and token refresh.
    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!session) {
          setState({
            session: null,
            role: null,
            username: null,
            employeeId: null,
            clientId: null,
            loading: false,
            error: null,
          })
          return
        }

        // Look up this user's role, display name, and linked
        // employee/client record from the `users` table, matching on
        // auth_user_id (the column that links a `users` row to its
        // Supabase Auth account) rather than the plain-integer user_id
        // primary key.
        const { data, error } = await supabase
          .from('users')
          .select('user_role, username, employee_id, client_id')
          .eq('auth_user_id', session.user.id)
          .single()

        if (data) {
          if (data.employee_id !== null && (await isEmployeeDeactivated(data.employee_id))) {
            await supabase.auth.signOut()
            setState({
              session: null,
              role: null,
              username: null,
              employeeId: null,
              clientId: null,
              loading: false,
              error: 'This account has been deactivated. Contact an admin.',
            })
            return
          }

          setState({
            session,
            role: data.user_role,
            username: data.username,
            employeeId: data.employee_id,
            clientId: data.client_id,
            loading: false,
            error: null,
          })
          return
        }

        // No row matched by auth_user_id -- this may be a client logging
        // in for the first time. Staff pre-create their `users` row
        // (auth_user_id left NULL, since we can't create the actual
        // login from the browser) when setting up a client account; on
        // first login we auto-claim that row by matching email.
        if (error?.code === 'PGRST116' && session.user.email) {
          const { data: pending } = await supabase
            .from('users')
            .select('user_id, user_role, username, employee_id, client_id')
            .eq('email', session.user.email)
            .is('auth_user_id', null)
            .single()

          if (pending) {
            const { error: claimError } = await supabase
              .from('users')
              .update({ auth_user_id: session.user.id })
              .eq('user_id', pending.user_id)

            if (!claimError) {
              setState({
                session,
                role: pending.user_role,
                username: pending.username,
                employeeId: pending.employee_id,
                clientId: pending.client_id,
                loading: false,
                error: null,
              })
              return
            }
          }
        }

        setState({
          session,
          role: null,
          username: null,
          employeeId: null,
          clientId: null,
          loading: false,
          error: 'Could not load your account role. Please contact an admin.',
        })
      },
    )

    return () => listener.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
