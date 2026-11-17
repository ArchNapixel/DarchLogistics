// wordLimit: every free-text note / reason / description box in the app is
// capped at NOTE_WORD_LIMIT words (self-check: node scripts/check-word-limit.ts).
// Typing or pasting past the limit just drops the extra words; the box's
// <WordCount> shows "n / 300 words". No database limit -- the app is the only writer.

export const NOTE_WORD_LIMIT = 300

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// The text with only its first `max` words (spacing and line breaks inside
// them kept as typed).
export function limitWords(text: string, max = NOTE_WORD_LIMIT): string {
  const word = /\S+/g
  let count = 0
  for (let match = word.exec(text); match; match = word.exec(text)) {
    count += 1
    if (count > max) return text.slice(0, match.index).trimEnd()
  }
  return text
}
