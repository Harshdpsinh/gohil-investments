// ops/attach-staff.mjs
// GitHub Action helper: look up a Firebase Auth email and write users/{uid}.
// Uses the FIREBASE_SERVICE_ACCOUNT secret, so it bypasses client rules.
import crypto from 'node:crypto'
import { parseStaffAttachInput } from '../src/utils/provisionUser.js'

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set.')
  const parsed = JSON.parse(raw)
  if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  return parsed
}

async function googleAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore',
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
  return body.access_token
}

async function lookupAuthUser(token, projectId, email) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: [email] }),
    },
  )
  const body = await response.json().catch(() => null)
  const uid = body?.users?.[0]?.localId
  return uid ? { uid, email: body.users[0].email || email } : null
}

async function writeStaffRow(token, projectId, uid, profile) {
  const params = new URLSearchParams()
  params.append('updateMask.fieldPaths', 'name')
  params.append('updateMask.fieldPaths', 'email')
  params.append('updateMask.fieldPaths', 'role')
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}?${params}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fields: {
          name: { stringValue: profile.name },
          email: { stringValue: profile.email },
          role: { stringValue: profile.role },
        },
      }),
    },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error?.message || `Firestore write failed (${response.status})`)
  }
}

const profile = parseStaffAttachInput({
  email: process.env.STAFF_EMAIL,
  name: process.env.STAFF_NAME,
  role: process.env.STAFF_ROLE,
})
const sa = serviceAccount()
const token = await googleAccessToken(sa)
const authUser = await lookupAuthUser(token, sa.project_id, profile.email)
if (!authUser) {
  console.error(`No Firebase login for ${profile.email}. Create Account in the CRM first, then re-run.`)
  process.exit(2)
}
await writeStaffRow(token, sa.project_id, authUser.uid, profile)
console.log(`Attached ${profile.email} as ${profile.role} (${authUser.uid})`)
