// Insurer + month sheet for typing commission by hand.
// Pure. Does not post, and does not touch posting keys.
import { canonicalInsurer, groupKey } from './insurers'
import { txnGross } from './commissionReconcile'
import { coverageTermYears, frequencyMonths, isMultiYearPolicy, parseAnyDate } from './dateUtils'

const CLOSED = new Set(['Renewed-Out', 'Cancelled', 'Matured'])

function monthKeyOf(value) {
  if (!value) return ''
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7)
  const date = parseAnyDate(value)
  if (!date) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthIndex(key) {
  const [year, month] = key.split('-').map(Number)
  return year * 12 + (month - 1)
}

/**
 * A policy belongs to a month only when a premium falls in it.
 * Yearly: the start month and the end month stored on the policy, not the
 * months in between. Monthly, quarterly and half-yearly: each installment
 * from the start date through the end date.
 */
export function dueInMonth(policy = {}, month = '') {
  const status = String(policy.status || '').trim()
  if (policy.deleted || policy.is_renewed || CLOSED.has(status)) return false
  const target = String(month || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(target)) return false

  const start = monthKeyOf(policy.startDate)
  const end = monthKeyOf(policy.expiryDate)
  const storedDue = monthKeyOf(policy.nextPremiumDue)
  if (storedDue === target) return true
  if (!start && end === target) return true
  if (!start) return false
  if (target < start) return false
  if (end && target > end) return false

  const step = frequencyMonths(policy.frequency) || 12
  const delta = monthIndex(target) - monthIndex(start)
  if (delta % step === 0) return true
  // The end date is the renewal month even when it is not an anniversary.
  return Boolean(end) && end === target
}

