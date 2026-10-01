// Turns a Bhash customer-webhook body into the same inbox rows the Meta
// webhook stores. Bhash does not publish one payload, so this accepts the
// Meta shape (many providers forward it) and the flat shapes used by Indian
// BSPs. Delivery receipts must not open the 24-hour window.
import { parseWebhookPayload } from './whatsappInbox.js'
import { toE164 } from './whatsappCloud.js'

const FROM_KEYS = ['from', 'sender', 'customerNumber', 'customerMobile', 'mobile', 'waId', 'phone', 'recipient']
const TEXT_KEYS = ['body', 'text', 'message', 'content', 'caption']
const NAME_KEYS = ['profileName', 'customerName', 'name', 'senderName']
const ID_KEYS = ['messageId', 'wamid', 'id', 'requestCode']

function asText(value) {
  if (typeof value === 'string') return value.trim()
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
  const kind = String(event.webhook_type || event.event || event.status || event.type || '').toLowerCase()
  return /status|delivered|read|sent|failed/.test(kind)
}

function eventsOf(body) {
  if (Array.isArray(body)) return body
  if (Array.isArray(body?.data)) return body.data
  if (Array.isArray(body?.messages)) return [body]
  return [body?.data || body?.content || body]
}

export function parseBhashWebhook(body = {}) {
  if (body?.entry || body?.object === 'whatsapp_business_account') {
    return parseWebhookPayload(body)
  }

  const messages = []
  const statuses = []
  for (const event of eventsOf(body)) {
    if (!event || typeof event !== 'object') continue
    const nested = event.message && typeof event.message === 'object' ? event.message : event
    const text = firstText(nested, TEXT_KEYS) || firstText(event, TEXT_KEYS)
    const from = firstText(event, FROM_KEYS) || firstText(nested, FROM_KEYS)
    const waId = toE164(from)
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
      messageId: messageId || `bhash-${waId}-${toMillis(event.timestamp)}`,
      waId,
      profileName: firstText(event, NAME_KEYS),
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
