import { assertStaff, getAdminDb, verifyIdToken } from './_shared.js'
import { formatAllowed, signCloudinaryParams, signedDeliveryUrl } from '../src/utils/cloudinaryAccess.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!idToken) return res.status(401).json({ error: 'Missing sign-in token.' })
  const decoded = await verifyIdToken(idToken)
  if (!decoded) return res.status(401).json({ error: 'Sign-in token is invalid or expired.' })
  const staff = await assertStaff(getAdminDb(), decoded)
  if (!staff) return res.status(403).json({ error: 'This account is not provisioned to upload files.' })

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary upload is not configured.' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const publicId = String(body.publicId || '')
  const resourceType = ['image', 'raw', 'video'].includes(body.resourceType) ? body.resourceType : 'image'
  if (!publicId.startsWith('gohil_investments/') || publicId.includes('..')) {
    return res.status(400).json({ error: 'That file is outside the office folder.' })
  }

  let format = String(body.format || '').toLowerCase()
  try {
    const lookup = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/resources/${resourceType}/authenticated/${publicId}`,
      { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}` } },
    )
    if (lookup.ok) {
      const info = await lookup.json()
      format = String(info.format || format).toLowerCase()
    }
  } catch { /* delivery still requires the signature; a lookup miss must not hide a bad format we already have */ }

  if (!formatAllowed(format)) {
    const timestamp = Math.floor(Date.now() / 1000)
    const params = { public_id: publicId, timestamp, type: 'authenticated' }
    await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        public_id: publicId,
        timestamp: String(timestamp),
        type: 'authenticated',
        api_key: apiKey,
        signature: signCloudinaryParams(params, apiSecret),
      }),
    }).catch(() => {})
    return res.status(400).json({ error: 'This file type is not allowed.' })
  }

  const url = signedDeliveryUrl({
    cloudName,
    publicId,
    resourceType,
    format,
    version: body.version,
    apiSecret,
  })
  if (!url) return res.status(400).json({ error: 'Could not build a private link for that file.' })
  return res.status(200).json({ ok: true, url, format, delivery: 'authenticated' })
}
