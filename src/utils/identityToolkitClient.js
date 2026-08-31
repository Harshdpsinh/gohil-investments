// src/utils/identityToolkitClient.js
// Browser-side Auth create/lookup that does NOT touch the Firebase Auth SDK.
// createUserWithEmailAndPassword on a secondary app can steal the admin
// session; Firestore then writes users/{uid} as the new login and rules
// return "Missing or insufficient permissions".
const SIGN_UP = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp'
const SIGN_IN = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword'

export function identityToolkitErrorCode(message = '') {
  const code = String(message || '')
  if (code.includes('EMAIL_EXISTS')) return 'EMAIL_EXISTS'
  if (code.includes('INVALID_LOGIN_CREDENTIALS') || code.includes('INVALID_PASSWORD')) return 'INVALID_PASSWORD'
  if (code.includes('EMAIL_NOT_FOUND')) return 'EMAIL_NOT_FOUND'
  if (code.includes('WEAK_PASSWORD')) return 'WEAK_PASSWORD'
  if (code.includes('TOO_MANY_ATTEMPTS')) return 'TOO_MANY_ATTEMPTS'
  return 'UNKNOWN'
}

export function identityToolkitUserMessage(code) {
  if (code === 'INVALID_PASSWORD' || code === 'EMAIL_NOT_FOUND') {
    return 'This email already has a login. Enter that account\'s password, or use a different email.'
  }
  if (code === 'WEAK_PASSWORD') return 'Password too weak (min 8 chars)'
  if (code === 'TOO_MANY_ATTEMPTS') return 'Too many attempts. Wait a minute and try again.'
  return ''
}

async function postIdentityToolkit(url, apiKey, payload) {
  const response = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => null)
  if (response.ok && body?.localId) return body
  const code = identityToolkitErrorCode(body?.error?.message)
  const error = new Error(identityToolkitUserMessage(code) || body?.error?.message || 'Could not create that login.')
  error.code = code
  throw error
}

export async function createOrLookupAuthUser({ apiKey, email, password }) {
  if (!apiKey) throw new Error('Firebase API key is missing.')
  try {
    const created = await postIdentityToolkit(SIGN_UP, apiKey, {
      email,
      password,
      returnSecureToken: true,
    })
    return { uid: created.localId, created: true }
  } catch (err) {
    if (err.code !== 'EMAIL_EXISTS') throw err
    const existing = await postIdentityToolkit(SIGN_IN, apiKey, {
      email,
      password,
      returnSecureToken: true,
    })
    return { uid: existing.localId, created: false }
  }
}
