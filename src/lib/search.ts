// search: the rules every search box in the app shares (pure functions,
// self-check: node scripts/check-search.ts).
//   - Upper/lower case and extra spaces don't matter ("ABC  1234" finds "ABC 1234").
//   - A typed number ("48" or "#48") is an EXACT booking / trip / item number --
//     "4" never finds #14 or #41.
//   - Any other text matches part of a field ("jua" finds "Juan Dela Cruz").

// Lowercase, trimmed, every run of spaces turned into one.
export function searchText(text: string | null | undefined): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// 48 for "48" / "#48" / " # 48 ", else null.
export function numberQuery(query: string): number | null {
  const q = searchText(query).replace(/^#\s*/, '')
  return /^\d+$/.test(q) ? Number(q) : null
}

// True when one of the fields contains the typed text (an empty search matches everything).
export function textMatches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = searchText(query)
  return !q || fields.some((field) => searchText(field).includes(q))
}

// True when the typed number is exactly one of the ids.
export function idMatches(query: string, ...ids: (number | null | undefined)[]): boolean {
  const n = numberQuery(query)
  return n !== null && ids.some((id) => id === n)
}

// The no-results message: `No employee matches "juan"` (+ " with these
// filters" when dropdown filters are also narrowing the list).
export function noMatchText(thing: string, search: string, filtered = false): string {
  const q = search.trim()
  if (!q) return `No ${thing} matches these filters`
  return `No ${thing} matches "${q}"${filtered ? ' with these filters' : ''}`
}
