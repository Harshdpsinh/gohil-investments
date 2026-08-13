// src/utils/businessDone.js
// Production reporting: how much new business and how much renewal business was
// written in a period, split by category, company, month and client.
//
// Driven by the policy book, deliberately NOT by commission_transactions.
// Insurer statements arrive 30-90 days late, so a ledger-driven report would
// always understate the current month and keep changing retrospectively.
//
// Pure — no firebase, no react.
import { getDueDate, parseAnyDate } from './dateUtils'

// India runs April-March. Grouping production by calendar year would not match
// any insurer's target sheet or the owner's own tax year.
export const FY_START_MONTH = 3 // zero-based March+1 = April

/** The FY a date belongs to, named by its starting year: Apr 2026 -> 2026. */
export function financialYearOf(value) {
  const date = parseAnyDate(value)
  if (!date) return null
  return date.getMonth() >= FY_START_MONTH ? date.getFullYear() : date.getFullYear() - 1
}

const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Inclusive yyyy-MM-dd bounds of a financial year. */
export function financialYearRange(startYear) {
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31`, label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}` }
}

export const PERIOD_PRESETS = ['This month', 'Last month', 'This quarter', 'This FY', 'Last FY']

export function periodRange(preset, asOf = new Date()) {
  const year = asOf.getFullYear()
  const month = asOf.getMonth()
  const monthRange = (y, m) => ({
    from: iso(new Date(y, m, 1)),
    to: iso(new Date(y, m + 1, 0)),
    label: new Date(y, m, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
  })

  switch (preset) {
    case 'This month': return monthRange(year, month)
    case 'Last month': return monthRange(year, month - 1)
    case 'This quarter': {
      const start = Math.floor(month / 3) * 3
      return {
        from: iso(new Date(year, start, 1)),
        to: iso(new Date(year, start + 3, 0)),
        label: `Q${Math.floor(start / 3) + 1} ${year}`,
      }
    }
    case 'Last FY': return financialYearRange(financialYearOf(asOf) - 1)
    case 'This FY':
    default: return financialYearRange(financialYearOf(asOf))
  }
}

/** The same window one year earlier, for year-on-year comparison. */
export function priorYearRange(range) {
  const shift = value => {
    const date = parseAnyDate(value)
    if (!date) return value
    return iso(new Date(date.getFullYear() - 1, date.getMonth(), date.getDate()))
  }
  return { from: shift(range.from), to: shift(range.to), label: `${range.label} (last year)` }
}

/**
 * A renewal carries a link back to the policy it replaced — renewPolicy writes
 * parentPolicyId and bumps policyYear. Nothing here needs an insurer statement,
 * which is what lets this page be accurate on the day business is written.
 */
export function isRenewalPolicy(policy = {}) {
  return Boolean(policy.parentPolicyId || policy.renewedFromPolicyId) || (Number(policy.policyYear) || 1) > 1
}

const withinRange = (value, { from, to }) => {
  const date = String(value || '').slice(0, 10)
  if (!date) return false
  return (!from || date >= from) && (!to || date <= to)
}

/**
 * Policies whose cover started inside the window. startDate is used rather than
 * createdAt because it is what an insurer's own production report counts, so
 * the two can be checked against each other.
 */
export function policiesInPeriod(policies = [], range) {
  return policies.filter(policy => !policy.deleted && withinRange(policy.startDate, range))
}

const money = value => Number(value) || 0

export function summariseBusiness(policies = [], range) {
  const rows = policiesInPeriod(policies, range)
  const fresh = rows.filter(policy => !isRenewalPolicy(policy))
  const renewal = rows.filter(isRenewalPolicy)
  const premiumOf = list => list.reduce((total, policy) => total + money(policy.premium), 0)
  return {
    total: rows.length,
    totalPremium: premiumOf(rows),
    freshCount: fresh.length,
    freshPremium: premiumOf(fresh),
    renewalCount: renewal.length,
    renewalPremium: premiumOf(renewal),
    // How many of the period's policies have money actually collected against
    // them, as opposed to merely being booked.
    collectedCount: rows.filter(policy => policy.lastPremiumPaidAt).length,
    rows,
  }
}

/**
 * Fresh/renewal split per key — insurer, policy type, month, client. One shape
 * feeds every breakdown tab and the Excel export.
 */
export function groupBusiness(policies = [], range, pick) {
  const map = new Map()
  for (const policy of policiesInPeriod(policies, range)) {
    const key = String(pick(policy) || 'Unspecified')
    const entry = map.get(key) || { key, freshCount: 0, freshPremium: 0, renewalCount: 0, renewalPremium: 0 }
    const premium = money(policy.premium)
    if (isRenewalPolicy(policy)) { entry.renewalCount += 1; entry.renewalPremium += premium }
    else { entry.freshCount += 1; entry.freshPremium += premium }
    map.set(key, entry)
  }
  const rows = [...map.values()].map(entry => ({
    ...entry,
    count: entry.freshCount + entry.renewalCount,
    premium: entry.freshPremium + entry.renewalPremium,
  }))
  const grandTotal = rows.reduce((total, row) => total + row.premium, 0)
  return rows
    .map(row => ({ ...row, sharePct: grandTotal ? Math.round((row.premium / grandTotal) * 1000) / 10 : 0 }))
    .sort((a, b) => b.premium - a.premium)
}

export const GROUP_KEYS = {
  category: policy => policy.policyType || 'Other',
  company: policy => policy.insurer || 'Unknown',
  month: policy => String(policy.startDate || '').slice(0, 7),
  client: policy => policy.clientName || 'Unknown',
}

/**
 * Of the policies that fell due inside the window, how many were actually
 * renewed. This is persistency — the number insurers judge a broker on, and the
 * one the Renewals page cannot show because it only looks forward.
 *
 * Caveat worth knowing: a client who renewed through someone else is
 * indistinguishable from one not yet chased, until the policy is marked
 * Cancelled or Lapsed. Both sit in `pending`.
 */
export function renewalRatio(policies = [], range) {
  const due = policies.filter(policy => !policy.deleted && withinRange(getDueDate(policy), range))
  const renewed = due.filter(policy => policy.is_renewed || String(policy.status || '').trim() === 'Renewed-Out')
  const lost = due.filter(policy => ['Cancelled', 'Lapsed'].includes(String(policy.status || '').trim()))
  const pending = due.length - renewed.length - lost.length
  return {
    due: due.length,
    renewed: renewed.length,
    lost: lost.length,
    pending: Math.max(0, pending),
    ratio: due.length ? Math.round((renewed.length / due.length) * 1000) / 10 : 0,
    renewedPremium: renewed.reduce((total, policy) => total + money(policy.premium), 0),
    pendingPremium: due
      .filter(policy => !policy.is_renewed && String(policy.status || '').trim() !== 'Renewed-Out')
      .reduce((total, policy) => total + money(policy.premium), 0),
  }
}

/** This period against the same period last year. */
export function yearOnYear(policies = [], range) {
  const current = summariseBusiness(policies, range)
  const prior = summariseBusiness(policies, priorYearRange(range))
  const growth = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null)
  return {
    current,
    prior,
    growth: {
      total: growth(current.total, prior.total),
      totalPremium: growth(current.totalPremium, prior.totalPremium),
      freshCount: growth(current.freshCount, prior.freshCount),
      renewalCount: growth(current.renewalCount, prior.renewalCount),
    },
  }
}
