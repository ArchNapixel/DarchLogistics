// CsvPreview: every CSV download in the app goes through here so the user
// sees what's in the file BEFORE it is saved. Mount <CsvPreviewHost /> once
// (main.tsx), then anywhere instead of building a Blob and clicking a link:
//
//   previewCsv(csv, 'collections_2026-11-01_to_2026-11-30.csv')
//
// A pop-up shows the rows as a table; "Download CSV" saves the exact same text.
import { useEffect, useState } from 'react'

type Pending = { csv: string; filename: string }

// The mounted host registers itself here so previewCsv() works from plain
// functions (same pattern as confirmDialog).
let show: ((pending: Pending) => void) | null = null

// Splits CSV text into rows of cells (handles "quoted, cells" and "" escapes).
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function saveCsv({ csv, filename }: Pending) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// Showing thousands of rows in the pop-up would freeze it; the file still has them all.
const MAX_PREVIEW_ROWS = 200

// eslint-disable-next-line react-refresh/only-export-components -- kept next to the host that shows it
export function previewCsv(csv: string, filename: string) {
  // Host not mounted (shouldn't happen) -- just download like before.
  if (!show) return saveCsv({ csv, filename })
  show({ csv, filename })
}

export function CsvPreviewHost() {
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    show = setPending
    return () => {
      show = null
    }
  }, [])

  // Escape = close.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPending(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  if (!pending) return null

  const rows = parseCsv(pending.csv)
  const shown = rows.slice(0, MAX_PREVIEW_ROWS)
  const width = Math.max(1, ...shown.map((r) => r.length))

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 px-4" onClick={() => setPending(null)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-preview-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-5xl flex-col border-2 border-line-card bg-white p-6"
      >
        <h3 id="csv-preview-title" className="text-lg font-bold text-slate-900">
          Preview: {pending.filename}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          {rows.length > shown.length && ` (showing the first ${shown.length}; the file has all of them)`}. Check it, then download.
        </p>

        <div className="mt-4 min-h-0 flex-1 overflow-auto border border-line">
          <table className="w-full text-left text-xs text-ink-metric">
            <tbody>
              {shown.map((row, r) => (
                <tr key={r} className="border-b border-slate-200 last:border-0">
                  {Array.from({ length: width }, (_, c) => (
                    <td key={c} className="px-3 py-1.5 whitespace-nowrap">
                      {row[c] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={() => setPending(null)} className="btn-secondary px-4 text-sm">
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              saveCsv(pending)
              setPending(null)
            }}
            className="btn-primary px-4 text-sm"
          >
            Download CSV
          </button>
        </div>
      </div>
    </div>
  )
}
