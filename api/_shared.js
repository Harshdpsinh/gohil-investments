// api/_shared.js
// Server-only helpers for the two functions that talk to Firebase and Meta.
// The leading underscore keeps Vercel from routing this as an endpoint.
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
 * Returns { uid } or null. The API key is public by design (it ships in the
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
  const uid = body?.users?.[0]?.localId
  return uid ? { uid } : null
}

function ensureAdminApp() {
  if (getApps().length) return
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
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
