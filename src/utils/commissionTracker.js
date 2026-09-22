// Month-wise FY grid for posted commission vs expected.
import { financialYearOf, financialYearRange } from './businessDone'
import { expectedCommission } from './commissionReconcile'
import { txnGross } from './commissionReconcile'

const MONTH_LABELS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

export function fyMonthKeys(startYear) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i < 9 ? i + 4 : i - 8
    const year = i < 9 ? startYear : startYear + 1
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: MONTH_LABELS[i],
    }
  })
}

export function currentFyStart(now = new Date()) {
  return financialYearOf(now) || now.getFullYear()
}

function searchable(policy = {}, client = null) {
  return [
    policy.policyNumber, policy.clientName, policy.insurer, policy.planName,
    policy.clientMobile, policy.clientEmail, client?.mobile, client?.email, client?.pan, client?.name,
  ].map(v => String(v || '').toLowerCase()).join(' ')
}

/**
 * One row per active policy. Each month cell is received / missing / na.
 * na = policy not in force that month (before start, after expiry, or no rate).
 */
export function trackerRows({
  policies = [],
  transactions = [],
  clients = [],
  fyStart,
  query = '',
  insurer = '',
} = {}) {
  const start = Number(fyStart) || currentFyStart()
  const months = fyMonthKeys(start)
  const range = financialYearRange(start)
  const q = String(query || '').trim().toLowerCase()
  const insurerQ = String(insurer || '').trim().toLowerCase()
  const clientById = new Map(clients.map(c => [c.id, c]))

  const byPolicyMonth = new Map()
  for (const txn of transactions) {
    const pid = txn?.policyId
    const month = String(txn?.payoutMonth || '').slice(0, 7)
    if (!pid || !month) continue
    const key = `${pid}|${month}`
    const prev = byPolicyMonth.get(key) || { amount: 0, txn }
    prev.amount += txnGross(txn)
    prev.txn = txn
    byPolicyMonth.set(key, prev)
  }

  const rows = []
  for (const policy of policies) {
    if (!policy?.id || policy.deleted) continue
    const status = String(policy.status || '').trim()
    if (status === 'Renewed-Out' || status === 'Cancelled' || status === 'Matured') continue
    if (insurerQ && !String(policy.insurer || '').toLowerCase().includes(insurerQ)) continue
    const client = clientById.get(policy.clientId) || null
    if (q && !searchable(policy, client).includes(q)) continue

    const expected = expectedCommission(policy)
    const startMonth = String(policy.startDate || '').slice(0, 7)
    const endMonth = String(policy.expiryDate || '').slice(0, 7)
    const cells = {}
    let receivedTotal = 0
    for (const { key } of months) {
      const hit = byPolicyMonth.get(`${policy.id}|${key}`)
      const beforeStart = startMonth && key < startMonth
      const afterEnd = endMonth && key > endMonth
      let state = 'na'
      if (hit) state = 'received'
      else if (!beforeStart && !afterEnd && expected > 0) state = 'missing'
      cells[key] = {
        state,
        amount: hit?.amount || 0,
        txn: hit?.txn || null,
        expected,
      }
      if (hit) receivedTotal += hit.amount
    }
    rows.push({
      policyId: policy.id,
      policyNumber: policy.policyNumber || '',
      clientName: policy.clientName || client?.name || '',
      insurer: policy.insurer || '',
      policyType: policy.policyType || '',
      expected,
      receivedTotal,
      policy,
      cells,
    })
  }
  return { fyStart: start, range, months, rows }
}

export function historyByMonth(transactions = [], policyIds = null) {
  const allow = policyIds ? new Set(policyIds) : null
  const byMonth = new Map()
  let total = 0
  for (const txn of transactions) {
    if (allow && !allow.has(txn.policyId)) continue
    const month = String(txn.payoutMonth || '').slice(0, 7) || 'unknown'
    const amount = txnGross(txn)
    total += amount
    const prev = byMonth.get(month) || { month, amount: 0, count: 0 }
    prev.amount += amount
    prev.count += 1
    byMonth.set(month, prev)
  }
  return {
    total,
    months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
  }
}

export function validateCommissionAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 'Enter a number'
  if (n < 0) return 'Amount cannot be negative'
  if (n > 10_000_000) return 'Amount looks too large — check the figure'
  return ''
}

export function historyBatches(transactions = []) {
  const map = new Map()
  for (const txn of transactions) {
    const id = txn.batchId || [txn.sourceFileName, txn.payoutMonth].filter(Boolean).join('|') || txn.id || 'unknown'
    const prev = map.get(id) || {
      id,
      fileName: txn.sourceFileName || 'Statement',
      fileHash: txn.sourceFileHash || '',
      payoutMonth: txn.payoutMonth || '',
      createdByEmail: txn.createdByEmail || '',
      count: 0,
      amount: 0,
      rows: [],
    }
    prev.count += 1
    prev.amount += txnGross(txn)
    prev.rows.push(txn)
    if (txn.sourceFileName) prev.fileName = txn.sourceFileName
    map.set(id, prev)
  }
  return [...map.values()].sort((a, b) => String(b.payoutMonth).localeCompare(String(a.payoutMonth)))
}

export function paginateRows(rows = [], page = 1, pageSize = 100) {
  const size = Math.max(1, Number(pageSize) || 100)
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / size) || 1)
  const current = Math.min(Math.max(1, Number(page) || 1), pages)
  const start = (current - 1) * size
  return { page: current, pages, total, rows: rows.slice(start, start + size) }
}
