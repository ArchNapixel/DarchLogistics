// ConfirmDialog: replaces the browser's ugly window.confirm() with a
// modal that matches the rest of the app. Mount <ConfirmHost /> once
// (main.tsx), then anywhere:
//
//   if (!(await confirmDialog({ message: 'Delete Sol?', danger: true }))) return
//
// It returns a Promise<boolean> (true = confirmed), so call sites read
// almost exactly like window.confirm -- just add `await`.
import { useEffect, useState } from 'react'

type ConfirmOptions = {
  message: string
  title?: string
  // Button text; defaults to "Confirm".
  confirmLabel?: string
  // Red confirm button, for deletes and other irreversible actions.
  danger?: boolean
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void }

// The mounted host registers itself here so confirmDialog() can reach it
// from plain functions (no hook or provider needed at call sites).
let show: ((pending: Pending) => void) | null = null

// eslint-disable-next-line react-refresh/only-export-components -- kept next to the host that shows it
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) {
      // Host not mounted (shouldn't happen) -- fall back to the browser one.
      resolve(window.confirm(options.message))
      return
    }
    show({ ...options, resolve })
  })
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    show = setPending
    return () => {
      show = null
    }
  }, [])

  function close(ok: boolean) {
    pending?.resolve(ok)
    setPending(null)
  }

  // Escape = Cancel.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pending.resolve(false)
        setPending(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  if (!pending) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4"
      onClick={() => close(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg"
      >
        <h3 id="confirm-title" className="text-lg font-bold text-slate-900">
          {pending.title ?? (pending.danger ? 'Are you sure?' : 'Please confirm')}
        </h3>
        <p className="mt-2 text-sm text-slate-600">{pending.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => close(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => close(true)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              pending.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700'
            }`}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
