// src/utils/whatsappSender.js
// ─────────────────────────────────────────────────────────────
// OpenWA HTTP client — sends WhatsApp messages via the gateway.
// Config (baseUrl, sessionId, apiKey) is stored in localStorage
// under key "openwa_config" — NEVER in Firestore or .env.
//
// This module NEVER throws. Every function returns a result object:
//   { ok: boolean, messageId?: string, error?: string }
//
// OpenWA endpoint (confirmed from source):
//   POST {baseUrl}/api/sessions/{sessionId}/messages/send-text
//   Headers: Content-Type: application/json, X-API-Key: <key>
//   Body: { chatId: "91XXXXXXXXXX@c.us", text: "..." }
//   Success: 201  { messageId, timestamp }
//   Errors: 400 (session not active), 404 (session not found), 401/403 (auth)
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'openwa_config'

/** Read OpenWA config from localStorage. Returns null if not set. */
export function getOpenWAConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** Save OpenWA config to localStorage. */
export function saveOpenWAConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    baseUrl:  config.baseUrl  || 'http://localhost:2785',
    sessionId: config.sessionId || 'DEFAULT',
    apiKey:   config.apiKey || '',
  }))
}

/** Clear OpenWA config from localStorage. */
export function clearOpenWAConfig() {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * phoneToChatId(phone: string) → string | null
 * Converts E.164 "+91XXXXXXXXXX" to WhatsApp chatId "91XXXXXXXXXX@c.us".
 * Returns null if input is not a valid E.164 phone string.
 */
export function phoneToChatId(phone) {
  if (!phone || typeof phone !== 'string') return null
  const digits = phone.replace(/[^0-9]/g, '')
  if (digits.length < 10) return null
  return `${digits}@c.us`
}

/**
 * sendWhatsApp({ chatId, text })
 * Sends a text message via OpenWA. Uses config from localStorage.
 * Returns { ok, messageId?, error? }. Never throws.
 */
export async function sendWhatsApp({ chatId, text }) {
  const config = getOpenWAConfig()
  if (!config?.baseUrl) {
    return { ok: false, error: 'OpenWA not configured. Go to ⚙️ Settings to set it up.' }
  }
  if (!config.sessionId) {
    return { ok: false, error: 'No session ID configured.' }
  }

  const url = `${config.baseUrl.replace(/\/+$/, '')}/api/sessions/${encodeURIComponent(config.sessionId)}/messages/send-text`

  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chatId, text }),
    })

    if (res.ok) {
      const data = await res.json()
      return { ok: true, messageId: data?.messageId }
    }

    let errorBody = ''
    try { errorBody = await res.text() } catch { /* ignore */ }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Authentication failed (HTTP ${res.status}). Check API key.` }
    }
    if (res.status === 400) {
      return { ok: false, error: `Session not active or invalid request (HTTP 400). Make sure the WhatsApp session is started in OpenWA dashboard.` }
    }
    if (res.status === 404) {
      return { ok: false, error: `Session "${config.sessionId}" not found. Create it in OpenWA dashboard.` }
    }
    return { ok: false, error: `OpenWA returned HTTP ${res.status}: ${errorBody.slice(0, 200)}` }
  } catch (err) {
    return { ok: false, error: `Cannot reach OpenWA at ${config.baseUrl}. Is the service running? (${err.message})` }
  }
}
