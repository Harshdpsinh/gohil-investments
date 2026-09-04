export const AUTH_SESSION_KEY = 'gi-auth-session'

export function readAuthSession(uid) {
  if (!uid) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUTH_SESSION_KEY) || '')
    if (parsed?.uid === uid && parsed.role) return parsed
  } catch {
    return null
  }
  return null
}

export function writeAuthSession({ uid, email, role }) {
  if (!uid || !role) return
  try {
    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      uid,
      email: email || '',
      role,
    }))
  } catch {
    /* private mode / quota — open still works, just slower next time */
  }
}

export function clearAuthSession() {
  try { window.localStorage.removeItem(AUTH_SESSION_KEY) } catch { /* ignore */ }
}
