// src/utils/dateUtils.js
import { format, differenceInDays, parseISO, isValid } from 'date-fns'

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
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`)
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
  return differenceInDays(d, new Date())
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
  const v = (val||'').toLowerCase().trim()
  if (['yearly','year','annual','annually','per year','p.a.','pa','1 year','12 months'].some(x=>v.includes(x))) return 'Yearly'
  if (['half','6 month','semi','bi-annual','biannual','half year'].some(x=>v.includes(x))) return 'Half-Yearly'
  if (['quarter','3 month','qtr'].some(x=>v.includes(x))) return 'Quarterly'
  if (['month','monthly','1 month','per month'].some(x=>v.includes(x))) return 'Monthly'
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

// ── Compute next premium due date ─────────────────────────────
// FIX #3: O(1) direct math replaces O(n) while-loop.
// Old loop iterated once per interval (up to ~120x for monthly/10yr policy).
// New version computes elapsed intervals directly – safe for any start date.
export function computeNextPremiumDue(startDate, frequency) {
  const start = parseAnyDate(startDate)
  if (!start) return null
  const intervalMs = frequencyDays(frequency) * 86400000
  const today      = Date.now()
  const elapsed    = Math.floor((today - start.getTime()) / intervalMs)
  const next       = new Date(start.getTime() + (elapsed + 1) * intervalMs)
  return next
}

// ── Format next premium due for display ──────────────────────
export function daysUntilPremium(startDate, frequency) {
  const next = computeNextPremiumDue(startDate, frequency)
  if (!next) return null
  return Math.ceil((next - new Date()) / (1000 * 60 * 60 * 24))
}
