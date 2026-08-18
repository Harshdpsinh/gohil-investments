// api/whatsapp-webhook.js
// Where Meta delivers everything a client sends, plus delivery and read
// receipts for what we sent them.
//
// This URL is public — Meta has to be able to reach it — so every POST is
// checked against the app secret before a byte of it is trusted. Without that,
// anyone who learns the URL could write messages into the inbox.
import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from './_shared.js'
import { parseWebhookPayload } from '../src/utils/whatsappInbox.js'

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  // ── Verification handshake, once, when the webhook is first saved ──
  if (req.method === 'GET') {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
    if (!verifyToken) return res.status(503).send('WHATSAPP_VERIFY_TOKEN is not configured.')
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query
    if (mode === 'subscribe' && token === verifyToken) return res.status(200).send(challenge)
    return res.status(403).send('Verification failed.')
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // The signature covers the raw bytes, so the body must be read unparsed —
    // re-serialising JSON reorders keys and the digest stops matching.
    const raw = await readRawBody(req)
    if (!verifySignature(raw, req.headers['x-hub-signature-256'])) {
      return res.status(401).send('Bad signature')
    }

    let body = {}
    try { body = JSON.parse(raw.toString('utf8') || '{}') } catch { /* Meta sent nothing usable */ }
    const { messages, statuses } = parseWebhookPayload(body)

    const db = getAdminDb()
    const batch = db.batch()

    for (const message of messages) {
      // Meta retries a delivery it thinks failed, so the message id is the doc
      // id — a retry overwrites rather than duplicating the conversation.
      batch.set(db.collection('whatsapp_messages').doc(message.messageId || db.collection('whatsapp_messages').doc().id), {
        ...message,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }

    for (const status of statuses) {
      if (!status.messageId) continue
      // Only ever upgrade what we know about an outbound message; a receipt
      // must never create a phantom conversation of its own.
      batch.set(db.collection('whatsapp_messages').doc(status.messageId), {
        status: status.status,
        statusAt: status.timestamp,
        error: status.error || '',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }

    await batch.commit()
    // 200 quickly, always. Meta retries anything else, and a retry storm on a
    // real error would duplicate nothing but would bury the logs.
    return res.status(200).json({ received: messages.length, statuses: statuses.length })
  } catch (error) {
    console.error('WhatsApp webhook failed:', error)
    return res.status(200).json({ error: error.message || 'Webhook failed' })
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Meta signs the raw body with the app secret. timingSafeEqual is used rather
 * than === so the comparison cannot be probed a byte at a time.
 */
function verifySignature(raw, header) {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) throw new Error('WHATSAPP_APP_SECRET is not configured. Refusing to accept webhooks.')
  const provided = String(header || '')
  if (!provided.startsWith('sha256=')) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
