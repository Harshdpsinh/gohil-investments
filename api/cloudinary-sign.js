import { assertStaff, getAdminDb, verifyIdToken } from './_shared.js'
import { planUpload, signCloudinaryParams } from '../src/utils/cloudinaryAccess.js'
import { takeToken } from '../src/utils/rateLimit.js'

const hits = new Map()

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!idToken) return res.status(401).json({ error: 'Missing sign-in token.' })
  const decoded = await verifyIdToken(idToken)
  if (!decoded) return res.status(401).json({ error: 'Sign-in token is invalid or expired.' })
  const staff = await assertStaff(getAdminDb(), decoded)
  if (!staff) return res.status(403).json({ error: 'This account is not provisioned to upload files.' })

  const limit = takeToken(hits, staff.uid, { limit: 40, windowMs: 10 * 60 * 1000 })
  if (!limit.ok) return res.status(429).json({ error: 'Too many uploads. Wait a few minutes and try again.' })

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary upload is not configured.' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const plan = planUpload(body)
  if (plan.error) return res.status(400).json({ error: plan.error })

  const timestamp = Math.floor(Date.now() / 1000)
  const params = { public_id: plan.publicId, timestamp, type: 'authenticated' }
  return res.status(200).json({
    cloudName,
    apiKey,
    timestamp,
    publicId: plan.publicId,
    type: 'authenticated',
    signature: signCloudinaryParams(params, apiSecret),
  })
}
