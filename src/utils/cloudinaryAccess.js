import crypto from 'node:crypto'

const MAX_BYTES = 25 * 1024 * 1024

const ALLOWED = [
  { contentType: 'application/pdf', extensions: ['pdf'], format: 'pdf' },
  { contentType: 'image/jpeg', extensions: ['jpg', 'jpeg'], format: 'jpg' },
  { contentType: 'image/png', extensions: ['png'], format: 'png' },
  { contentType: 'image/webp', extensions: ['webp'], format: 'webp' },
  { contentType: 'text/csv', extensions: ['csv'], format: 'csv' },
  { contentType: 'application/vnd.ms-excel', extensions: ['xls'], format: 'xls' },
  { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['xlsx'], format: 'xlsx' },
]

const ALLOWED_FORMATS = new Set(ALLOWED.map(rule => rule.format))

export function planUpload({ folder, filename, contentType, bytes, now = Date.now() } = {}) {
  const cleanFolder = String(folder || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '')
  if (!cleanFolder.startsWith('gohil_investments/') || cleanFolder.split('/').includes('..')) {
    return { error: 'Upload folder is not allowed.' }
  }
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return { error: 'File must be between 1 byte and 25 MB.' }
  }
  const ext = String(filename || '').toLowerCase().split('.').pop()
  const rule = ALLOWED.find(item => item.contentType === contentType && item.extensions.includes(ext))
  if (!rule) return { error: 'Only PDF, JPG, PNG, WEBP, CSV, or Excel files are allowed.' }
  const base = String(filename || '').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 60) || 'file'
  return { publicId: `${cleanFolder}/${now}_${base}`, format: rule.format }
}

export function signCloudinaryParams(params, apiSecret) {
  const serialized = Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&')
  return crypto.createHash('sha1').update(serialized + apiSecret).digest('hex')
}

export function formatAllowed(format) {
  return ALLOWED_FORMATS.has(String(format || '').toLowerCase())
}

/**
 * Authenticated delivery. The signature covers the public id and extension,
 * not the version. SHA-1 matches this Cloudinary account's API signatures.
 */
export function signedDeliveryUrl({ cloudName, publicId, resourceType = 'image', format, version, apiSecret } = {}) {
  const id = String(publicId || '').replace(/^\/+|\/+$/g, '')
  if (!cloudName || !id || !apiSecret || !id.startsWith('gohil_investments/')) return ''
  const ext = String(format || '').toLowerCase()
  const source = ext && !id.endsWith(`.${ext}`) ? `${id}.${ext}` : id
  const digest = crypto.createHash('sha1').update(source + apiSecret).digest('base64')
    .slice(0, 8)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const versionPart = version ? `v${String(version).replace(/^v/, '')}/` : ''
  const kind = ['image', 'raw', 'video'].includes(resourceType) ? resourceType : 'image'
  return `https://res.cloudinary.com/${cloudName}/${kind}/authenticated/s--${digest}--/${versionPart}${source}`
}
