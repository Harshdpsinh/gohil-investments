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
 * Two modes, and the caller picks by what it passes.
 *
 * `text` or `linkUrl` sends free-form, which Meta only accepts inside the
 * 24-hour window opened by the client's own last message — the inbox checks
 * that before offering a composer.
 *
 * `detail` sends the approved template instead, filling its variables. That is
 * the only thing Meta will deliver to a conversation the business starts.
 */
export async function sendWhatsApp({ number, chatId, detail = {}, text = '', linkUrl = '', caption = '' }) {
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
      body: JSON.stringify({ mobile: to, detail, text, linkUrl, caption }),
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
