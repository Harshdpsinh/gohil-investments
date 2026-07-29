// src/utils/commissionImport.js
// Maps a raw insurer commission statement (already read into rows by
// exportUtils.parseImportFile) onto existing policies. Pure — no Firebase, no
// React — so the matching rules can be tested directly.
import { fuzzyMatch } from './policyImport'

// Insurers all name their columns differently. Lowercased, non-alphanumerics
// stripped, so "Policy No." and "policy_no" collapse to the same key.
const ALIASES = {
  policyNumber: ['policyno', 'policynumber', 'policy', 'certificateno', 'proposalno'],
  clientName: ['clientname', 'name', 'insuredname', 'policyholder', 'policyholdername', 'customername'],
  insurer: ['insurer', 'company', 'insurancecompany', 'insurername'],
  premium: ['premium', 'grosspremium', 'netpremium', 'premiumamount'],
  commissionPct: ['commissionpct', 'commission', 'commissionpercent', 'commissionpercentage', 'commrate', 'rate', 'brokeragepct'],
  commissionAmount: ['commissionamount', 'commissionamt', 'commamount', 'brokerage', 'brokerageamount', 'payout', 'netpayable'],
  payoutDate: ['payoutdate', 'paymentdate', 'date', 'transactiondate'],
}

const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Number from "1,234.50", "12.5%", "₹1,234" or a real number. NaN-safe. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** Builds { field -> actual column name } from the first row's headers. */
export function mapColumns(row = {}) {
  const found = {}
  for (const header of Object.keys(row)) {
    const k = key(header)
    for (const [field, names] of Object.entries(ALIASES)) {
      if (!found[field] && names.includes(k)) found[field] = header
    }
  }
  return found
}

/** Raw sheet rows -> normalised statement rows. Blank rows are dropped. */
export function normaliseStatement(rows = []) {
  if (!rows.length) return []
  const cols = mapColumns(rows[0])
  return rows
    .map((row, index) => ({
      sourceRow: index + 2, // +2: 1-indexed, and row 1 is the header
      policyNumber: String(row[cols.policyNumber] ?? '').trim(),
      clientName: String(row[cols.clientName] ?? '').trim(),
      insurer: String(row[cols.insurer] ?? '').trim(),
      premium: toNumber(row[cols.premium]),
      commissionPct: toNumber(row[cols.commissionPct]),
      commissionAmount: toNumber(row[cols.commissionAmount]),
      payoutDate: String(row[cols.payoutDate] ?? '').trim(),
    }))
    .filter(r => r.policyNumber || r.clientName)
}

const sameInsurer = (a, b) => {
  const x = key(a), y = key(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * Match one statement row against the policy book.
 * status: 'matched' needs an exact policy number AND a corroborating
 * name or insurer. Anything weaker goes to 'review' for a human.
 */
export function matchRow(row, policies = []) {
  const num = key(row.policyNumber)
  const exact = num ? policies.filter(p => key(p.policyNumber) === num) : []

  if (exact.length === 1) {
    const policy = exact[0]
    const nameOk = !row.clientName || fuzzyMatch(row.clientName, [{ name: policy.clientName }], 0.7).length > 0
    const insurerOk = !row.insurer || sameInsurer(row.insurer, policy.insurer)
    if (nameOk && insurerOk) return { ...row, policy, status: 'matched', reason: 'Policy number, name and insurer agree' }
    return {
      ...row,
      policy,
      status: 'review',
      reason: [!nameOk && 'name differs', !insurerOk && 'insurer differs'].filter(Boolean).join(', '),
    }
  }
  if (exact.length > 1) {
    return { ...row, policy: null, status: 'review', reason: `${exact.length} policies share this number` }
  }

  // No policy number hit — fall back to name, but never auto-post on a name alone.
  const near = row.clientName
    ? fuzzyMatch(row.clientName, policies.map(p => ({ ...p, name: p.clientName })), 0.8)
        .filter(p => !row.insurer || sameInsurer(row.insurer, p.insurer))
    : []
  if (near.length === 1) return { ...row, policy: near[0], status: 'review', reason: 'Matched on name only' }
  if (near.length > 1) return { ...row, policy: null, status: 'review', reason: `${near.length} possible clients` }
  return { ...row, policy: null, status: 'unmatched', reason: 'No matching policy found' }
}

export function matchStatement(rows, policies) {
  return rows.map(row => matchRow(row, policies))
}

/**
 * Stable id for a posted row so re-uploading the same statement cannot
 * double-post. Firestore doc ids may not contain '/'.
 */
export function postingKey(row) {
  const month = (row.payoutDate || '').slice(0, 7) || 'nodate'
  return `${row.policyNumber}_${month}_${Math.round(row.commissionAmount)}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function summarise(matched = []) {
  return {
    total: matched.length,
    matched: matched.filter(r => r.status === 'matched').length,
    review: matched.filter(r => r.status === 'review').length,
    unmatched: matched.filter(r => r.status === 'unmatched').length,
    amount: matched.reduce((s, r) => s + r.commissionAmount, 0),
  }
}
