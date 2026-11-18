// shortCache: keeps a loader's result for a few seconds so one page that asks
// for the same heavy data several times (Financial Summary: this month, five
// trend months, last month, "Where we stand" all read every client's ledger)
// loads it once. In memory only, per browser tab. A failed load isn't kept.
// Anything that changes money (a payment, a void, a charge) calls
// clearShortCache() so the next screen reads fresh numbers.
const entries = new Map<string, { at: number; value: Promise<unknown> }>()
const TTL_MS = 20_000

export function cached<T extends { error: string | null }>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = entries.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>
  const value = load().then(
    (result) => {
      if (result.error) entries.delete(key)
      return result
    },
    (thrown: unknown) => {
      entries.delete(key)
      throw thrown
    },
  )
  entries.set(key, { at: Date.now(), value })
  return value
}

export function clearShortCache() {
  entries.clear()
}
