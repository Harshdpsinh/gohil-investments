// src/utils/whatsappSender.js
// Thin browser client for the official WhatsApp Cloud API. It deliberately does
// no sending of its own: it posts to /api/whatsapp-send, which holds the Meta
// token. The Evolution API client this replaced kept a base URL and API key in
// localStorage — any XSS could read them, and there is no version of that which
// is safe with a token that can message the whole client book.
import { auth } from '../firebase/config'
import { toE164 } from './whatsappCloud'

export const phoneToNumber = toE164

/**
 * `detail` fills the approved template's variables. `text` is the composed
 * human-readable reminder, kept for the log only — Meta will not send free text
 * for a conversation the business starts.
 */
export async function sendWhatsApp({ number, chatId, detail = {} }) {
  const to = toE164(number || chatId)
  if (!to) return { ok: false, error: 'Invalid WhatsApp phone number.' }

  const user = auth.currentUser
  if (!user) return { ok: false, error: 'Sign in again to send WhatsApp messages.' }

  try {
    const response = await fetch('/api/whatsapp-send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ mobile: to, detail }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      return { ok: false, error: body?.error || `WhatsApp send failed (HTTP ${response.status}).` }
    }
    return body || { ok: false, error: 'WhatsApp send returned an empty response.' }
  } catch (error) {
    return { ok: false, error: `Could not reach the WhatsApp sender: ${error.message}` }
  }
}
