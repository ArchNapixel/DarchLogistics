import { NOTE_WORD_LIMIT, countWords } from '../lib/wordLimit'

// WordCount: the small "n / 300 words" line under a note box (lib/wordLimit.ts).
// Turns amber once the limit is reached.
export default function WordCount({ text }: { text: string }) {
  const words = countWords(text)
  const full = words >= NOTE_WORD_LIMIT
  return (
    <span className={`block text-right text-xs font-normal ${full ? 'text-amber-800' : 'text-ink-muted'}`} aria-live="polite">
      {words} / {NOTE_WORD_LIMIT} words{full ? ' -- limit reached' : ''}
    </span>
  )
}
