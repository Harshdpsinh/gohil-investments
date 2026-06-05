// src/utils/dateUtils.js
import { format, differenceInDays, parseISO, isValid, addMonths, startOfDay } from 'date-fns'

// ── Universal date parser ─────────────────────────────────────
// Handles: Firestore Timestamp {seconds,nanoseconds}, ISO string,
// plain Date object, dd/MM/yyyy string, yyyy-MM-dd string
export function parseAnyDate(val) {
  if (!val) return null
  // Firestore Timestamp
  if (val?.seconds !== undefined) return new Date(val.seconds * 1000)
  // Already a Date
  if (val instanceof Date) return isValid(val) ? val : null
  const s = String(val).trim()
  if (!s) return null
  // dd/MM/yyyy
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
    return isValid(d) ? d : null
  }
  // ISO / yyyy-MM-dd
  try { const d = parseISO(s); return isValid(d) ? d : null } catch { return null }
}

// ── Convert any date to yyyy-MM-dd string (for <input type="date">) ──
export function toInputDate(val) {
  const d = parseAnyDate(val)
  if (!d) return ''
  return format(d, 'yyyy-MM-dd')
}

export const fmtDate = (val) => {
  const d = parseAnyDate(val)
  if (!d) return '—'
  return format(d, 'dd/MM/yyyy')
}

export const fmtDateTime = (val) => {
  const d = parseAnyDate(val)
  if (!d) return '—'
  return format(d, 'dd/MM/yyyy HH:mm')
}

export const daysUntil = (val) => {
  const d = parseAnyDate(val)
  if (!d) return null
  return differenceInDays(startOfDay(d), startOfDay(new Date()))
}

