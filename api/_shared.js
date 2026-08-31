// api/_shared.js
// Server-only helpers for the two functions that talk to Firebase and Meta.
// The leading underscore keeps Vercel from routing this as an endpoint.
import crypto from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  DEFAULT_API_VERSION,
  buildTemplatePayload,
  describeGraphError,
  graphMessagesUrl,
  messageIdFrom,
  parseTemplateOrder,
  templateParameters,
  toE164,
} from '../src/utils/whatsappCloud.js'

export function getAdminDb() {
  ensureAdminApp()
  return getFirestore()
}

/**
 * Verifies a Firebase ID token through Google's identity toolkit REST endpoint,
 * deliberately NOT through firebase-admin/auth: that subpath pulls in jwks-rsa,
 * which require()s the ESM-only `jose` and kills the whole function at load with
 * ERR_REQUIRE_ESM — taking the renewal cron down with it. One HTTP round trip,
 * no dependency, and the API key is project-scoped so a token minted for
 * another Firebase project is rejected too.
 *
 * Returns { uid, email } or null. The API key is public by design (it ships in the
 * client bundle) — it identifies the project, it does not authorise anything.
 */
export async function verifyIdToken(idToken) {
  const apiKey = process.env.VITE_FIREBASE_API_KEY
  if (!apiKey) throw new Error('VITE_FIREBASE_API_KEY is not configured.')
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  )
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  const account = body?.users?.[0]
  const uid = account?.localId
  return uid ? { uid, email: account.email || '' } : null
}

const OWNER_ADMIN_EMAILS = new Set([
  'harshdeepgohil@gmail.com',
  'harshdpsinh@gmail.com',
])

/** Same bar as firestore.rules: owner email or a provisioned users/{uid} role. */
export async function assertStaff(db, decoded) {
  const email = String(decoded?.email || '').trim().toLowerCase()
  if (email && OWNER_ADMIN_EMAILS.has(email)) {
    return { uid: decoded.uid, email, role: 'admin' }
  }
  const profile = (await db.collection('users').doc(decoded.uid).get()).data()
  const role = String(profile?.role || '').toLowerCase()
  if (role !== 'admin' && role !== 'staff') return null
  return { uid: decoded.uid, email: profile?.email || email, role }
}

/**
 * The 24-hour window is opened only by the client's last inbound message.
 * Our own replies do not extend it. Looked up server-side so the browser
 * cannot claim the window is open.
 */
export async function inboundWindowOpen(db, waId, now = Date.now()) {
  if (!waId) return false
  const snap = await db.collection('whatsapp_messages')
    .where('waId', '==', waId)
    .limit(50)
    .get()
  let lastInbound = 0
  snap.forEach(doc => {
    const row = doc.data() || {}
    if (row.direction === 'in') lastInbound = Math.max(lastInbound, Number(row.timestamp) || 0)
  })
  return lastInbound > 0 && (now - lastInbound) < (24 * 60 * 60 * 1000)
}

function ensureAdminApp() {
  if (getApps().length) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.')
  const serviceAccount = JSON.parse(raw)
  if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n')
  initializeApp({ credential: cert(serviceAccount) })
}

/**
 * WHATSAPP_TOKEN must be a System User token from Meta Business Manager, not a
 * temporary one from the app dashboard — those expire after 24 hours and every
 * send starts failing with code 190 the next day.
 */
export function getWhatsAppConfig() {
  const token = process.env.WHATSAPP_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneNumberId) {
    throw new Error('WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are not configured.')
  }
  return {
    token,
    phoneNumberId,
    apiVersion: process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION,
    templateName: process.env.WHATSAPP_TEMPLATE_NAME || 'renewal_reminder',
    languageCode: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
    templateOrder: parseTemplateOrder(process.env.WHATSAPP_TEMPLATE_PARAMS),
    countryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '91',
  }
}

/**
 * Sends the approved template. `detail` supplies the body variables; the
 * composed reminder text is never sent, because Meta only accepts free text
 * inside a 24-hour window opened by the client's own reply.
 * Never throws — the caller writes the outcome into a reminder log either way.
 */
