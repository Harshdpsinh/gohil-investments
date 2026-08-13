// src/utils/commissionReconcile.js
// Joins the policy book to the posted commission ledger, per policy.
//
// The Commission page used to compute two totals that never met: estimated
// earnings from the book, and posted receipts from commission_transactions.
// Nothing joined them, so a policy whose premium was collected and whose
// commission the insurer never paid looked identical to one that was settled.
// Everything here answers that one question.
//
// Pure — no firebase, no react — so the money rules are testable.
import { getDueDate, parseAnyDate } from './dateUtils'

/** Rupee value of one transaction. netReceived is what actually landed. */
export const txnAmount = txn => Number(txn?.netReceived ?? txn?.receivedCommission ?? 0)

/**
 * What the insurer should pay on this policy. First-year policies earn the FY
 * rate, every later year earns the RY rate — the same split the policy form
 * captures. Returns 0 when no rate is on file, which is why 'no-rate' is its
 * own bucket rather than being reported as a shortfall.
 */
export function expectedCommission(policy = {}) {
  const premium = Number(policy.premium) || 0
  const year = Number(policy.policyYear) || 1
  const rate = Number(year === 1 ? policy.fyCommission : policy.ryCommission) || 0
  if (!premium || !rate) return 0
  return Math.round((premium * rate) / 100)
}

/**
 * Statements round, and some carriers pay commission on a premium net of GST.
 * A flat rupee tolerance would flag half the book, so allow 1% with a ₹1 floor.
 */
export function toleranceFor(expected, pct = 0.01) {
  return Math.max(1, Math.abs(expected) * pct)
}

const RECONCILE_STATUS = {
  RECEIVED: 'received',
  SHORT: 'short',
  OVER: 'over',
  AWAITED: 'awaited',
  NO_RATE: 'no-rate',
  NOT_DUE: 'not-due',
}
export { RECONCILE_STATUS }

// A policy that was renewed away or cancelled still earned commission on the
// term it ran, so only a future start date makes commission genuinely not due.
const inForce = policy => !['Cancelled'].includes(String(policy?.status || '').trim())

/**
 * Sums every posted transaction per policy. Reversals post as negative rows, so
 * summing IS the netting — a clawback cancels the payout it reverses instead of
 * both being counted as income.
 */
export function netByPolicy(transactions = []) {
  const map = new Map()
  for (const txn of transactions) {
    const id = txn?.policyId
    if (!id) continue
    const current = map.get(id) || { received: 0, credits: 0, debits: 0, tds: 0, gst: 0, count: 0, rows: [] }
    const amount = txnAmount(txn)
    current.received += amount
    if (amount < 0) current.debits += amount
    else current.credits += amount
    current.tds += Number(txn.tds) || 0
    current.gst += Number(txn.gst) || 0
    current.count += 1
    current.rows.push(txn)
    map.set(id, current)
  }
  return map
}

/** Earliest payout date recorded against a policy, used for days-to-pay. */
function firstPayoutDate(rows = []) {
  const dates = rows
    .map(row => parseAnyDate(row.payoutDate || (row.payoutMonth ? `${row.payoutMonth}-01` : '')))
    .filter(Boolean)
    .sort((a, b) => a - b)
  return dates[0] || null
}

const dayDiff = (from, to) => Math.floor((to - from) / 86400000)

/**
 * One row per policy: what was expected, what landed, and which of those two
 * facts needs a human. `asOf` is injected so the ageing is deterministic.
 */
export function reconcilePolicies(policies = [], transactions = [], { asOf = new Date(), tolerancePct = 0.01 } = {}) {
  const ledger = netByPolicy(transactions)

  return policies.map(policy => {
    const entry = ledger.get(policy.id) || { received: 0, credits: 0, debits: 0, tds: 0, gst: 0, count: 0, rows: [] }
    const expected = expectedCommission(policy)
    const received = Math.round(entry.received)
    const difference = received - expected
    const tolerance = toleranceFor(expected, tolerancePct)

    const start = parseAnyDate(policy.startDate)
    const notStarted = start ? start > asOf : false
    // Commission becomes chaseable from the day cover starts.
    const ageingDays = start && !notStarted ? dayDiff(start, asOf) : 0
    const paidOn = firstPayoutDate(entry.rows)

    let status
    if (notStarted && !entry.count) status = RECONCILE_STATUS.NOT_DUE
    else if (!expected && !entry.count) status = RECONCILE_STATUS.NO_RATE
    else if (!entry.count) status = RECONCILE_STATUS.AWAITED
    else if (difference < -tolerance) status = RECONCILE_STATUS.SHORT
    else if (difference > tolerance) status = RECONCILE_STATUS.OVER
    else status = RECONCILE_STATUS.RECEIVED

    return {
      policyId: policy.id,
      policyNumber: policy.policyNumber || '',
      clientName: policy.clientName || '',
      insurer: policy.insurer || '',
      policyType: policy.policyType || '',
      policyYear: Number(policy.policyYear) || 1,
      premium: Number(policy.premium) || 0,
      startDate: policy.startDate || '',
      dueDate: getDueDate(policy) || '',
      // markPremiumPaid stamps this. It is the only positive signal that the
      // client's money actually arrived, as opposed to the policy being booked.
      premiumCollected: Boolean(policy.lastPremiumPaidAt),
      expected,
      received,
      difference,
      credits: Math.round(entry.credits),
      reversals: Math.round(entry.debits),
      tds: Math.round(entry.tds),
      gst: Math.round(entry.gst),
      postings: entry.count,
      status,
      // Only meaningful while nothing has been received.
      ageingDays: entry.count ? 0 : Math.max(0, ageingDays),
      daysToPay: start && paidOn ? Math.max(0, dayDiff(start, paidOn)) : null,
      chaseable: !entry.count && !notStarted && expected > 0 && inForce(policy),
    }
  })
}

