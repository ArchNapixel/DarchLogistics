// usePaged: show a long list one page at a time (with components/Pager.tsx)
// instead of a page that scrolls on and on.
//
//   const paged = usePaged(visibleRows, `${tab}|${search}`)
//   paged.rows.map(...)                    // just this page
//   <Pager {...paged.pager} />
//
// `resetKey` = whatever filters the list (tab, search, status...). When it
// changes, the list goes back to page 1 by itself -- no effect needed: the
// page is stored together with the key it was chosen for. Counts and
// totals should still use the FULL list, not paged.rows.
import { useState } from 'react'
import { pageSlice } from './pageSlice'

export const ROWS_PER_PAGE = 10

export function usePaged<T>(rows: T[], resetKey = '', perPage = ROWS_PER_PAGE) {
  const [chosen, setChosen] = useState({ key: resetKey, page: 0 })
  const page = chosen.key === resetKey ? chosen.page : 0
  const slice = pageSlice(rows, page, perPage)
  return {
    rows: slice.rows,
    pager: {
      page: slice.page,
      pageCount: slice.pageCount,
      onChange: (next: number) => setChosen({ key: resetKey, page: next }),
    },
  }
}