export async function sendWhatsAppTemplate(config, mobile, detail) {
  const to = toE164(mobile, config.countryCode)
  if (!to) return { ok: false, to: '', error: 'No usable WhatsApp number for this client.' }

  const payload = buildTemplatePayload({
    to,
    templateName: config.templateName,
    languageCode: config.languageCode,
    parameters: templateParameters(detail, config.templateOrder),
  })

  try {
    const response = await fetch(graphMessagesUrl(config), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { /* Meta returned non-JSON */ }
    if (!response.ok) return { ok: false, to, error: describeGraphError(response.status, body) }
    return { ok: true, to, messageId: messageIdFrom(body) }
  } catch (error) {
    return { ok: false, to, error: `Could not reach the WhatsApp Cloud API: ${error.message}` }
  }
}

/**
 * Free text or media, allowed ONLY inside the 24-hour window opened by the
 * client's own last message. Meta rejects it outside that window, which is why
 * the inbox shows the countdown rather than discovering it on send.
 */
export async function sendWhatsAppFreeform(config, mobile, { text = '', linkUrl = '', caption = '' } = {}) {
  const to = toE164(mobile, config.countryCode)
  if (!to) return { ok: false, to: '', error: 'No usable WhatsApp number.' }

  const payload = linkUrl
    ? { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'document', document: { link: linkUrl, caption: caption || text } }
    : { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body: text } }

  try {
    const response = await fetch(graphMessagesUrl(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify(payload),
    })
    const raw = await response.text()
    let body = null
    try { body = raw ? JSON.parse(raw) : null } catch { /* non-JSON */ }
    if (!response.ok) return { ok: false, to, error: describeGraphError(response.status, body) }
    return { ok: true, to, messageId: messageIdFrom(body) }
  } catch (error) {
    return { ok: false, to, error: `Could not reach the WhatsApp Cloud API: ${error.message}` }
  }
}

/**
 * Mirrors an outbound message into the inbox so a reply and the reminder that
 * prompted it sit in one thread. Never throws — failing to log must not undo a
 * message that has already left.
 */
export async function recordOutboundMessage(db, { messageId, waId, text, type = 'text', sentBy = '' }) {
  if (!waId) return
  try {
    const ref = messageId
      ? db.collection('whatsapp_messages').doc(messageId)
      : db.collection('whatsapp_messages').doc()
    await ref.set({
      messageId: messageId || ref.id,
      waId, direction: 'out', type, text,
      timestamp: Date.now(),
      status: 'sent', read: true, sentBy,
    }, { merge: true })
  } catch (error) {
    console.error('Could not record outbound WhatsApp message:', error.message)
  }
}

/**
 * Tells WhatsApp the client's message was read, so they see the blue ticks.
 * Free, and it is the difference between "they are ignoring me" and "seen".
 * Never throws — a failed receipt must not fail anything else.
 */
export async function markWhatsAppRead(config, messageId) {
  if (!messageId) return { ok: false }
  try {
    const response = await fetch(graphMessagesUrl(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
    })
    return { ok: response.ok }
  } catch {
    return { ok: false }
  }
}

/**
 * Pulls an inbound file down from Meta. Two hops: the media id resolves to a
 * short-lived URL, and that URL still needs the bearer token — fetching it
 * unauthenticated returns 401, which is the usual reason this silently fails.
 * Media is deleted by Meta after a few days, so it has to be captured now.
 */
export async function fetchWhatsAppMedia(config, mediaId) {
  const base = `https://graph.facebook.com/${config.apiVersion}`
  const auth = { Authorization: `Bearer ${config.token}` }

  const lookup = await fetch(`${base}/${encodeURIComponent(mediaId)}`, { headers: auth })
  if (!lookup.ok) throw new Error(`Media lookup failed (HTTP ${lookup.status})`)
  const { url, mime_type: mimeType } = await lookup.json()
  if (!url) throw new Error('Media lookup returned no URL')

  const file = await fetch(url, { headers: auth })
  if (!file.ok) throw new Error(`Media download failed (HTTP ${file.status})`)
  return { buffer: Buffer.from(await file.arrayBuffer()), mimeType }
}

// Cloudinary splits uploads by resource type, and a PDF sent as "image" is
// rejected. Documents go to raw; audio rides the video pipeline.
function cloudinaryResourceType(mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'video'
  return 'raw'
}

/**
 * Signed server-side upload. The browser preset is unsigned and deliberately
 * limited; the webhook has the real key pair, so it signs properly.
 */
export async function uploadMediaToCloudinary({ buffer, mimeType, filename, folder = 'whatsapp' }) {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME
  const key = process.env.CLOUDINARY_API_KEY
  const secret = process.env.CLOUDINARY_API_SECRET
  if (!cloud || !key || !secret) throw new Error('Cloudinary server credentials are not configured.')

  const timestamp = Math.floor(Date.now() / 1000)
  const params = { folder, public_id: filename.replace(/\.[^.]+$/, ''), timestamp }
  // Cloudinary signs the parameters sorted by key, joined with &, then the secret.
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  const signature = crypto.createHash('sha1').update(toSign + secret).digest('hex')

  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename)
  Object.entries(params).forEach(([k, v]) => form.append(k, String(v)))
  form.append('api_key', key)
  form.append('signature', signature)

  const resourceType = cloudinaryResourceType(mimeType)
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`, {
    method: 'POST', body: form,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message || `Cloudinary upload failed (HTTP ${response.status})`)
  return { url: body.secure_url, publicId: body.public_id, resourceType, bytes: body.bytes }
}
