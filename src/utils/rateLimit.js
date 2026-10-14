/** Sliding window. The store is a Map of key -> timestamps, owned by the caller. */
export function takeToken(store, key, { limit, windowMs, now = Date.now() } = {}) {
  const recent = (store.get(key) || []).filter(at => now - at < windowMs)
  if (recent.length >= limit) {
    store.set(key, recent)
    return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - recent[0])) }
  }
  recent.push(now)
  store.set(key, recent)
  return { ok: true, retryAfterMs: 0 }
}
