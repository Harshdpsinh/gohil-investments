// api/identityToolkit.js
// Identity Toolkit REST, not firebase-admin/auth — that subpath pulls jose
// and kills Vercel functions at load (see api/_shared.js verifyIdToken).
import crypto from 'node:crypto'

let cachedToken = { value: '', exp: 0 }

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.')
  const parsed = JSON.parse(raw)
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id or a key.')
  }
  return parsed
}

async function googleAccessToken() {
  if (cachedToken.value && cachedToken.exp > Date.now() + 60_000) return cachedToken.value
  const sa = serviceAccount()
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url')
  const unsigned = `${header}.${claim}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  const jwt = `${unsigned}.${signer.sign(sa.private_key, 'base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.error_description || 'Could not mint a Google access token.')
  }
  cachedToken = { value: body.access_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 }
  return cachedToken.value
}

async function identityPost(path, payload) {
  const token = await googleAccessToken()
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

export async function lookupAuthUserByEmail(email) {
  const sa = serviceAccount()
  const { ok, body } = await identityPost(`projects/${sa.project_id}/accounts:lookup`, { email: [email] })
  if (!ok) return null
  const user = body?.users?.[0]
  return user?.localId ? { uid: user.localId, email: user.email || email } : null
}

export async function createAuthUser({ email, password, name }) {
  const sa = serviceAccount()
  const { ok, body } = await identityPost(`projects/${sa.project_id}/accounts`, {
    email,
    password,
    displayName: name,
  })
  if (ok && body?.localId) return { uid: body.localId, email: body.email || email, created: true }
  const message = String(body?.error?.message || '')
  if (message.includes('EMAIL_EXISTS')) return null
  throw new Error(message || 'Could not create the Firebase login.')
}

export async function updateAuthPassword(uid, password) {
  const { ok, body } = await identityPost('accounts:update', { localId: uid, password })
  if (!ok) throw new Error(body?.error?.message || 'Could not update the password.')
}

export async function ensureAuthUser({ email, password, name }) {
  const existing = await lookupAuthUserByEmail(email)
  if (existing) {
    if (password) await updateAuthPassword(existing.uid, password)
    return { ...existing, created: false }
  }
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters for a new login.')
  }
  const created = await createAuthUser({ email, password, name })
  if (created) return created
  const raced = await lookupAuthUserByEmail(email)
  if (!raced) throw new Error('Could not find or create that login.')
  if (password) await updateAuthPassword(raced.uid, password)
  return { ...raced, created: false }
}
