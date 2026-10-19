// format: the ONE way the app SHOWS money and dates, so every page looks
// the same. Display only -- never use these for values sent to Supabase,
// <input type="date"> values, or CSV exports. Those stay machine-friendly
// (2026-09-17, 1234.5).

// 1234.5 -> "₱1,234.50" (always 2 decimals), -50 -> "-₱50.00",
// null/undefined -> "—".
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const digits = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${value < 0 ? '-' : ''}₱${digits}`
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// "2026-09-17" -> "Sep 17, 2026". A plain date (no time) is shown as that
// exact calendar day; a full timestamp (or milliseconds number) is shown as
// its Philippine (Manila) date. null/empty -> "—".
export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return '—'
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  })
}

// A timestamp -> "Sep 17, 2026, 2:30 PM" (Philippine time). Use where the
// time matters: status logs, "submitted at", payments received, etc.
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  })
}
