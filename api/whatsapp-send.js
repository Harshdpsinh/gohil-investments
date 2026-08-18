// api/whatsapp-send.js
// Sends one WhatsApp message on behalf of a signed-in staff user: an approved
// template (the renewal reminder, and anything cold), or free text when the
// client's own 24-hour window is open.
//
// This endpoint exists because the browser must never hold WHATSAPP_TOKEN: it
// is a long-lived System User token that can message anyone, and the previous
// Evolution setup kept its credentials in localStorage where any XSS could read
// them. The token stays server-side; the browser only proves who it is.
import {
  getAdminDb, getWhatsAppConfig, recordOutboundMessage,
  sendWhatsAppFreeform, sendWhatsAppTemplate, verifyIdToken,
} from './_shared.js'

const ALLOWED_ROLES = new Set(['admin', 'staff'])

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    // Same rule as firestore.rules: being signed in is not enough, there must be
    // a provisioned users/{uid} document. The Firebase API key is public, so
    // auth alone would let anyone who self-registered message the client book.
    const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!idToken) return res.status(401).json({ error: 'Missing sign-in token.' })

    const decoded = await verifyIdToken(idToken)
    if (!decoded) return res.status(401).json({ error: 'Sign-in token is invalid or expired.' })

    const db = getAdminDb()
    const profile = (await db.collection('users').doc(decoded.uid).get()).data()
    if (!ALLOWED_ROLES.has(String(profile?.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'This account is not provisioned to send messages.' })
    }

    const { mobile, detail, text, linkUrl, caption } = req.body || {}
    if (!mobile) return res.status(400).json({ error: 'A recipient mobile number is required.' })

    const config = getWhatsAppConfig()
    // Free text only when the caller says the window is open; everything else
    // goes as the approved template, which is the only thing Meta accepts cold.
    const result = text || linkUrl
      ? await sendWhatsAppFreeform(config, mobile, { text, linkUrl, caption })
      : await sendWhatsAppTemplate(config, mobile, detail || {})

    if (result.ok) {
      await recordOutboundMessage(db, {
        messageId: result.messageId,
        waId: result.to,
        text: text || caption || `[${config.templateName}]`,
        type: linkUrl ? 'document' : 'text',
        sentBy: profile?.email || decoded.uid,
      })
    }

    // 200 either way: the caller records ok/error in the reminder log, and a
    // failed send is a business outcome, not a broken request.
    return res.status(200).json(result)
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'WhatsApp send failed.' })
  }
}
