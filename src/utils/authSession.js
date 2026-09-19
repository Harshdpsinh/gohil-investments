export const AUTH_SESSION_KEY = 'gi-auth-session'
export const AUTH_SESSION_TTL_MS = 15 * 60 * 1000

export function readAuthSession(uid, now = Date.now()) {
  if (!uid) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_SESSION_KEY) || '')
    if (parsed?.uid !== uid || !parsed.role) return null
    const cachedAt = Number(parsed.cachedAt) || 0
    if (!cachedAt || now - cachedAt > AUTH_SESSION_TTL_MS) return null
    return { uid: parsed.uid, email: parsed.email || '', role: parsed.role }
  } catch {
    return null
  }
}

export function writeAuthSession({ uid, email, role }, now = Date.now()) {
  if (!uid || !role) return
  try {
    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      uid,
      email: email || '',
      role,
      cachedAt: now,
    }))
  } catch {
    /* private mode / quota — open still works, just slower next time */
  }
}

export function clearAuthSession() {
  try { window.localStorage.removeItem(AUTH_SESSION_KEY) } catch { /* ignore */ }
}
