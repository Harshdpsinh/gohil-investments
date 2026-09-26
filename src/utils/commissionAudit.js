// Statement-versus-book commission audit. Pure. Does not post, and does not
// change the chase-screen statuses in commissionReconcile.js.
import { fuzzyMatch } from './policyImport'
import { canonicalInsurer } from './insurers'
import { expectedCommission, toleranceFor } from './commissionReconcile'

export const AUDIT_STATUS = {
  MATCHED: 'MATCHED',
  SHORTFALL: 'COMMISSION SHORTFALL',
  OVERPAYMENT: 'COMMISSION OVERPAYMENT',
  MISSING: 'MISSING IN STATEMENT',
  UNBOOKED: 'UNBOOKED PAYOUT',
  CONFLICT: 'POLICY NUMBER CONFLICT',
  DUPLICATE: 'DUPLICATE PAYOUT',
  REVIEW: 'REVIEW REQUIRED',
}

const MISSING = new Set(['', '-', 'N/A', 'NA', 'NULL', 'NONE', 'NIL'])

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function isMissing(value) {
  return MISSING.has(clean(value).toUpperCase())
}

export function policyKey(value) {
  if (isMissing(value)) return ''
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function money(value) {
  if (isMissing(value) || value == null || value === '') return null
  const n = Number(String(value).replace(/[₹,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function phoneDigits(value) {
  if (isMissing(value)) return ''
  return String(value).replace(/\D/g, '').replace(/^0+/, '').slice(-10)
}

function emailOf(value) {
  if (isMissing(value)) return ''
  return clean(value).toLowerCase()
}

function panOf(value) {
  if (isMissing(value)) return ''
  return clean(value).toUpperCase()
}

/** Gross, TDS and the amount variance is allowed to use. TDS is not a shortfall. */
export function payoutMoney(row = {}) {
  const gross = money(row.receivedCommission ?? row.grossCommission ?? row.commissionAmount)
  const reward = money(row.rewardCommission ?? row.reward)
  const tds = money(row.tds)
  const deduction = money(row.deduction ?? row.adjustment)
  const net = money(row.netReceived ?? row.netCommission ?? row.netPaid)
  const actual = tds != null && gross != null ? gross : (net != null ? net : gross)
  return { gross, reward, tds, deduction, net, actual }
}

function namesConflict(a, b) {
  const left = clean(a)
  const right = clean(b)
  if (!left || !right || isMissing(left) || isMissing(right)) return false
  if (left.toUpperCase() === right.toUpperCase()) return false
  return fuzzyMatch(left, [{ name: right }], 0.8).length === 0
}

function insurersConflict(a, b) {
  if (isMissing(a) || isMissing(b)) return false
  const left = canonicalInsurer(a) || clean(a)
  const right = canonicalInsurer(b) || clean(b)
  if (!left || !right) return false
  return left.toLowerCase() !== right.toLowerCase()
}

function plansConflict(a, b) {
  const left = clean(a).toLowerCase()
  const right = clean(b).toLowerCase()
  if (!left || !right || isMissing(a) || isMissing(b)) return false
  return !left.includes(right) && !right.includes(left)
}

function premiumsConflict(a, b) {
  const x = money(a)
  const y = money(b)
  if (x == null || y == null || x === 0 || y === 0) return false
  return Math.abs(x - y) > Math.max(100, Math.abs(x) * 0.25)
}

function identityConflicts(payout, policy) {
  const conflicts = []
  if (insurersConflict(payout.insurer, policy.insurer)) conflicts.push('Insurer differs')
  if (namesConflict(payout.clientName, policy.clientName)) conflicts.push('Client name differs')
  if (premiumsConflict(payout.premium, policy.premium)) conflicts.push('Premium differs')
  if (plansConflict(payout.planName, policy.planName)) conflicts.push('Plan differs')
  return conflicts
}

function hardConflict(conflicts) {
  return conflicts.some(item => item !== 'Plan differs')
}

function clientOf(policy, clientsById) {
  return clientsById.get(policy.clientId) || null
}

function payoutMonth(row) {
  const month = clean(row.payoutMonth)
  if (/^\d{4}-\d{2}/.test(month)) return month.slice(0, 7)
  const date = clean(row.payoutDate)
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : ''
}

function crmMonth(policy) {
  const date = clean(policy.startDate)
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : ''
}

function duplicateKey(row) {
  if (row.rowHash) return `hash:${row.rowHash}`
  if (row.id) return ''
  const source = clean(row.sourceRow)
  if (!source) return ''
  const amount = payoutMoney(row).actual
  return `src:${policyKey(row.policyNumber)}|${payoutMonth(row)}|${amount}|${source}`
}

function moneyStatus(expected, actual) {
  if (expected == null) {
    return { status: AUDIT_STATUS.REVIEW, reason: 'Expected commission cannot be calculated from the CRM rate and premium' }
  }
  if (actual == null) {
    return { status: AUDIT_STATUS.REVIEW, reason: 'Actual commission paid is missing on the payout' }
  }
  const variance = Math.round((expected - actual) * 100) / 100
  const tolerance = toleranceFor(expected)
  if (variance > tolerance) return { status: AUDIT_STATUS.SHORTFALL, reason: 'Reason not established from supplied data' }
  if (variance < -tolerance) return { status: AUDIT_STATUS.OVERPAYMENT, reason: 'Reason not established from supplied data' }
  return { status: AUDIT_STATUS.MATCHED, reason: 'Policy number agrees and paid commission is within tolerance' }
}

function scoreBand(conflicts, method) {
  if (hardConflict(conflicts)) return 40
  if (conflicts.length) return 78
  if (method === 'Exact policy number') return 100
  if (method === 'Strong identity') return 88
  if (method === 'Possible match') return 68
  return 0
}

/**
 * Every CRM policy and every payout ends in exactly one primary status.
 * Uncertain payouts are not applied to the policy's received total.
 */
export function auditCommission({ policies = [], payouts = [], clients = [] } = {}) {
  const clientsById = new Map(clients.map(client => [client.id, client]))
  const byPolicyKey = new Map()
  for (const policy of policies) {
    const key = policyKey(policy.policyNumber)
    if (!key) continue
    const list = byPolicyKey.get(key) || []
    list.push(policy)
    byPolicyKey.set(key, list)
  }

  const seen = new Map()
  const prepared = payouts.map((row, index) => {
    const identity = duplicateKey(row) || (row.id ? `id:${row.id}` : `idx:${index}`)
    const dupOf = seen.get(identity)
    const duplicate = identity.startsWith('hash:') || identity.startsWith('src:')
      ? Boolean(dupOf)
      : false
    if (!seen.has(identity)) seen.set(identity, index + 1)
    return { row, index, duplicate, dupOf }
  })

  const applied = new Map()
  const loose = []

  for (const item of prepared) {
    if (item.duplicate) {
      loose.push(rowFromPayout(item, {
        status: AUDIT_STATUS.DUPLICATE,
        score: 0,
        method: 'Duplicate source row',
        reason: `Same source identity as payout row ${item.dupOf}`,
        conflicts: [],
        candidates: [],
      }))
      continue
    }
    const decision = classifyPayout(item.row, policies, byPolicyKey, clientsById)
    if (decision.applyTo) {
      const bucket = applied.get(decision.applyTo.id) || []
      bucket.push({ ...item, decision })
      applied.set(decision.applyTo.id, bucket)
    } else {
      loose.push(rowFromPayout(item, decision))
    }
  }

  const rows = []
  for (const policy of policies) {
    const hits = applied.get(policy.id) || []
    rows.push(hits.length ? rowFromPolicy(policy, hits, clientsById) : missingPolicy(policy, clientsById))
  }
  rows.push(...loose)

  return {
    rows,
    missingInStatement: rows.filter(row => row.status === AUDIT_STATUS.MISSING),
    shortfalls: rows
      .filter(row => row.status === AUDIT_STATUS.SHORTFALL)
      .sort((a, b) => (a.insurer || '').localeCompare(b.insurer || '') || Math.abs(b.variance || 0) - Math.abs(a.variance || 0)),
    unbooked: rows.filter(row => row.status === AUDIT_STATUS.UNBOOKED),
    conflicts: rows.filter(row => row.status === AUDIT_STATUS.CONFLICT),
    duplicates: rows.filter(row => row.status === AUDIT_STATUS.DUPLICATE),
    review: rows.filter(row => row.status === AUDIT_STATUS.REVIEW),
    summary: summarise(rows, policies, payouts),
    queries: buildQueries(rows),
    dataQuality: dataQuality(policies, payouts),
  }
}

function classifyPayout(payout, policies, byPolicyKey, clientsById) {
  const key = policyKey(payout.policyNumber)
  const exact = key ? (byPolicyKey.get(key) || []) : []
  if (exact.length === 1) return decideExact(payout, exact[0])
  if (exact.length > 1) {
    const cleanHits = exact.filter(policy => !hardConflict(identityConflicts(payout, policy)))
    if (cleanHits.length === 1) return decideExact(payout, cleanHits[0])
    return {
      applyTo: null,
      status: AUDIT_STATUS.REVIEW,
      score: 70,
      method: 'Exact policy number',
      reason: `${exact.length} CRM policies share this policy number`,
      conflicts: [],
      candidates: exact.map(policy => policy.id),
    }
  }

  const strong = strongCandidates(payout, policies, clientsById)
  if (strong.length === 1) {
    return {
      applyTo: null,
      status: AUDIT_STATUS.REVIEW,
      score: 88,
      method: 'Strong identity',
      reason: 'Policy number missing or unusable. One CRM policy matches insurer, name and another identity field. Not posted automatically.',
      conflicts: [],
      candidates: [strong[0].id],
      candidate: strong[0],
    }
  }
  const possible = possibleCandidates(payout, policies)
  if (possible.length) {
    return {
      applyTo: null,
      status: AUDIT_STATUS.REVIEW,
      score: 68,
      method: 'Possible match',
      reason: 'Fuzzy identity only. Not posted automatically.',
      conflicts: [],
      candidates: possible.map(policy => policy.id),
      candidate: possible[0],
    }
  }
  return {
    applyTo: null,
    status: AUDIT_STATUS.UNBOOKED,
    score: possible.length ? 40 : 0,
    method: 'No reliable match',
    reason: 'No CRM policy matched on policy number or a strong identity.',
    conflicts: [],
    candidates: [],
  }
}

function decideExact(payout, policy) {
  const conflicts = identityConflicts(payout, policy)
  if (hardConflict(conflicts)) {
    return {
      applyTo: null,
      status: AUDIT_STATUS.CONFLICT,
      score: 40,
      method: 'Exact policy number',
      reason: conflicts.join('; '),
      conflicts,
      candidates: [policy.id],
      candidate: policy,
    }
  }
  if (conflicts.length) {
    return {
      applyTo: null,
      status: AUDIT_STATUS.REVIEW,
      score: 78,
      method: 'Exact policy number',
      reason: conflicts.join('; '),
      conflicts,
      candidates: [policy.id],
      candidate: policy,
    }
  }
  return {
    applyTo: policy,
    status: AUDIT_STATUS.MATCHED,
    score: 100,
    method: 'Exact policy number',
    reason: 'Policy number, and the supplied insurer and client name, agree',
    conflicts: [],
    candidates: [policy.id],
  }
}

function strongCandidates(payout, policies, clientsById) {
  return policies.filter(policy => {
    if (insurersConflict(payout.insurer, policy.insurer)) return false
    if (!clean(payout.insurer) || !clean(policy.insurer)) return false
    if (namesConflict(payout.clientName, policy.clientName)) return false
    if (!clean(payout.clientName) || !clean(policy.clientName)) return false
    const client = clientOf(policy, clientsById)
    const pan = panOf(payout.pan) && panOf(payout.pan) === panOf(client?.pan)
    const mobile = phoneDigits(payout.mobile || payout.clientMobile) && phoneDigits(payout.mobile || payout.clientMobile) === phoneDigits(client?.mobile)
    const email = emailOf(payout.email || payout.clientEmail) && emailOf(payout.email || payout.clientEmail) === emailOf(client?.email)
    const premiumOk = !premiumsConflict(payout.premium, policy.premium) && money(payout.premium) != null && money(policy.premium) != null
    const planOk = clean(payout.planName) && clean(policy.planName) && !plansConflict(payout.planName, policy.planName)
    return Boolean(pan || mobile || email || (premiumOk && planOk))
  })
}

function possibleCandidates(payout, policies) {
  if (!clean(payout.clientName) || isMissing(payout.clientName)) return []
  return fuzzyMatch(payout.clientName, policies.map(policy => ({ ...policy, name: policy.clientName })), 0.72)
    .filter(policy => !insurersConflict(payout.insurer, policy.insurer))
    .slice(0, 3)
}

function blankRow() {
  return {
    status: '',
    crmMonth: '',
    payoutDate: '',
    insurer: '',
    clientName: '',
    policyNumber: '',
    planName: '',
    expected: null,
    actual: null,
    variance: null,
    gross: null,
    reward: null,
    tds: null,
    deduction: null,
    net: null,
    score: 0,
    method: '',
    reason: '',
    conflicts: [],
    candidates: [],
    components: [],
  }
}

function rowFromPolicy(policy, hits, clientsById) {
  const expected = expectedOf(policy)
  const parts = hits.map(hit => payoutMoney(hit.row))
  const sum = key => parts.reduce((total, part) => total + (part[key] || 0), 0)
  const actual = parts.every(part => part.actual == null) ? null : sum('actual')
  const moneyResult = moneyStatus(expected, actual)
  const base = blankRow()
  return {
    ...base,
    status: moneyResult.status,
    crmMonth: crmMonth(policy),
    payoutDate: hits.map(hit => clean(hit.row.payoutDate) || payoutMonth(hit.row)).filter(Boolean).join(', '),
    insurer: policy.insurer || hits[0].row.insurer || '',
    clientName: policy.clientName || '',
    policyNumber: policy.policyNumber || '',
    planName: policy.planName || '',
    expected,
    actual,
    variance: expected == null || actual == null ? null : Math.round((expected - actual) * 100) / 100,
    gross: parts.some(part => part.gross != null) ? sum('gross') : null,
    reward: parts.some(part => part.reward != null) ? sum('reward') : null,
    tds: parts.some(part => part.tds != null) ? sum('tds') : null,
    deduction: parts.some(part => part.deduction != null) ? sum('deduction') : null,
    net: parts.some(part => part.net != null) ? sum('net') : null,
    score: 100,
    method: 'Exact policy number',
    reason: moneyResult.reason,
    conflicts: [],
    candidates: [policy.id],
    components: hits.map(hit => ({
      payoutDate: hit.row.payoutDate || payoutMonth(hit.row),
      actual: payoutMoney(hit.row).actual,
    })),
    client: clientOf(policy, clientsById),
  }
}

function missingPolicy(policy) {
  const expected = expectedOf(policy)
  const base = blankRow()
  if (expected == null) {
    return {
      ...base,
      status: AUDIT_STATUS.REVIEW,
      crmMonth: crmMonth(policy),
      insurer: policy.insurer || '',
      clientName: policy.clientName || '',
      policyNumber: policy.policyNumber || '',
      planName: policy.planName || '',
      expected: null,
      score: 0,
      method: 'CRM booking',
      reason: 'Expected commission cannot be calculated from the CRM rate and premium',
      candidates: [policy.id],
    }
  }
  if (expected === 0) {
    return {
      ...base,
      status: AUDIT_STATUS.REVIEW,
      crmMonth: crmMonth(policy),
      insurer: policy.insurer || '',
      clientName: policy.clientName || '',
      policyNumber: policy.policyNumber || '',
      planName: policy.planName || '',
      expected: 0,
      method: 'CRM booking',
      reason: 'Expected commission is zero on the CRM booking',
      candidates: [policy.id],
    }
  }
  return {
    ...base,
    status: AUDIT_STATUS.MISSING,
    crmMonth: crmMonth(policy),
    insurer: policy.insurer || '',
    clientName: policy.clientName || '',
    policyNumber: policy.policyNumber || '',
    planName: policy.planName || '',
    expected,
    variance: null,
    score: 0,
    method: 'No payout found',
    reason: 'No corresponding insurer payout was found',
    candidates: [policy.id],
  }
}

function rowFromPayout(item, decision) {
  const moneyParts = payoutMoney(item.row)
  const base = blankRow()
  return {
    ...base,
    status: decision.status,
    payoutDate: clean(item.row.payoutDate) || payoutMonth(item.row),
    insurer: item.row.insurer || decision.candidate?.insurer || '',
    clientName: item.row.clientName || decision.candidate?.clientName || '',
    policyNumber: item.row.policyNumber || decision.candidate?.policyNumber || '',
    planName: item.row.planName || '',
    actual: moneyParts.actual,
    gross: moneyParts.gross,
    reward: moneyParts.reward,
    tds: moneyParts.tds,
    deduction: moneyParts.deduction,
    net: moneyParts.net,
    score: decision.score ?? scoreBand(decision.conflicts || [], decision.method),
    method: decision.method,
    reason: decision.reason,
    conflicts: decision.conflicts || [],
    candidates: decision.candidates || [],
  }
}

function expectedOf(policy) {
  const premium = money(policy.premium)
  const year = Number(policy.policyYear) || 1
  const rate = money(year === 1 ? policy.fyCommission : policy.ryCommission)
  if (premium == null || rate == null) return null
  return expectedCommission(policy)
}

function summarise(rows, policies, payouts) {
  const sum = (list, pick) => list.reduce((total, row) => total + (pick(row) || 0), 0)
  const count = status => rows.filter(row => row.status === status).length
  const byInsurer = new Map()
  const byMonth = new Map()
  for (const row of rows) {
    const insurer = canonicalInsurer(row.insurer) || row.insurer || 'Unknown'
    const entry = byInsurer.get(insurer) || emptyInsurer(insurer)
    entry.expected += row.expected || 0
    entry.actual += row.actual || 0
    entry.matched += row.status === AUDIT_STATUS.MATCHED ? 1 : 0
    entry.missing += row.status === AUDIT_STATUS.MISSING ? 1 : 0
    entry.shortfall += row.status === AUDIT_STATUS.SHORTFALL ? 1 : 0
    entry.unbooked += row.status === AUDIT_STATUS.UNBOOKED ? 1 : 0
    entry.review += row.status === AUDIT_STATUS.REVIEW ? 1 : 0
    byInsurer.set(insurer, entry)

    const month = row.crmMonth || String(row.payoutDate || '').slice(0, 7) || 'Unknown'
    const monthEntry = byMonth.get(month) || { month, expected: 0, received: 0, matched: 0, missing: 0, shortfall: 0 }
    monthEntry.expected += row.expected || 0
    monthEntry.received += row.actual || 0
    monthEntry.matched += row.status === AUDIT_STATUS.MATCHED ? 1 : 0
    monthEntry.missing += row.status === AUDIT_STATUS.MISSING ? 1 : 0
    monthEntry.shortfall += row.status === AUDIT_STATUS.SHORTFALL ? 1 : 0
    byMonth.set(month, monthEntry)
  }
  return {
    expected: sum(rows, row => row.expected),
    received: sum(rows, row => row.actual),
    variance: sum(rows, row => row.variance),
    policies: policies.length,
    payouts: payouts.length,
    matched: count(AUDIT_STATUS.MATCHED),
    missing: count(AUDIT_STATUS.MISSING),
    shortfall: count(AUDIT_STATUS.SHORTFALL),
    overpayment: count(AUDIT_STATUS.OVERPAYMENT),
    unbooked: count(AUDIT_STATUS.UNBOOKED),
    conflict: count(AUDIT_STATUS.CONFLICT),
    duplicate: count(AUDIT_STATUS.DUPLICATE),
    review: count(AUDIT_STATUS.REVIEW),
    byInsurer: [...byInsurer.values()].map(entry => ({ ...entry, variance: entry.expected - entry.actual })),
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map(entry => ({
      ...entry,
      variance: entry.expected - entry.received,
    })),
  }
}

function emptyInsurer(insurer) {
  return { insurer, expected: 0, actual: 0, matched: 0, missing: 0, shortfall: 0, unbooked: 0, review: 0 }
}

function buildQueries(rows) {
  const ranked = [
    ...rows.filter(row => row.status === AUDIT_STATUS.SHORTFALL),
    ...rows.filter(row => row.status === AUDIT_STATUS.MISSING),
    ...rows.filter(row => row.status === AUDIT_STATUS.CONFLICT),
    ...rows.filter(row => row.status === AUDIT_STATUS.UNBOOKED),
    ...rows.filter(row => row.status === AUDIT_STATUS.DUPLICATE),
    ...rows.filter(row => row.status === AUDIT_STATUS.OVERPAYMENT),
  ]
  return ranked.map(row => ({
    insurer: row.insurer || '',
    policyNumber: row.policyNumber || '',
    clientName: row.clientName || '',
    expected: row.expected,
    actual: row.actual,
    difference: row.variance,
    issue: row.status,
    evidence: row.reason || 'Reason not established from supplied data',
    queryPoint: queryPoint(row.status),
  }))
}

function queryPoint(status) {
  switch (status) {
    case AUDIT_STATUS.SHORTFALL: return 'Ask the insurer why the paid commission is below the booked rate.'
    case AUDIT_STATUS.MISSING: return 'Ask the insurer for the payout, or confirm the policy is not on this statement.'
    case AUDIT_STATUS.CONFLICT: return 'Do not post. Confirm the policy number belongs to this client and insurer.'
    case AUDIT_STATUS.UNBOOKED: return 'Find or create the CRM booking before treating this payout as received.'
    case AUDIT_STATUS.DUPLICATE: return 'Confirm the statement row was not uploaded twice.'
    case AUDIT_STATUS.OVERPAYMENT: return 'Ask the insurer why the paid commission is above the booked rate.'
    default: return 'Review the row before posting.'
  }
}

function dataQuality(policies, payouts) {
  const issues = []
  for (const policy of policies) {
    if (!policyKey(policy.policyNumber)) issues.push(`CRM policy ${policy.id || policy.clientName || ''} has no usable policy number`)
    if (expectedOf(policy) == null) issues.push(`CRM policy ${policy.policyNumber || policy.id || ''} has no commission rate or premium`)
  }
  for (const payout of payouts) {
    if (payoutMoney(payout).actual == null) issues.push(`Payout ${payout.policyNumber || payout.clientName || ''} has no paid amount`)
  }
  return issues
}
