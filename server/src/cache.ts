/** Tiny in-process TTL cache. Sprout allows 60 req/min - this keeps us well under. */
type Entry<T> = { value: T; expiresAt: number }

const store = new Map<string, Entry<unknown>>()

/**
 * `ttlFor` lets the TTL depend on the result. Used so a failed lookup is retried
 * soon rather than being cached as a failure for as long as a success would be.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  ttlFor?: (value: T) => number,
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const value = await fn()
  const ttl = ttlFor ? ttlFor(value) : ttlSeconds
  store.set(key, { value, expiresAt: Date.now() + ttl * 1000 })
  return value
}

export function clearCache() {
  store.clear()
}
