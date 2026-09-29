// ConfirmDialog: replaces the browser's ugly window.confirm() with a
// modal that matches the rest of the app. Mount <ConfirmHost /> once
// (main.tsx), then anywhere:
//
//   if (!(await confirmDialog({ message: 'Delete Sol?', danger: true }))) return
//
// It returns a Promise<boolean> (true = confirmed), so call sites read
// almost exactly like window.confirm -- just add `await`.
// promptDialog() replaces window.prompt the same way: it resolves to the
// typed text (never empty -- the confirm button stays disabled until
// something is typed), or null if cancelled.
import { useEffect, useState } from 'react'

type ConfirmOptions = {
  message: string
  title?: string
  // Button text; defaults to "Confirm".
  confirmLabel?: string
  // Red confirm button, for deletes and other irreversible actions.
  danger?: boolean
}

type PromptOptions = ConfirmOptions & {
  // Text box pre-fill (e.g. a suggested reason).
  defaultValue?: string
  placeholder?: string
}

// A prompt is a confirm with a text box; `resolve` gets true/false for a
// confirm, and the text (or null) for a prompt.
type Pending = PromptOptions & {
  isPrompt: boolean
  resolve: (result: boolean | string | null) => void
}

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
    show({ ...options, isPrompt: false, resolve: (result) => resolve(result === true) })
  })
}

// eslint-disable-next-line react-refresh/only-export-components -- same reason as confirmDialog
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!show) {
      resolve(window.prompt(options.message, options.defaultValue))
      return
    }
    show({
      ...options,
      isPrompt: true,
      resolve: (result) => resolve(typeof result === 'string' ? result : null),
    })
  })
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [text, setText] = useState('')

  useEffect(() => {
    show = (next) => {
      setText(next.defaultValue ?? '')
      setPending(next)
    }
    return () => {
      show = null
    }
  }, [])

  function close(ok: boolean) {
    if (pending?.isPrompt) pending.resolve(ok ? text.trim() : null)
    else pending?.resolve(ok)
    setPending(null)
  }

  // Escape = Cancel.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pending.resolve(pending.isPrompt ? null : false)
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
        {pending.isPrompt && (
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={pending.placeholder}
            rows={3}
            className="mt-3 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
          />
        )}
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
            autoFocus={!pending.isPrompt}
            disabled={pending.isPrompt && !text.trim()}
            onClick={() => close(true)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
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
