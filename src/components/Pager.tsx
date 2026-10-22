// Pager: "‹ Previous · Page 2 of 5 · Next ›" under a table that shows a
// fixed number of rows per page. Renders nothing when everything fits on
// one page. Use with pageSlice() from lib/pageSlice.ts.

function Pager({
  page,
  pageCount,
  onChange,
  className = '',
}: {
  page: number // 0-based, already clamped (pageSlice)
  pageCount: number
  onChange: (page: number) => void
  className?: string
}) {
  if (pageCount <= 1) return null
  const button =
    'border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40'
  return (
    <div className={`mt-3 flex items-center justify-end gap-3 text-sm text-slate-600 ${className}`}>
      <button type="button" onClick={() => onChange(page - 1)} disabled={page === 0} className={button}>
        ‹ Previous
      </button>
      <span>
        Page {page + 1} of {pageCount}
      </span>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= pageCount - 1} className={button}>
        Next ›
      </button>
    </div>
  )
}

export default Pager