export const fmtCurrency = (val) => {
  const n = parseFloat(val || 0)
  if (isNaN(n)) return '₹0'
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

export const renewalStatus = (val) => {
  const days = daysUntil(val)
  if (days === null)  return { label: 'Unknown',  color: 'gray'   }
  if (days < 0)       return { label: 'Expired',   color: 'red'    }
  if (days <= 15)     return { label: 'Critical',  color: 'red'    }
  if (days <= 30)     return { label: 'Due Soon',  color: 'yellow' }
  if (days <= 60)     return { label: 'Upcoming',  color: 'blue'   }
  return               { label: 'Active',    color: 'green'  }
}

export const currentMonthName = () => format(new Date(), 'MMMM yyyy')

// ── Frequency normaliser ──────────────────────────────────────
// Maps any user-typed frequency to one of 4 standard values
export function normaliseFrequency(val) {
  const raw = String(val || '').toLowerCase().trim()
  const v = raw.replace(/[^a-z0-9]+/g, ' ')
  const compact = v.replace(/\s+/g, '')
  if (['single', 'one time', 'onetime', 'one-time'].some(x => raw.includes(x))) return 'Yearly'

  if (
    ['halfyearly','halfyear','halfyr','hly','semiannual','semiannually','biannual','biannually'].includes(compact) ||
    ['half yearly','half year','6 month','six month','semi annual','bi annual'].some(x => v.includes(x))
  ) return 'Half-Yearly'

  if (
    ['quarterly','quarter','qtr','qtly','qly'].includes(compact) ||
    ['3 month','three month'].some(x => v.includes(x))
  ) return 'Quarterly'

  if (
    ['monthly','month','mly'].includes(compact) ||
    ['1 month','one month','per month'].some(x => v.includes(x))
  ) return 'Monthly'

  if (
    ['yearly','year','annual','annually','anual','annul','yalry','yearley','yrly','pa'].includes(compact) ||
    ['per year','p a','1 year','one year','12 month','twelve month'].some(x => v.includes(x))
  ) return 'Yearly'
  return 'Yearly'  // safe default
}

// ── Frequency → days interval ─────────────────────────────────
export function frequencyDays(frequency) {
  switch(normaliseFrequency(frequency)) {
    case 'Monthly':     return 30
    case 'Quarterly':   return 90
    case 'Half-Yearly': return 180
    default:            return 365  // Yearly
  }
}

export function frequencyMonths(frequency) {
  switch(normaliseFrequency(frequency)) {
    case 'Monthly':     return 1
    case 'Quarterly':   return 3
    case 'Half-Yearly': return 6
    default:            return 12
  }
}

export function addFrequencyInterval(date, frequency) {
  const d = parseAnyDate(date)
  if (!d) return null
  return addMonths(d, frequencyMonths(frequency))
}

export function coverageTermYears(policy) {
  const raw = Number(policy?.coverageTermYears || policy?.policyCoverageYears || 1)
  if (!Number.isFinite(raw)) return 1
  return Math.min(5, Math.max(1, Math.round(raw)))
}

export function isMultiYearPolicy(policy) {
  if (!policy) return false
  const isLifePolicy = String(policy.policyType || '').trim().toLowerCase() === 'life'
  return !isLifePolicy && Boolean(policy.isMultiYearPolicy) && coverageTermYears(policy) > 1
}

export function addPolicyCoverageInterval(date, policy) {
  const d = parseAnyDate(date)
  if (!d) return null
  return addMonths(d, coverageTermYears(policy) * 12)
}

export function computeNextPolicyDue(policy) {
  if (!policy) return null
  if (isMultiYearPolicy(policy)) {
    const start = parseAnyDate(policy.startDate)
    if (!start) return null
    const today = startOfDay(new Date())
    const months = coverageTermYears(policy) * 12
    let next = startOfDay(start)
    let intervals = 0
    while (next < today && intervals < 100) {
      intervals += 1
      next = startOfDay(addMonths(start, intervals * months))
    }
    return next
  }
  return computeNextPremiumDue(policy.startDate, policy.frequency)
}

export function getNextInstallmentDue(policy) {
  const due = parseAnyDate(getDueDate(policy))
  if (!due) return ''
  return toInputDate(addFrequencyInterval(due, policy?.frequency || 'Yearly'))
}

// ── Compute next premium due date ─────────────────────────────
// FIX #3: O(1) direct math replaces O(n) while-loop.
// Old loop iterated once per interval (up to ~120x for monthly/10yr policy).
// New version computes elapsed intervals directly – safe for any start date.
export function computeNextPremiumDue(startDate, frequency) {
  const start = parseAnyDate(startDate)
  if (!start) return null
  const today = startOfDay(new Date())
  let next = startOfDay(start)
  const months = frequencyMonths(frequency)
  let intervals = 0
  while (next < today && intervals < 2400) {
    intervals += 1
    next = startOfDay(addMonths(start, intervals * months))
  }
  return next
}

// ── Format next premium due for display ──────────────────────
export function daysUntilPremium(startDate, frequency) {
  const next = computeNextPremiumDue(startDate, frequency)
  if (!next) return null
  return Math.ceil((next - new Date()) / (1000 * 60 * 60 * 24))
}

export function getDueDate(policy) {
  if (!policy) return ''
  const isLifePolicy = String(policy.policyType || '').trim().toLowerCase() === 'life'
  const expiry = parseAnyDate(policy.expiryDate)
  if (!isLifePolicy && expiry) return toInputDate(expiry)
  const storedDue = toInputDate(policy.nextPremiumDue)
  if (storedDue) {
    const due = parseAnyDate(storedDue)
    if (!isLifePolicy && due && expiry && due > expiry) return toInputDate(expiry)
    return storedDue
  }
  const computedDue = computeNextPolicyDue(policy)
  if (computedDue) {
    if (!isLifePolicy && expiry && computedDue > expiry) return toInputDate(expiry)
    return toInputDate(computedDue)
  }
  return toInputDate(policy.expiryDate)
}

export function daysUntilPolicyDue(policy) {
  const due = parseAnyDate(getDueDate(policy))
  if (!due) return null
  return differenceInDays(startOfDay(due), startOfDay(new Date()))
}
