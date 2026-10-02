// A sent reminder is never repeated. A failed one, or one stuck on "sending",
// can be claimed again so a morning miss still goes out the same day.
const SENDING_LOCK_MS = 10 * 60 * 1000

export function canClaimReminder(status, updatedAtMs, now = Date.now()) {
  if (!status) return true
  if (status === 'sent') return false
  if (status === 'sending' && now - Number(updatedAtMs || 0) < SENDING_LOCK_MS) return false
  return true
}
