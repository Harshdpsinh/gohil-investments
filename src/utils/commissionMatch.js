// Confidence score, discrepancy, and hashes for statement rows.
// Does not change matchRow status — that remains the source of truth.
import { expectedCommission, toleranceFor } from './commissionReconcile'
import { postedAmounts } from './commissionImport'

export function fnv1a(text) {
  let hash = 0x811c9dc5
  const s = String(text || '')
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function rowHash(row = {}) {
  const number = String(row.policyNumber || '').replace(/\W/g, '').toLowerCase()
  const month = row.payoutMonth || String(row.payoutDate || '').slice(0, 7)
  const amount = Math.round(Number(row.commissionAmount || row.receivedCommission || 0))
  const premium = Math.round(Number(row.premium || 0))
  return `rh_${fnv1a([number, month, amount, row.sourceRow ?? 0, premium].join('|'))}`
}

export async function fileHashFromBuffer(buffer) {
  if (!buffer) return ''
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer)
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  }
  return `fh_${fnv1a(String.fromCharCode(...bytes.slice(0, 4096)))}`
}

/** 0–100. 100 = exact policy number + identity. Unmatched = 0. */
export function matchScore(row = {}) {
  const status = row.status
  const reason = String(row.reason || '')
  if (status === 'matched') {
    if (reason.includes('prior term')) return 92
    if (reason.toLowerCase().includes('last-4') || reason.toLowerCase().includes('last 4')) return 90
    return 100
  }
  if (status === 'review') {
    if (reason.includes('name differs') || reason.includes('insurer differs')) return 55
    if (reason.includes('share this number') || reason.includes('share last-4')) return 45
    if (reason.includes('new policy')) return 40
    if (reason.includes('Existing client')) return 42
    return 50
  }
  return 0
}

export function expectedPct(policy = {}) {
  const year = Number(policy.policyYear) || 1
  return Number(year === 1 ? policy.fyCommission : policy.ryCommission) || 0
}

export function receivedPct(row = {}, policy = {}) {
  const premium = Number(row.premium || policy.premium) || 0
  const amount = postedAmounts(row).receivedCommission
  if (!premium || !amount) return 0
  return Math.round((amount / premium) * 10000) / 100
}

export function commissionDiscrepancy(row = {}, policy = null) {
  const expected = policy ? expectedCommission(policy) : Number(row.expectedCommission) || 0
  const received = postedAmounts(row).receivedCommission || Number(row.receivedCommission) || 0
  const tds = postedAmounts(row).tds
  const net = postedAmounts(row).netReceived
  const expPct = policy ? expectedPct(policy) : Number(row.expectedPct) || 0
  const recPct = receivedPct(row, policy || {})
  const amountDiff = Math.round((received - expected) * 100) / 100
  const within = Math.abs(amountDiff) <= toleranceFor(expected)
  const hasDiscrepancy = expected > 0 && !within
  return {
    expected,
    received,
    tds,
    net,
    expectedPct: expPct,
    receivedPct: recPct,
    amountDiff,
    hasDiscrepancy,
    tone: !hasDiscrepancy ? 'ok' : amountDiff < 0 ? 'short' : 'over',
  }
}

/**
 * Ready = exact match, no rupee conflict.
 * Review = conflicts, last-4, name-only, or variance.
 * Unmatched = no policy.
 */
export function importBucket(row = {}, policy = null) {
  const score = Number(row.matchScore ?? matchScore(row))
  if (row.status === 'unmatched' || (!row.policy && !policy)) return 'unmatched'
  const disc = commissionDiscrepancy(row, policy || row.policy)
  if (row.status === 'matched' && score >= 100 && !disc.hasDiscrepancy) return 'ready'
  return 'review'
}

export function alreadyPostedHashes(transactions = []) {
  const files = new Set()
  const rows = new Set()
  const dates = {}
  const rowDates = {}
  for (const txn of transactions) {
    if (txn?.sourceFileHash) {
      files.add(txn.sourceFileHash)
      dates[txn.sourceFileHash] = txn.payoutMonth || txn.postedAt || txn.payoutDate || ''
    }
    if (txn?.rowHash) {
      rows.add(txn.rowHash)
      rowDates[txn.rowHash] = txn.payoutMonth || txn.postedAt || txn.payoutDate || ''
    }
  }
  return { files, rows, dates, rowDates }
}
