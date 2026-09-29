// LoadMore: the "Show more" button under the log tables. Logs only fetch
// the newest LOG_PAGE_SIZE rows; each click asks for that many more. Shown
// only while the last fetch came back full (so there may be more).
export const LOG_PAGE_SIZE = 200

export function LoadMore({
  shown,
  limit,
  onMore,
}: {
  shown: number
  limit: number
  onMore: () => void
}) {
  if (shown < limit) return null
  return (
    <div className="mt-3 flex justify-center">
      <button
        onClick={onMore}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Show more
      </button>
    </div>
  )
}
