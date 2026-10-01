// api/bhash-webhook.js
// Bhash posts customer replies here. Unlike the Meta webhook, Bhash does not
// sign the body, so this route only stores a message it can tie to a phone.
import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb } from './_shared.js'
import { parseBhashWebhook } from '../src/utils/bhashWebhook.js'

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true })
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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