export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function addMonthsToKey(key, count) {
  const index = monthIndex(key) + count
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

/** One commission a year. A 3-year advance premium still pays year 1, then year 2, then year 3. */
export function commissionYears(policy = {}) {
  const years = isMultiYearPolicy(policy) ? coverageTermYears(policy) : 1
  const start = monthKeyOf(policy.startDate)
  const annual = Number(policy.premium) || 0
  return Array.from({ length: years }, (_, index) => {
    const year = index + 1
    const pct = year === 1
      ? (Number(policy.fyCommission) || 0)
      : (Number(policy.ryCommission || policy.fyCommission) || 0)
    return {
      year,
      years,
      payoutMonth: start ? addMonthsToKey(start, index * 12) : '',
      premium: annual,
      pct,
      amount: amountFromPct(annual, pct),
    }
  })
}

export function policyTail(policyNumber) {
  const digits = String(policyNumber || '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : digits
}

/** Last 4 digits, or any fragment of the policy number, name or mobile. */
export function matchesPolicyLookup(policy = {}, query = '') {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const digits = q.replace(/\D/g, '')
  const policyDigits = String(policy.policyNumber || '').replace(/\D/g, '')
  if (digits.length >= 4 && policyDigits.includes(digits)) return true
  const hay = [policy.policyNumber, policy.clientName, policy.planName, policy.clientMobile]
    .map(v => String(v || '').toLowerCase()).join(' ')
  return hay.includes(q)
}

export function validateSignedAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Enter a number'
  if (n === 0) return 'Amount cannot be zero'
  if (Math.abs(n) > 10_000_000) return 'Amount looks too large — check the figure'
  return ''
}

export function bookedPct(policy = {}) {
  const year = Number(policy.policyYear) || 1
  const raw = year === 1 ? policy.fyCommission : policy.ryCommission
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function amountFromPct(premium, pct) {
  const p = Number(premium) || 0
  const r = Number(pct)
  if (!p || !Number.isFinite(r)) return 0
  return Math.round((p * r) / 100)
}

export function pctFromAmount(premium, amount) {
  const p = Number(premium) || 0
  const a = Number(amount)
  if (!p || !Number.isFinite(a)) return 0
  return Math.round((a / p) * 10000) / 100
}

export function insurerChoices(policies = []) {
  const map = new Map()
  for (const policy of policies) {
    if (!policy || policy.deleted) continue
    const hint = { policyType: policy.policyType }
    const name = canonicalInsurer(policy.insurer, hint) || String(policy.insurer || '').trim()
    if (!name) continue
    const key = groupKey(policy.insurer, hint) || name
    const prev = map.get(key) || { key, name, count: 0 }
    prev.count += 1
    map.set(key, prev)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * One row per policy that has a premium in this month.
 * received = a ledger row already exists for that policy in that month.
 */
export function entryRows({
  policies = [],
  transactions = [],
  insurerKey = '',
  month = '',
  query = '',
  client = '',
} = {}) {
  const monthKey = String(month || '').slice(0, 7)
  const q = String(query || '').trim().toLowerCase()
  const clientQ = String(client || '').trim().toLowerCase()
  const receivedByPolicy = new Map()
  for (const txn of transactions) {
    if (!txn?.policyId) continue
    const paidMonth = String(txn.payoutMonth || '').slice(0, 7)
    if (!paidMonth) continue
    const key = `${txn.policyId}|${paidMonth}`
    const prev = receivedByPolicy.get(key) || { amount: 0, count: 0 }
    prev.amount += txnGross(txn)
    prev.count += 1
    receivedByPolicy.set(key, prev)
  }

  const digits = q.replace(/\D/g, '')
  const openBook = digits.length >= 4 || q.length >= 4

  const rows = []
  for (const policy of policies) {
    if (!policy?.id || policy.deleted) continue
    const status = String(policy.status || '').trim()
    if (policy.is_renewed || CLOSED.has(status)) continue
    if (!openBook && (!monthKey || !dueInMonth(policy, monthKey))) continue
    const hint = { policyType: policy.policyType }
    const insurerId = groupKey(policy.insurer, hint) || canonicalInsurer(policy.insurer, hint)
    if (insurerKey && insurerId !== insurerKey) continue
    if (clientQ) {
      const who = [policy.clientName, policy.clientMobile, policy.clientId]
        .map(v => String(v || '').toLowerCase()).join(' ')
      if (!who.includes(clientQ)) continue
    }
    if (q && !matchesPolicyLookup(policy, q)) continue
    const slices = commissionYears(policy).map(slice => ({
      ...slice,
      received: Boolean(receivedByPolicy.get(`${policy.id}|${slice.payoutMonth}`)),
    }))
    const slice = slices.find(item => item.payoutMonth === monthKey)
      || slices.find(item => !item.received)
      || slices[0]
    const hit = slice?.payoutMonth ? receivedByPolicy.get(`${policy.id}|${slice.payoutMonth}`) : null
    rows.push({
      policyId: policy.id,
      policyNumber: policy.policyNumber || '',
      policyTail: policyTail(policy.policyNumber),
      clientName: policy.clientName || '',
      clientMobile: policy.clientMobile || '',
      insurer: canonicalInsurer(policy.insurer, hint) || policy.insurer || '',
      insurerKey: insurerId,
      planName: policy.planName || '',
      policyType: policy.policyType || '',
      premium: slice?.premium || Number(policy.premium) || 0,
      bookedPct: slice?.pct || 0,
      expected: slice?.amount || 0,
      year: slice?.year || 1,
      years: slice?.years || 1,
      payoutMonth: slice?.payoutMonth || monthKey,
      slices,
      received: Boolean(hit),
      receivedAmount: hit?.amount || 0,
      policy,
    })
  }
  rows.sort((a, b) => Number(a.received) - Number(b.received) || a.clientName.localeCompare(b.clientName))
  return rows
}

export function pendingByInsurer(rows = []) {
  const map = new Map()
  for (const row of rows) {
    if (row.received) continue
    const key = row.insurerKey || row.insurer || 'unknown'
    const prev = map.get(key) || { key, name: row.insurer || 'Unknown', count: 0, expected: 0 }
    prev.count += 1
    prev.expected += Number(row.expected) || 0
    map.set(key, prev)
  }
  return [...map.values()].sort((a, b) => b.expected - a.expected || a.name.localeCompare(b.name))
}

export function netEntryAmount(amount, adjust = 0) {
  const base = Number(amount)
  const extra = Number(adjust)
  const net = (Number.isFinite(base) ? base : 0) + (Number.isFinite(extra) ? extra : 0)
  return Math.round(net * 100) / 100
}

export function entryTotals(items = []) {
  let policies = 0
  let premium = 0
  let commission = 0
  for (const item of items) {
    if (!item?.include) continue
    const amount = netEntryAmount(item.amount, item.adjust)
    if (!Number.isFinite(amount) || amount === 0) continue
    policies += 1
    premium += Number(item.premium) || 0
    commission += amount
  }
  const pct = premium ? Math.round((commission / premium) * 10000) / 100 : 0
  return {
    policies,
    premium,
    commission: Math.round(commission * 100) / 100,
    pct,
  }
}

export function draftFromPct(premium, pct) {
  const rate = Number(pct)
  const amount = amountFromPct(premium, rate)
  return {
    pct: Number.isFinite(rate) && rate !== 0 ? String(rate) : '',
    amount: amount ? String(amount) : '',
  }
}

export function draftFromAmount(premium, amountText) {
  const amount = Number(amountText)
  if (!Number.isFinite(amount)) return { pct: '', amount: String(amountText ?? ''), error: 'Enter a number' }
  if (amount < 0) return { pct: '', amount: String(amountText), error: 'Amount cannot be negative' }
  return {
    pct: String(pctFromAmount(premium, amount)),
    amount: String(amountText),
    error: '',
  }
}
