// api/bhash-webhook.js
// Bhash posts customer replies here. Bhash does not sign the body, so the
// URL itself carries BHASH_WEBHOOK_SECRET (?secret=... or the
// x-bhash-webhook-secret header). Without it, nothing is stored.
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from './_shared.js'
import { parseBhashWebhook } from '../src/utils/bhashWebhook.js'
import { providedWebhookSecret, webhookAuthorized } from '../src/utils/webhookAuth.js'

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })

  const allowed = webhookAuthorized(
    providedWebhookSecret(req.query?.secret, req.headers['x-bhash-webhook-secret']),
    process.env.BHASH_WEBHOOK_SECRET,
  )
  if (!allowed) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method === 'GET') return res.status(200).json({ ok: true })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const { messages, statuses } = parseBhashWebhook(body)
    const db = getAdminDb()
    const batch = db.batch()

    for (const message of messages) {
      const id = message.messageId || db.collection('whatsapp_messages').doc().id
      batch.set(db.collection('whatsapp_messages').doc(id), {
        ...message,
        messageId: id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    for (const status of statuses) {
      if (!status.messageId) continue
      batch.set(db.collection('whatsapp_messages').doc(status.messageId), {
        status: status.status,
        statusAt: status.timestamp,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    if (messages.length || statuses.length) await batch.commit()
    return res.status(200).json({ received: messages.length, statuses: statuses.length })
  } catch (error) {
    console.error('Bhash webhook failed:', error)
    return res.status(200).json({ received: 0, error: error.message || 'Webhook failed' })
  }
}
