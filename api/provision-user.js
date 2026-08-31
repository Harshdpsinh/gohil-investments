// api/provision-user.js
// Admin-only: create or attach a Firebase Auth login and write users/{uid}.
// Fixes the loop where Auth already has the email so Manage Staff cannot add
// it, and the phone then shows "Account not provisioned".
import { getAdminDb, verifyIdToken, assertStaff } from './_shared.js'
import { ensureAuthUser } from './identityToolkit.js'
import { validateProvisionInput, provisionProfileFields } from '../src/utils/provisionUser.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!idToken) return res.status(401).json({ error: 'Missing sign-in token.' })

    const decoded = await verifyIdToken(idToken)
    if (!decoded) return res.status(401).json({ error: 'Sign-in token is invalid or expired.' })

    const db = getAdminDb()
    const staff = await assertStaff(db, decoded)
    if (!staff || staff.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create or attach staff logins.' })
    }

    const input = validateProvisionInput(req.body || {})
    const authUser = await ensureAuthUser(input)
    const profile = provisionProfileFields(input)
    await db.collection('users').doc(authUser.uid).set({
      ...profile,
      updatedAt: new Date(),
    }, { merge: true })

    return res.status(200).json({
      ok: true,
      uid: authUser.uid,
      email: input.email,
      role: input.role,
      attached: !authUser.created,
    })
  } catch (error) {
    const message = error.message || 'Could not provision that account.'
    const status = /required|valid email|8 characters|Role must/i.test(message) ? 400 : 500
    return res.status(status).json({ error: message })
  }
}
