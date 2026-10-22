// pageSlice: one page of a list for the Pager component (components/Pager.tsx).

// The rows for page `page` (0-based), plus the clamped page and page count
// -- clamped so a list that got shorter (e.g. after a refresh or an
// approval) never leaves you on an empty page.
export function pageSlice<T>(rows: T[], page: number, perPage: number) {
  const pageCount = Math.max(Math.ceil(rows.length / perPage), 1)
  const current = Math.min(Math.max(page, 0), pageCount - 1)
  return { rows: rows.slice(current * perPage, (current + 1) * perPage), page: current, pageCount }
}
