// src/utils/whatsappInbox.js
// Turns a Meta webhook payload into rows we can store, and answers the one
// question that governs every reply: is this conversation still inside its
// 24-hour window?
//
// Pure — no firebase, no react, no network.
import { toE164 } from './whatsappCloud'

/**
 * Meta nests everything four levels deep and batches unrelated events into one
 * POST: a delivery receipt for yesterday's reminder can arrive in the same body
 * as a new inbound message. Both are pulled out separately.
 */
export function parseWebhookPayload(body = {}) {
  const messages = []
  const statuses = []

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {}
      // wa_id -> profile name, so a conversation can be titled before the
      // sender has ever been matched to a client.
      const names = new Map(
        (value.contacts || []).map(c => [c.wa_id, c.profile?.name || ''])
      )

      for (const message of value.messages || []) {
        messages.push({
          messageId: message.id || '',
          waId: toE164(message.from),
          profileName: names.get(message.from) || '',
          direction: 'in',
          type: message.type || 'unknown',
          text: textOf(message),
          mediaId: mediaOf(message)?.id || '',
          mimeType: mediaOf(message)?.mime_type || '',
          filename: mediaOf(message)?.filename || '',
          // Meta sends unix seconds as a string.
          timestamp: Number(message.timestamp) * 1000 || Date.now(),
        })
      }

      for (const status of value.statuses || []) {
        statuses.push({
          messageId: status.id || '',
          waId: toE164(status.recipient_id),
          status: status.status || '',
          timestamp: Number(status.timestamp) * 1000 || Date.now(),
          error: status.errors?.[0]?.title || '',
        })
      }
    }
  }

  return { messages, statuses }
}

const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker']
const mediaOf = message => MEDIA_TYPES.map(t => message[t]).find(Boolean) || null

/** Something readable for the conversation list, whatever the message was. */
function textOf(message) {
  if (message.text?.body) return message.text.body
  const media = mediaOf(message)
  if (media?.caption) return media.caption
  if (message.button?.text) return message.button.text
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title
  if (message.location) return 'Shared a location'
  if (media) return `Sent a ${message.type}`
  return ''
}

export const WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Free-form replies are only allowed for 24 hours after the client's LAST
 * inbound message. Outside it, Meta rejects anything but an approved template —
 * so the inbox has to show this, not discover it on send.
 */
export function windowState(lastInboundAt, now = Date.now()) {
  const last = Number(lastInboundAt) || 0
  if (!last) return { open: false, remainingMs: 0, expiresAt: null }
  const expiresAt = last + WINDOW_MS
  const remainingMs = expiresAt - now
  return { open: remainingMs > 0, remainingMs: Math.max(0, remainingMs), expiresAt }
}

/** "3h 12m left" / "Closed". Rounded down, so it never over-promises. */
export function formatWindow(remainingMs) {
  if (remainingMs <= 0) return 'Closed'
  const hours = Math.floor(remainingMs / 3600000)
  const minutes = Math.floor((remainingMs % 3600000) / 60000)
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`
}

/**
 * Groups stored messages into conversations, newest first, each carrying its
 * own window state and unread count.
 */
export function buildConversations(messages = [], now = Date.now()) {
  const byWaId = new Map()

  for (const message of messages) {
    const waId = message.waId
    if (!waId) continue
    const entry = byWaId.get(waId) || {
      waId, messages: [], lastInboundAt: 0, lastAt: 0, unread: 0, profileName: '',
    }
    entry.messages.push(message)
    entry.lastAt = Math.max(entry.lastAt, message.timestamp || 0)
    if (message.direction === 'in') {
      entry.lastInboundAt = Math.max(entry.lastInboundAt, message.timestamp || 0)
      if (!message.read) entry.unread += 1
      if (message.profileName) entry.profileName = message.profileName
    }
    byWaId.set(waId, entry)
  }

  return [...byWaId.values()]
    .map(entry => ({
      ...entry,
      messages: [...entry.messages].sort((a, b) => a.timestamp - b.timestamp),
      window: windowState(entry.lastInboundAt, now),
      preview: [...entry.messages].sort((a, b) => b.timestamp - a.timestamp)[0]?.text || '',
    }))
    .sort((a, b) => b.lastAt - a.lastAt)
}

/**
 * Ties a conversation to a client by phone number. The book stores ten digits
 * and WhatsApp reports full E.164, so both are reduced to the last ten.
 */
export function matchConversationClient(waId, clients = []) {
  const tail = String(waId || '').replace(/\D/g, '').slice(-10)
  if (tail.length !== 10) return null
  return clients.find(c => String(c.mobile || '').replace(/\D/g, '').slice(-10) === tail) || null
}
