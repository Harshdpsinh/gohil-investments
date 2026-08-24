// src/utils/whatsappFeatures.js
// The parts of a full messaging gateway that are actually worth having for a
// two-person brokerage, rebuilt to run on the official Cloud API rather than
// alongside an unofficial one: canned replies, an out-of-hours auto-response,
// and sane names for the files clients send in.
//
// Pure — no firebase, no react, no network.

/**
 * Canned answers to the questions a broker fields every week. Tokens are the
 * same ones the renewal reminder uses, so one context object fills either.
 */
export const QUICK_REPLIES = [
  { id: 'policy-sent',   label: 'Policy sent',      text: 'Namaste {clientName}, your {policyType} policy document is attached above. Please save it for your records.' },
  { id: 'renewal-due',   label: 'Renewal due',      text: 'Your {policyType} policy {policyNumber} is due for renewal on {dueDate}. Premium is {premium}. Shall I proceed with the renewal?' },
  { id: 'payment-got',   label: 'Payment received', text: 'Thank you {clientName}, we have received your premium. Your policy is active and the receipt will follow shortly.' },
  { id: 'docs-needed',   label: 'Documents needed', text: 'To process this I need a photo of your Aadhaar, PAN, and the previous policy document. You can send them here.' },
  { id: 'claim-help',    label: 'Claim help',       text: 'I will help you with this claim. Please send the hospital bills, discharge summary and your policy number, and I will start the process.' },
  { id: 'call-back',     label: 'Will call back',   text: 'I will call you shortly, {clientName}. If it is urgent, please call 7698997894.' },
]

const TOKEN = /\{(\w+)\}/g

/**
 * Substitutes {clientName}, {policyNumber}, {dueDate} and friends. An unknown
 * or empty token collapses to nothing rather than printing the placeholder —
 * sending a client a literal "{premium}" is worse than a slightly terse line.
 */
export function fillReply(text, context = {}) {
  return String(text ?? '')
    .replace(TOKEN, (_match, key) => {
      const value = context[key]
      return value === undefined || value === null ? '' : String(value)
    })
    // Collapse the double spaces and orphaned punctuation a removed token leaves.
    .replace(/ {2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim()
}

/** The quick replies, ready to send, for one conversation's context. */
export function quickRepliesFor(context = {}, replies = QUICK_REPLIES) {
  return replies.map(reply => ({ ...reply, filled: fillReply(reply.text, context) }))
}

export const DEFAULT_AUTO_REPLY = {
  enabled: false,
  // Bhavnagar office hours; Sunday closed.
  startHour: 10,
  endHour: 19,
  days: [1, 2, 3, 4, 5, 6],
  cooldownHours: 12,
  message: 'Thank you for messaging Gohil Investments. Our office is closed right now — we will reply as soon as we open. For anything urgent, please call 7698997894.',
}

/** Local hour and weekday, honouring the office timezone rather than UTC. */
function localParts(at, timeZone = 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(new Date(at))
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    .indexOf(parts.find(p => p.type === 'weekday')?.value ?? '')
  return { hour, weekday }
}

export function isWithinBusinessHours(at, settings = DEFAULT_AUTO_REPLY, timeZone = 'Asia/Kolkata') {
  const { hour, weekday } = localParts(at, timeZone)
  if (!settings.days?.includes(weekday)) return false
  return hour >= settings.startHour && hour < settings.endHour
}

/**
 * Whether an inbound message should get the out-of-hours reply.
 *
 * Deliberately conservative: off unless switched on, never during business
 * hours, and at most once per cooldown per conversation. An auto-responder that
 * fires on every message is how a business number gets reported.
 */
export function shouldAutoReply({ at, lastAutoReplyAt = 0, settings = DEFAULT_AUTO_REPLY, timeZone = 'Asia/Kolkata' }) {
  if (!settings.enabled) return false
  if (isWithinBusinessHours(at, settings, timeZone)) return false
  const cooldownMs = (Number(settings.cooldownHours) || 0) * 3600000
  if (lastAutoReplyAt && at - lastAutoReplyAt < cooldownMs) return false
  return true
}

const EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'video/mp4': 'mp4', 'text/plain': 'txt',
}

/**
 * A filename worth storing. WhatsApp supplies one only for documents; a photo
 * of an RC book arrives with nothing at all, and "undefined" in a client's
 * folder helps no one.
 */
export function mediaFilename(message = {}) {
  const supplied = String(message.filename || '').trim()
  if (supplied) return supplied.replace(/[^\w.\-() ]+/g, '_')
  const ext = EXTENSIONS[message.mimeType] || String(message.mimeType || '').split('/')[1] || 'bin'
  const stamp = new Date(message.timestamp || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `${message.type || 'file'}-${stamp}.${ext}`
}

/** Media types worth pulling down and keeping against the client's record. */
export const STORABLE_TYPES = new Set(['image', 'document', 'video', 'audio'])

export function isStorableMedia(message = {}) {
  return Boolean(message.mediaId) && STORABLE_TYPES.has(message.type)
}
