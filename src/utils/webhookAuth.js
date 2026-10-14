import { timingSafeEqualString } from './timingSafe.js'

export function providedWebhookSecret(query, header) {
  const fromQuery = Array.isArray(query) ? query[0] : query
  return String(fromQuery || header || '').trim()
}

/** Fail closed. A missing secret is a rejection, not an open door. */
export function webhookAuthorized(provided, expected) {
  const secret = String(expected || '').trim()
  if (!secret) return false
  return timingSafeEqualString(String(provided || '').trim(), secret)
}
