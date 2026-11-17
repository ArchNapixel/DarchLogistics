// Self-check for src/lib/wordLimit.ts -- run with: node scripts/check-word-limit.ts
import assert from 'node:assert/strict'
import { NOTE_WORD_LIMIT, countWords, limitWords } from '../src/lib/wordLimit.ts'

assert.equal(countWords(''), 0)
assert.equal(countWords('   \n '), 0)
assert.equal(countWords(' one  two\nthree '), 3)
assert.equal(limitWords('a b c d', 3), 'a b c')
assert.equal(limitWords('a b c', 3), 'a b c')
assert.equal(limitWords('a b c ', 3), 'a b c ') // a trailing space while typing stays
assert.equal(limitWords('a\n\nb  c d', 3), 'a\n\nb  c')
const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
assert.equal(countWords(limitWords(long)), NOTE_WORD_LIMIT)
console.log('ok')
