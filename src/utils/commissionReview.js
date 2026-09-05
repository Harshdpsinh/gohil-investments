// Pure helpers for the commission review side panel.
// Picks which posted row to edit and the copy that tells the user whether
// this commission still needs an update. Nothing here writes to Firestore.
import { RECONCILE_STATUS } from './commissionReconcile'

/** Latest posting for a policy. Null means nothing has been saved yet. */
export function latestCommissionPosting(transactions = [], policyId) {
  if (!policyId) return null
  const rows = transactions.filter(row => row && row.policyId === policyId)
  if (!rows.length) return null
  return [...rows].sort((a, b) => {
    const dateCmp = String(b.payoutDate || b.payoutMonth || '').localeCompare(String(a.payoutDate || a.payoutMonth || ''))
    if (dateCmp) return dateCmp
    return String(b.id || '').localeCompare(String(a.id || ''))
  })[0]
}

export function commissionReviewPrompt(status) {
  switch (status) {
    case RECONCILE_STATUS.AWAITED:
      return {
        needsUpdate: true,
        title: 'This commission needs an update',
        body: 'Nothing has been posted yet. Enter what the insurer paid, then save.',
      }
    case RECONCILE_STATUS.SHORT:
      return {
        needsUpdate: true,
        title: 'This commission needs an update',
        body: 'Received is short of the expected amount. Correct the figures if the statement differs, then update.',
      }
    case RECONCILE_STATUS.OVER:
      return {
        needsUpdate: true,
        title: 'This commission needs an update',
        body: 'Received is more than expected. Check the amount, then update.',
      }
    case RECONCILE_STATUS.NO_RATE:
      return {
        needsUpdate: true,
        title: 'This commission needs an update',
        body: 'No rate is on file. You can still enter the amount the insurer paid.',
      }
    case RECONCILE_STATUS.RECEIVED:
      return {
        needsUpdate: false,
        title: 'This commission is settled',
        body: 'You can still correct the posted amount if something was entered wrong.',
      }
    default:
      return {
        needsUpdate: false,
        title: 'Review commission',
        body: 'Check the figures and update them if you want.',
      }
  }
}

export function currentPayoutMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function draftFromReview({ row, existing, now = new Date() } = {}) {
  const received = existing
    ? (existing.netReceived ?? existing.receivedCommission ?? '')
    : (row?.received || row?.expected || '')
  return {
    amount: received === '' || received == null ? '' : String(received),
    tds: String(existing?.tds ?? row?.tds ?? ''),
    gst: String(existing?.gst ?? row?.gst ?? ''),
    payoutMonth: existing?.payoutMonth || currentPayoutMonth(now),
    payoutDate: existing?.payoutDate || '',
    remarks: existing?.remarks || '',
  }
}
