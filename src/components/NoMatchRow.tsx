import type { ReactNode } from 'react'

// NoMatchRow: the row a table shows when its search / filters match nothing.
// The table (and its headers) stays on screen; this one row spans every
// column and says what wasn't found, with a button to clear the search.
//
//   <NoMatchRow colSpan={6} message={`No employee matches "${search}"`} onClear={() => setSearch('')} />
//
// No `onClear` = message only (e.g. a loading or error row).
export default function NoMatchRow({
  colSpan,
  message,
  onClear,
  clearLabel = 'Clear search',
  tone = 'text-ink-secondary',
}: {
  colSpan: number
  message: ReactNode
  onClear?: () => void
  clearLabel?: string
  tone?: string
}) {
  return (
    <tr>
      <td colSpan={colSpan} className={`px-5 py-8 text-center text-sm ${tone}`}>
        <p className="font-medium">{message}</p>
        {onClear && (
          <button type="button" onClick={onClear} className="btn-secondary mt-3 px-4 text-sm font-medium">
            {clearLabel}
          </button>
        )}
      </td>
    </tr>
  )
}

