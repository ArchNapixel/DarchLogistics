// Toast: a small pop-up message that fades away on its own, for telling
// staff "that action worked". Mount <ToastHost /> once (main.tsx), then
// anywhere, even in plain functions or after a modal has closed:
//
//   showToast('Booking #12 has been cancelled.')
//   showToast('Could not save.', 'error')
//
// Same idea as ConfirmDialog: the mounted host registers itself in a
// module variable, so call sites need no hook or provider.
import { useEffect, useState } from 'react'

type ToastKind = 'success' | 'error'
type ToastItem = { id: number; message: string; kind: ToastKind }

const SHOW_MS = 4000

let add: ((message: string, kind: ToastKind) => void) | null = null

// eslint-disable-next-line react-refresh/only-export-components -- kept next to the host that shows it
export function showToast(message: string, kind: ToastKind = 'success') {
  add?.(message, kind)
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    let nextId = 0
    add = (message, kind) => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, message, kind }])
      // Remove it again after a few seconds.
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), SHOW_MS)
    }
    return () => {
      add = null
    }
  }, [])

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-[110] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${
            t.kind === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
