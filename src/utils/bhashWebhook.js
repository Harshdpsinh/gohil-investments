// Turns a Bhash customer-webhook body into the same inbox rows the Meta
// webhook stores. Bhash does not publish one payload, so a structured read is
// followed by a walk of the whole JSON. The office number is never treated as
// the customer. Delivery receipts must not open the 24-hour window.
import { parseWebhookPayload } from './whatsappInbox.js'
import { toE164 } from './whatsappCloud.js'

const OFFICE_NUMBERS = new Set(['917600928585', '7600928585'])
const FROM_KEYS = ['from', 'sender', 'customerNumber', 'customerMobile', 'mobile', 'waId', 'phone', 'recipient', 'msisdn']
const TEXT_KEYS = ['body', 'text', 'message', 'content', 'caption', 'messageText', 'msg', 'url', 'link']
const NAME_KEYS = ['profileName', 'customerName', 'senderName', 'name']
const ID_KEYS = ['messageId', 'wamid', 'umid', 'id', 'requestCode']

function asText(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && typeof value.body === 'string') return value.body.trim()
  return ''
}

function firstText(source, keys) {
  if (!source || typeof source !== 'object') return ''
  for (const key of keys) {
    const text = asText(source[key])
    if (text) return text
  }
  return ''
}

function toMillis(value) {
  const raw = Number(value)
  if (!raw) {
    const parsed = Date.parse(String(value || ''))
    return Number.isFinite(parsed) ? parsed : Date.now()
  }
  return raw < 1e12 ? raw * 1000 : raw
}

function isReceipt(event, text) {
  if (text) return false
  const kind = String(event.webhook_type || event.event || event.eventType || event.status || event.type || '').toLowerCase()
  return /status|delivered|read|sent|failed/.test(kind)
}

function eventsOf(body) {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.data)) return body.data
  const nested = body?.payload || body?.data || body?.content
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return [nested, body]
  if (Array.isArray(body?.messages)) return [body]
  return [body]
}

function phoneOf(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '')
  if (OFFICE_NUMBERS.has(digits) || OFFICE_NUMBERS.has(digits.slice(-10))) return ''
  return toE164(digits)
}

function structured(body) {
  const messages = []
  const statuses = []
  for (const event of eventsOf(body)) {
    if (!event || typeof event !== 'object') continue
    const nested = event.message && typeof event.message === 'object' ? event.message : event
    const user = event.user && typeof event.user === 'object' ? event.user : event.contact
    const text = firstText(nested, TEXT_KEYS) || firstText(event, TEXT_KEYS) || firstText(event.content, TEXT_KEYS)
    const from = firstText(user, FROM_KEYS) || firstText(event, FROM_KEYS) || firstText(nested, FROM_KEYS)
    const waId = phoneOf(from)
    const messageId = firstText(event, ID_KEYS) || firstText(nested, ID_KEYS)
    if (isReceipt(event, text)) {
      if (messageId) {
        statuses.push({
          messageId,
          waId,
          status: String(event.status || 'delivered'),
          timestamp: toMillis(event.timestamp || event.time),
          error: '',
        })
      }
      continue
    }
    const outbound = event.fromMe === true || /out/.test(String(event.direction || '').toLowerCase())
    if (!waId || outbound) continue
    messages.push({
      messageId,
      waId,
      profileName: firstText(user, NAME_KEYS) || firstText(event, NAME_KEYS),
      direction: 'in',
      type: String(event.message_type || event.type || 'text'),
      text: text || 'Sent a message',
      mediaId: '',
      mimeType: '',
      filename: '',
      timestamp: toMillis(event.timestamp || event.createdOn || event.time),
    })
  }
  return { messages, statuses }
}

function walk(node, acc, key = '', depth = 0) {
  if (node == null || depth > 8) return
  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node).trim()
    const phone = phoneOf(text)
    if (phone && /from|sender|customer|mobile|phone|wa|msisdn/i.test(key)) acc.phones.push(phone)
    else if (phone && key) acc.phones.push(phone)
    const looksLikeCopy = text.length >= 2 && text.length < 2000
      && !/^template\d+$/i.test(text)
      && !phone
      && (/[a-zA-Z]/.test(text) || /^https?:/i.test(text))
    if (!looksLikeCopy) return
    const weight = /text|body|caption|content|message|url|link/i.test(key) && !/id|type|name/i.test(key) ? 2 : 0
    if (/name|status|event|type/i.test(key) && !/url|link/i.test(key)) return
    acc.texts.push({ text, weight })
    return
  }
  if (Array.isArray(node)) {
    node.forEach(item => walk(item, acc, key, depth + 1))
    return
  }
  if (typeof node === 'object') {
    Object.entries(node).forEach(([childKey, value]) => walk(value, acc, childKey, depth + 1))
  }
}

function fromWalk(body) {
  const acc = { phones: [], texts: [] }
  walk(body, acc)
  const waId = acc.phones[0] || ''
  if (!waId) return []
  const ranked = acc.texts.sort((a, b) => b.weight - a.weight || b.text.length - a.text.length)
  return [{
    messageId: '',
    waId,
    profileName: '',
    direction: 'in',
    type: 'text',
    text: ranked[0]?.text || 'Sent a message',
    mediaId: '',
    mimeType: '',
    filename: '',
    timestamp: Date.now(),
  }]
}

export function parseBhashWebhook(body = {}) {
  if (body?.entry || body?.object === 'whatsapp_business_account') {
    return parseWebhookPayload(body)
  }
  const parsed = structured(body)
  if (parsed.messages.length || parsed.statuses.length) return parsed
  return { messages: fromWalk(body), statuses: [] }
}
