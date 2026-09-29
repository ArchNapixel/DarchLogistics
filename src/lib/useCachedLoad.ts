// useCachedLoad: "show the last result instantly, refresh quietly".
// The first visit loads normally (data is null until it arrives). After
// that, coming back to the same key shows the previous result right away
// and refetches in the background, so the page never waits on a blank
// screen and is never more than one visit out of date.
// The cache lives in memory only -- a full page reload starts fresh.
import { useCallback, useEffect, useState } from 'react'

const cache = new Map<string, unknown>()

export function useCachedLoad<T>(key: string, loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T | undefined) ?? null)

  // `loader` must be a stable function (declared outside the component).
  useEffect(() => {
    let cancelled = false
    loader().then((result) => {
      cache.set(key, result)
      if (!cancelled) setData(result)
    })
    return () => {
      cancelled = true
    }
  }, [key, loader])

  // For event handlers ("something changed, re-fetch now").
  const refresh = useCallback(async () => {
    const result = await loader()
    cache.set(key, result)
    setData(result)
  }, [key, loader])

  return { data, refresh }
}
