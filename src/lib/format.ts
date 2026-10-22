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

// ---- Times of day (12-hour, Philippine time) -------------------------
// Noon is "12 NN" and midnight "12 MN" (local usage); whole hours drop
// the ":00" -> "6 AM", "5:30 PM".

// Hour 0-23 + minute -> "6 AM" / "12 NN" / "12 MN" / "5:30 PM".
export function formatClock(hour: number, minute: number): string {
  if (minute === 0 && hour === 12) return '12 NN'
  if (minute === 0 && hour === 0) return '12 MN'
  const h12 = hour % 12 || 12
  const mm = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`
  return `${h12}${mm} ${hour < 12 ? 'AM' : 'PM'}`
}

// Minutes after midnight (app_settings time values, 360 = 6 AM) -> "6 AM".
export function formatMinutesOfDay(minutes: number): string {
  return formatClock(Math.floor(minutes / 60) % 24, minutes % 60)
}

// A timestamp's Manila calendar date (YYYY-MM-DD) and hour/minute.
function manilaParts(value: string | number | Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

// A timestamp -> its Manila time of day, "6 AM". null -> "—".
export function formatTime(value: string | number | Date | null | undefined): string {
  if (!value) return '—'
  const { hour, minute } = manilaParts(value)
  return formatClock(hour, minute)
}

// A trip's time slot -> "Oct 22, 2026, 6 AM – 12 NN", or with both dates
// when it crosses midnight: "Oct 22, 2026, 10 PM – Oct 23, 2026, 4 AM".
export function formatSlot(
  start: string | number | Date | null | undefined,
  end: string | number | Date | null | undefined,
): string {
  if (!start) return 'No start time'
  const s = manilaParts(start)
  const startText = `${formatDate(s.date)}, ${formatClock(s.hour, s.minute)}`
  if (!end) return startText
  const e = manilaParts(end)
  const endClock = formatClock(e.hour, e.minute)
  return e.date === s.date ? `${startText} – ${endClock}` : `${startText} – ${formatDate(e.date)}, ${endClock}`
}

// A Manila date (YYYY-MM-DD) + minutes after midnight -> ISO timestamp
// with the +08:00 offset, ready to save into a timestamptz column.
export function manilaTimestamp(date: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${date}T${hh}:${mm}:00+08:00`
}

// The reverse of manilaTimestamp: a timestamp -> its Manila date
// (YYYY-MM-DD) and minutes after midnight, for filling date/time inputs.
export function splitManila(value: string | number | Date): { date: string; minutes: number } {
  const { date, hour, minute } = manilaParts(value)
  return { date, minutes: hour * 60 + minute }
}
