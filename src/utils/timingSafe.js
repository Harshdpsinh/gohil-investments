import crypto from 'node:crypto'

export function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8')
  const b = Buffer.from(String(right ?? ''), 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function bearerMatches(header, secret) {
  if (!secret) return false
  return timingSafeEqualString(String(header || ''), `Bearer ${secret}`)
}
