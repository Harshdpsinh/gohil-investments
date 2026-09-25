// src/utils/whatsappCloud.js
// Payload shaping for the official WhatsApp Cloud API (Meta Graph). Pure — no
// firebase, no react, no network — so the rules that decide what actually
// reaches a client's phone are testable. Both senders share this module:
// api/whatsapp-send.js (in-app buttons) and api/renewal-reminders.js (cron).
//
// The one rule that shapes everything here: a message the business starts,
// outside a 24-hour reply window, MUST be a pre-approved template. Free text is
// rejected. So the composed reminder text is only ever a log/preview, and what
// is actually sent is a template name plus ordered parameters.

// Released May 2025, supported ~2 years. Override with WHATSAPP_API_VERSION
// when Meta retires it — a dead version fails every send with HTTP 400.
export const DEFAULT_API_VERSION = 'v23.0'

// The daily automation can only deliver a Utility template. Meta keeps that
// category only when the text is a factual account notice about a policy the
// client already holds. "Please renew", "avoid a break in cover", offers and
// a Renew button are treated as marketing and the template is rejected or
// re-priced. Header and footer are fixed (no variables). The body must not
// start or end on a variable, and variables must be {{1}}… in order with
// words between them. Submit this exact text in Meta / BHASH.
export const UTILITY_PREMIUM_TEMPLATE = {
  name: 'renewal_reminder',
  language: 'en',
  category: 'UTILITY',
  header: 'Premium due notice',
  body: 'Hello {{1}}, this is an account update for your existing {{2}} policy {{3}}. The due date on file is {{4}} and the premium amount is {{5}}. This notice is for your records.',
  footer: 'Gohil Investments, Bhavnagar',
  params: ['clientName', 'policyType', 'policyNumber', 'dueDate', 'premium'],
  examples: ['Harshdipsinh Gohil', 'Health', 'P/2026/0002955', '15 Oct 2026', '₹12,450'],
}

// Same order as UTILITY_PREMIUM_TEMPLATE.params. Override with
// WHATSAPP_TEMPLATE_PARAMS only if the approved template uses a different order.
export const DEFAULT_TEMPLATE_PARAMS = UTILITY_PREMIUM_TEMPLATE.params

/** The notice a client actually sees, for the reminder log. Not sent as free text. */
export function renderUtilityPremiumNotice(detail = {}) {
  const values = templateParameters(detail, UTILITY_PREMIUM_TEMPLATE.params).map(item => item.text)
  let body = UTILITY_PREMIUM_TEMPLATE.body
  values.forEach((value, index) => {
    body = body.replaceAll(`{{${index + 1}}}`, value)
  })
  return `${UTILITY_PREMIUM_TEMPLATE.header}\n\n${body}\n\n${UTILITY_PREMIUM_TEMPLATE.footer}`
}

/**
 * Cloud API wants E.164 digits with no leading '+'. The client book stores bare
 * ten-digit Indian mobiles, and Meta accepts a number with no country code and
 * then silently never delivers it — so default the code in rather than trusting
 * whatever was typed.
 */
export function toE164(mobile, defaultCountryCode = '91') {
  const digits = String(mobile ?? '').replace(/\D/g, '').replace(/^0+/, '')
  if (digits.length < 10) return ''
  return digits.length === 10 ? `${defaultCountryCode}${digits}` : digits
}

/** "clientName, policyType" -> ['clientName','policyType']. Blank -> defaults. */
export function parseTemplateOrder(raw) {
  const order = String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return order.length ? order : DEFAULT_TEMPLATE_PARAMS
}

/**
 * Meta rejects a body parameter that is empty, or that contains a newline, a
 * tab, or four-plus consecutive spaces — one bad value fails the whole send, so
 * every value is flattened to a single line and given a placeholder fallback.
 */
export function templateParameters(detail = {}, order = DEFAULT_TEMPLATE_PARAMS) {
  return order.map(token => ({
    type: 'text',
    text: String(detail[token] ?? '').replace(/\s+/g, ' ').trim() || '-',
  }))
}

export function buildTemplatePayload({ to, templateName, languageCode = 'en', parameters = [] }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      // A template with no variables must not carry an empty components array.
      ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}),
    },
  }
}

export function graphMessagesUrl({ phoneNumberId, apiVersion = DEFAULT_API_VERSION }) {
  return `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`
}

/**
 * Meta's errors are nested and its HTTP status alone says little. Pull out the
 * parts worth writing into a reminder log, and name the two failures that will
 * actually happen in practice.
 */
export function describeGraphError(status, body) {
  const error = body?.error || {}
  const detail = error.error_user_msg || error.message || `HTTP ${status}`
  if (status === 401 || error.code === 190) {
    return `WhatsApp token rejected (${detail}). Regenerate WHATSAPP_TOKEN.`
  }
  if (error.code === 132001 || /template/i.test(detail)) {
    return `Template not usable (${detail}). Check the name, language and that Meta approved it.`
  }
  return `WhatsApp Cloud API ${status}: ${detail}`
}

/** Meta returns { messages: [{ id }] } on success. */
export function messageIdFrom(body) {
  return body?.messages?.[0]?.id || ''
}
