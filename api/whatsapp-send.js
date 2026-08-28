// api/whatsapp-send.js
import {
  getAdminDb, getWhatsAppConfig, recordOutboundMessage,
  sendWhatsAppFreeform, sendWhatsAppTemplate, verifyIdToken,
  assertStaff, inboundWindowOpen,
} from './_shared.js'
import { toE164 } from '../src/utils/whatsappCloud.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!idToken) return res.status(401).json({ error: 'Missing sign-in token.' })

    const decoded = await verifyIdToken(idToken)
    if (!decoded) return res.status(401).json({ error: 'Sign-in token is invalid or expired.' })

    const db = getAdminDb()
    const staff = await assertStaff(db, decoded)
    if (!staff) {
      return res.status(403).json({ error: 'This account is not provisioned to send messages.' })
    }

    const { mobile, detail, text, linkUrl, caption } = req.body || {}
    if (!mobile) return res.status(400).json({ error: 'A recipient mobile number is required.' })

    const config = getWhatsAppConfig()
    const wantsFreeform = Boolean(text || linkUrl)
    if (wantsFreeform) {
      const waId = toE164(mobile, config.countryCode)
      const open = await inboundWindowOpen(db, waId)
      if (!open) {
        return res.status(200).json({
          ok: false,
          error: 'The 24-hour WhatsApp window is closed. Send an approved template instead.',
        })
      }
    }

    const result = wantsFreeform
      ? await sendWhatsAppFreeform(config, mobile, { text, linkUrl, caption })
      : await sendWhatsAppTemplate(config, mobile, detail || {})

    if (result.ok) {
      await recordOutboundMessage(db, {
        messageId: result.messageId,
        waId: result.to,
        text: text || caption || `[${config.templateName}]`,
        type: linkUrl ? 'document' : 'text',
        sentBy: staff.email || decoded.uid,
      })
    }

    return res.status(200).json(result)
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || 'WhatsApp send failed.' })
  }
}
