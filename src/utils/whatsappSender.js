// src/utils/whatsappSender.js
// Evolution API client. Config is stored only in this browser.

const STORAGE_KEY = 'evolution_api_config'
const LEGACY_STORAGE_KEY = 'openwa_config'

export function getEvolutionConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveEvolutionConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    baseUrl: config.baseUrl || 'http://localhost:8080',
    instanceName: config.instanceName || config.sessionId || 'default',
    apiKey: config.apiKey || '',
  }))
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export function clearEvolutionConfig() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export function phoneToNumber(phone) {
  if (!phone || typeof phone !== 'string') return null
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 ? digits : null
}

export async function sendWhatsApp({ number, chatId, text }) {
  const config = getEvolutionConfig()
  if (!config?.baseUrl) {
    return { ok: false, error: 'Evolution API not configured. Open WhatsApp settings first.' }
  }
  if (!config.instanceName) {
    return { ok: false, error: 'No Evolution instance name configured.' }
  }

  const to = phoneToNumber(number || chatId)
  if (!to) return { ok: false, error: 'Invalid WhatsApp phone number.' }

  const url = `${config.baseUrl.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(config.instanceName)}`
  const headers = { 'Content-Type': 'application/json' }
  if (config.apiKey) headers.apikey = config.apiKey

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: to, text }),
    })

    const body = await res.text()
    const data = body ? safeJson(body) : null

    if (res.ok) {
      return { ok: true, messageId: data?.key?.id || data?.messageId || data?.id }
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Authentication failed (HTTP ${res.status}). Check the Evolution API key.` }
    }
    if (res.status === 400) {
      return { ok: false, error: 'Evolution rejected the message. Check the phone number and message text.' }
    }
    if (res.status === 404) {
      return { ok: false, error: `Evolution instance "${config.instanceName}" was not found.` }
    }
    return { ok: false, error: `Evolution API returned HTTP ${res.status}: ${body.slice(0, 200)}` }
  } catch (err) {
    return { ok: false, error: `Cannot reach Evolution API at ${config.baseUrl}. Is it running? (${err.message})` }
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const getOpenWAConfig = getEvolutionConfig
export const saveOpenWAConfig = saveEvolutionConfig
export const clearOpenWAConfig = clearEvolutionConfig
export const phoneToChatId = phoneToNumber
