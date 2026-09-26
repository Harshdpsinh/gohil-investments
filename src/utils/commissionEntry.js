// Insurer + month sheet for typing commission by hand.
// Pure. Does not post, and does not touch posting keys.
import { canonicalInsurer, groupKey } from './insurers'
import { expectedCommission, txnGross } from './commissionReconcile'
import { frequencyMonths, parseAnyDate } from './dateUtils'

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
    if (String(txn.payoutMonth || '').slice(0, 7) !== monthKey) continue
    const prev = receivedByPolicy.get(txn.policyId) || { amount: 0, count: 0 }
    prev.amount += txnGross(txn)
    prev.count += 1
    receivedByPolicy.set(txn.policyId, prev)
  }

  const rows = []
  for (const policy of policies) {
    if (!policy?.id || policy.deleted) continue
    if (!monthKey || !dueInMonth(policy, monthKey)) continue
    const hint = { policyType: policy.policyType }
    const key = groupKey(policy.insurer, hint) || canonicalInsurer(policy.insurer, hint)
    if (insurerKey && key !== insurerKey) continue
    if (clientQ) {
      const who = [policy.clientName, policy.clientMobile, policy.clientId]
        .map(v => String(v || '').toLowerCase()).join(' ')
      if (!who.includes(clientQ)) continue
    }
    const hay = [policy.policyNumber, policy.clientName, policy.planName, policy.clientMobile]
      .map(v => String(v || '').toLowerCase()).join(' ')
    if (q && !hay.includes(q)) continue
    const hit = receivedByPolicy.get(policy.id)
    const pct = bookedPct(policy)
    const premium = Number(policy.premium) || 0
    rows.push({
      policyId: policy.id,
      policyNumber: policy.policyNumber || '',
      clientName: policy.clientName || '',
      clientMobile: policy.clientMobile || '',
      insurer: canonicalInsurer(policy.insurer, hint) || policy.insurer || '',
      planName: policy.planName || '',
      policyType: policy.policyType || '',
      premium,
      bookedPct: pct,
      expected: expectedCommission(policy),
      received: Boolean(hit),
      receivedAmount: hit?.amount || 0,
      policy,
    })
  }
  rows.sort((a, b) => Number(a.received) - Number(b.received) || a.clientName.localeCompare(b.clientName))
  return rows
}

export function entryTotals(items = []) {
  let policies = 0
  let premium = 0
  let commission = 0
  for (const item of items) {
    if (!item?.include) continue
    const amount = Number(item.amount) || 0
    if (amount <= 0) continue
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
