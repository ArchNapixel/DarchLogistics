// clientAccount: the username/password rules for client accounts, shared
// by sign-up (ClientLoginPage) and the portal's Login & security box
// (ClientAccountSection), so both check the same thing. The database
// function change_my_username() repeats the username rule -- change both
// together.

// Max characters per field (also the inputs' maxLength). Password is 72
// because Supabase silently ignores anything past 72 bytes.
export const ACCOUNT_MAX = { username: 30, name: 100, email: 100, password: 72 }
export const MIN_PASSWORD = 6

// Username: 3–30 letters, digits, dot, underscore or dash.
const USERNAME_RULE = /^[A-Za-z0-9._-]{3,30}$/

// Typing filter: drops anything a username can't contain.
export const filterUsername = (v: string) => v.replace(/[^A-Za-z0-9._-]/g, '')

export function usernameError(username: string): string | null {
  return USERNAME_RULE.test(username.trim())
    ? null
    : `Username: 3–${ACCOUNT_MAX.username} characters, letters, numbers, dot, underscore or dash only.`
}

export function passwordError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`
  if (new TextEncoder().encode(password).length > ACCOUNT_MAX.password)
    return `Password is too long (max ${ACCOUNT_MAX.password} characters).`
  if (password !== confirm) return 'Passwords do not match.'
  return null
}