export const AGEING_BUCKETS = ['0-30', '31-60', '61-90', '90+']

export function ageingBucket(days) {
  const n = Number(days) || 0
  if (n <= 30) return '0-30'
  if (n <= 60) return '31-60'
  if (n <= 90) return '61-90'
  return '90+'
}

/**
 * How much unpaid commission sits in each ageing band. Insurers routinely pay
 * 45-90 days late, so without this you cannot tell "late" from "never".
 */
export function ageingSummary(rows = []) {
  const base = Object.fromEntries(AGEING_BUCKETS.map(bucket => [bucket, { count: 0, amount: 0 }]))
  for (const row of rows) {
    if (!row.chaseable) continue
    const bucket = base[ageingBucket(row.ageingDays)]
    bucket.count += 1
    bucket.amount += row.expected
  }
  return base
}

export function reconcileSummary(rows = []) {
  const bucket = status => rows.filter(row => row.status === status)
  const sum = (list, pick) => list.reduce((total, row) => total + pick(row), 0)
  const chaseable = rows.filter(row => row.chaseable)
  const short = bucket(RECONCILE_STATUS.SHORT)
  return {
    policies: rows.length,
    expected: sum(rows, row => row.expected),
    received: sum(rows, row => row.received),
    outstanding: sum(chaseable, row => row.expected) + Math.abs(sum(short, row => row.difference)),
    tds: sum(rows, row => row.tds),
    reversals: sum(rows, row => row.reversals),
    counts: {
      received: bucket(RECONCILE_STATUS.RECEIVED).length,
      short: short.length,
      over: bucket(RECONCILE_STATUS.OVER).length,
      awaited: bucket(RECONCILE_STATUS.AWAITED).length,
      noRate: bucket(RECONCILE_STATUS.NO_RATE).length,
      notDue: bucket(RECONCILE_STATUS.NOT_DUE).length,
    },
  }
}

/**
 * Which insurer short-pays, and which pays late. This is the number to take
 * into an agency-agreement renegotiation.
 */
export function insurerScorecard(rows = []) {
  const map = new Map()
  for (const row of rows) {
    const key = row.insurer || 'Unknown'
    const entry = map.get(key) || {
      insurer: key, policies: 0, expected: 0, received: 0,
      outstanding: 0, unpaid: 0, short: 0, tds: 0, payDays: [],
    }
    entry.policies += 1
    entry.expected += row.expected
    entry.received += row.received
    entry.tds += row.tds
    if (row.chaseable) { entry.unpaid += 1; entry.outstanding += row.expected }
    if (row.status === RECONCILE_STATUS.SHORT) { entry.short += 1; entry.outstanding += Math.abs(row.difference) }
    if (row.daysToPay !== null) entry.payDays.push(row.daysToPay)
    map.set(key, entry)
  }
  return [...map.values()]
    .map(entry => ({
      ...entry,
      variance: entry.received - entry.expected,
      // Null, not 0: "never been paid" and "paid same day" are different facts.
      avgDaysToPay: entry.payDays.length
        ? Math.round(entry.payDays.reduce((a, b) => a + b, 0) / entry.payDays.length)
        : null,
      settledPct: entry.expected ? Math.round((entry.received / entry.expected) * 100) : 0,
    }))
    .sort((a, b) => b.expected - a.expected)
}

/**
 * Commission you can expect to bill over the next `days`, from renewals already
 * on the book. Turns the page from a rear-view mirror into a cash forecast.
 */
export function receivablesForecast(policies = [], { asOf = new Date(), days = 90 } = {}) {
  const horizon = new Date(asOf.getTime() + days * 86400000)
  const months = new Map()
  let total = 0
  let count = 0

  for (const policy of policies) {
    if (!inForce(policy) || policy.is_renewed) continue
    const due = parseAnyDate(getDueDate(policy))
    if (!due || due < asOf || due > horizon) continue
    // A renewal earns the RY rate, so price next year's rate, not this year's.
    const rate = Number(policy.ryCommission || policy.fyCommission) || 0
    const amount = Math.round(((Number(policy.premium) || 0) * rate) / 100)
    const key = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`
    months.set(key, (months.get(key) || 0) + amount)
    total += amount
    count += 1
  }

  return { total, count, byMonth: Object.fromEntries([...months].sort(([a], [b]) => a.localeCompare(b))) }
}

/**
 * TDS deducted per insurer, for checking against Form 26AS at year end.
 * Insurers deduct 5% under s.194D and it is credited against your own tax.
 */
export function tdsSummary(transactions = [], { from = '', to = '' } = {}) {
  const inRange = month => (!from || month >= from) && (!to || month <= to)
  const map = new Map()
  let total = 0
  let gross = 0

  for (const txn of transactions) {
    const month = String(txn.payoutMonth || (txn.payoutDate || '').slice(0, 7))
    if (month && !inRange(month)) continue
    const key = txn.insurer || 'Unknown'
    const tds = Number(txn.tds) || 0
    const entry = map.get(key) || { insurer: key, gross: 0, tds: 0, net: 0, rows: 0 }
    entry.gross += txnAmount(txn) + tds
    entry.tds += tds
    entry.net += txnAmount(txn)
    entry.rows += 1
    map.set(key, entry)
    total += tds
    gross += txnAmount(txn) + tds
  }

  return {
    total: Math.round(total),
    gross: Math.round(gross),
    byInsurer: [...map.values()]
      .map(entry => ({ ...entry, gross: Math.round(entry.gross), tds: Math.round(entry.tds), net: Math.round(entry.net) }))
      .sort((a, b) => b.tds - a.tds),
  }
}
