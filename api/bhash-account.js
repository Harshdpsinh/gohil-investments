// api/bhash-account.js
// Wallet balance, plus a refresh of recent send statuses. Staff only.
import { assertStaff, getAdminDb, getBhashAccount, refreshBhashDelivery, verifyIdToken } from './_shared.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!idToken) return res.status(401).json({ error: 'Missing sign-in token.' })
    const decoded = await verifyIdToken(idToken)
    if (!decoded) return res.status(401).json({ error: 'Sign-in token is invalid or expired.' })
    const db = getAdminDb()
    if (!await assertStaff(db, decoded)) {
      return res.status(403).json({ error: 'This account is not provisioned to view WhatsApp.' })
    }
    const account = await getBhashAccount()
    const checked = await refreshBhashDelivery(db).catch(() => 0)
    return res.status(200).json({ wallets: account.wallets, checked })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not read the Bhash account.' })
  }
}
