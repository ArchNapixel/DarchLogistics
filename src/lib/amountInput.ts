// amountInput: the peso amount boxes on the payment forms -- typing filter,
// parsing and centavo rounding. Pure functions (self-check:
// node scripts/check-amount-input.ts).

// Rounds to centavos, so float leftovers (21952.4999999) never decide a check.
export const cents = (n: number) => Math.round(n * 100) / 100

// Typing filter: digits and ONE dot, at most 2 decimals, max 12 characters.
// Pasting "₱21,952.50" becomes "21952.50".
export function filterAmountInput(v: string): string {
  const cleaned = v.replace(/[^0-9.]/g, '')
  const dot = cleaned.indexOf('.')
  const whole = dot === -1 ? cleaned : cleaned.slice(0, dot)
  const decimals = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return (decimals === null ? whole : `${whole}.${decimals}`).slice(0, 12)
}

// The amount typed, or an error. Empty box = no value and no error yet.
export function parseAmount(text: string): { value: number | null; error: string | null } {
  if (text === '') return { value: null, error: null }
  if (!/^\d*\.?\d{0,2}$/.test(text) || text === '.') return { value: null, error: 'Not a valid amount.' }
  const value = cents(Number(text))
  if (!(value > 0)) return { value: null, error: 'Enter an amount greater than zero.' }
  return { value, error: null }
}

