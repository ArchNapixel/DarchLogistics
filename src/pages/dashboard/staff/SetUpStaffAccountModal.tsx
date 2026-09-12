// SetUpStaffAccountModal: creates a real login for an employee (Admin,
// Dispatcher, Driver, or Mechanic) in one step -- same
// create-user-account Edge Function used by SetUpClientAccountModal.tsx,
// just passing employee_id instead of client_id. The function itself
// already checks the caller is staff and creates the Auth account +
// linked `public.users` row together.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { extractEdgeFunctionErrorMessage } from '../../../lib/edgeFunctionError'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type Employee = {
  employee_id: number
  name: string
  position: string
}

// Matches the `user_role` enum values also used as `employees.position`
// values in AddEmployeeModal.tsx (Driver/Mechanic/Dispatcher/Admin).
const USER_ROLES = ['Driver', 'Mechanic', 'Dispatcher', 'Admin'] as const

function SetUpStaffAccountModal({
  employee,
  onClose,
  onCreated,
}: {
  employee: Employee
  onClose: () => void
  onCreated: (employeeId: number) => void
}) {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState(employee.name)
  const [password, setPassword] = useState('')
  const [userRole, setUserRole] = useState(
    USER_ROLES.includes(employee.position as (typeof USER_ROLES)[number])
      ? employee.position
      : 'Driver',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit() {
    if (!email.trim() || !username.trim() || !password.trim()) {
      setError('Enter an email, username, and password.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { data, error: invokeError } = await supabase.functions.invoke(
      'create-user-account',
      {
        body: {
          email,
          username,
          password,
          user_role: userRole,
          employee_id: employee.employee_id,
        },
      },
    )

    setSubmitting(false)

    if (invokeError || data?.error) {
      setError(
        data?.error ??
          (await extractEdgeFunctionErrorMessage(
            invokeError,
            'Could not create account.',
          )),
      )
      return
    }

    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        {done ? (
          <>
            <h3 className="text-lg font-bold text-slate-900">
              Account created
            </h3>
            <p className="mt-3 text-sm text-slate-600">
              {employee.name} can now log in as a{' '}
              <span className="font-medium text-slate-900">{userRole}</span>{' '}
              with <span className="font-medium text-slate-900">{email}</span>{' '}
              and the password you just set. Share those credentials with
              them directly.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => onCreated(employee.employee_id)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-slate-900">
              Set Up Account for {employee.name}
            </h3>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-4 grid gap-4">
              <label className={labelClasses}>
                Role
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  className={fieldClasses}
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              <label className={labelClasses}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Username
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Password
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className={fieldClasses}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Create Account Record'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default SetUpStaffAccountModal
