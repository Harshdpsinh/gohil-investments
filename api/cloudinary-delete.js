import { getAdminDb, verifyIdToken, assertStaff } from './_shared.js'
import crypto from 'node:crypto'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!idToken) {
    res.status(401).json({ error: 'Missing sign-in token.' })
    return
  }
  const decoded = await verifyIdToken(idToken)
  if (!decoded) {
    res.status(401).json({ error: 'Sign-in token is invalid or expired.' })
    return
  }
  const staff = await assertStaff(getAdminDb(), decoded)
  if (!staff) {
    res.status(403).json({ error: 'This account is not provisioned to delete files.' })
    return
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    res.status(500).json({ error: 'Cloudinary delete API is not configured.' })
    return
  }

  const parsedBody = typeof req.body === 'string'
    ? JSON.parse(req.body || '{}')
    : (req.body || {})
  const { publicId, resourceType = 'image' } = parsedBody
  if (!publicId) {
    res.status(400).json({ error: 'publicId is required.' })
    return
  }

  const safeResourceType = ['image', 'raw', 'video'].includes(resourceType) ? resourceType : 'image'
  const timestamp = Math.floor(Date.now() / 1000)
  const toSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`
  const signature = crypto.createHash('sha1').update(toSign).digest('hex')

  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature,
    invalidate: 'true',
  })

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${safeResourceType}/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok || (data.result && !['ok', 'not found'].includes(data.result))) {
    res.status(response.ok ? 400 : response.status).json({ error: data.error?.message || data.result || 'Cloudinary delete failed.' })
    return
  }

  res.status(200).json({ ok: true, result: data.result || 'ok' })
}
