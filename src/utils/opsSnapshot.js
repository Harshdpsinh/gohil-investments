// Read-only views over the policy book. Does not write Firestore, does not
// change renewal / commission / persistency rules. startDate + premium are
// the same inputs Business Done already uses.
import { getDueDate, parseAnyDate } from './dateUtils'
import {
  GROUP_KEYS,
  financialYearOf,
  financialYearRange,
  groupBusiness,
  periodRange,
  summariseBusiness,
} from './businessDone'

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const money = value => Number(value) || 0

function lastUpdatedAt(policies = []) {
  let latest = null
  for (const policy of policies) {
    const stamp = parseAnyDate(policy.updatedAt || policy.createdAt)
    if (stamp && (!latest || stamp > latest)) latest = stamp
  }
  return latest
}

/** Yearly / this-month booked rupees for Home. Renewals = policyYear > 1 or parent link. */
export function bookSnapshot(policies = [], asOf = new Date()) {
  const fy = periodRange('This FY', asOf)
  const month = periodRange('This month', asOf)
  const fySummary = summariseBusiness(policies, fy)
  const monthSummary = summariseBusiness(policies, month)
  return {
    fy,
    month,
    yearlyPremium: fySummary.totalPremium,
    yearlyCount: fySummary.total,
    monthPremium: monthSummary.totalPremium,
    monthCount: monthSummary.total,
    monthRenewalPremium: monthSummary.renewalPremium,
    monthRenewalCount: monthSummary.renewalCount,
    lastUpdated: lastUpdatedAt(policies),
  }
}

/** Twelve Apr–Mar tiles. Empty months stay ₹0 — no backfill. */
export function fyMonthTiles(policies = [], asOf = new Date()) {
  const startYear = financialYearOf(asOf) ?? asOf.getFullYear()
  const range = financialYearRange(startYear)
  const grouped = groupBusiness(policies, range, GROUP_KEYS.month)
  const byKey = Object.fromEntries(grouped.map(row => [row.key, row]))
  const tiles = []
  for (let i = 0; i < 12; i += 1) {
    const date = new Date(startYear, 3 + i, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const row = byKey[key] || { count: 0, premium: 0, renewalPremium: 0, freshPremium: 0 }
    tiles.push({
      key,
      label: MONTHS_SHORT[date.getMonth()],
      yearShort: String(date.getFullYear()).slice(-2),
      from: `${key}-01`,
      to: iso(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
      count: row.count || 0,
      premium: row.premium || 0,
      renewalPremium: row.renewalPremium || 0,
      freshPremium: row.freshPremium || 0,
    })
  }
  return {
    range,
    tiles,
    maxPremium: Math.max(...tiles.map(tile => tile.premium), 1),
  }
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Days in a calendar month: booked (startDate) vs due (existing due helper). */
export function calendarMonth(policies = [], year, month) {
  const last = new Date(year, month + 1, 0).getDate()
  const days = {}
  for (let day = 1; day <= last; day += 1) {
    days[day] = { booked: 0, bookedCount: 0, due: 0, dueCount: 0, bookedRows: [], dueRows: [] }
  }
  for (const policy of policies) {
    if (policy.deleted) continue
    const start = parseAnyDate(policy.startDate)
    if (start && start.getFullYear() === year && start.getMonth() === month) {
      const bucket = days[start.getDate()]
      bucket.booked += money(policy.premium)
      bucket.bookedCount += 1
      bucket.bookedRows.push(policy)
    }
    const due = parseAnyDate(getDueDate(policy))
    if (due && due.getFullYear() === year && due.getMonth() === month) {
      const bucket = days[due.getDate()]
      bucket.due += money(policy.premium)
      bucket.dueCount += 1
      bucket.dueRows.push(policy)
    }
  }
  const totals = Object.values(days).reduce(
    (acc, day) => ({
      booked: acc.booked + day.booked,
      due: acc.due + day.due,
      bookedCount: acc.bookedCount + day.bookedCount,
      dueCount: acc.dueCount + day.dueCount,
    }),
    { booked: 0, due: 0, bookedCount: 0, dueCount: 0 },
  )
  return { year, month, last, days, totals }
}

/**
 * Net is always the stored premium (unchanged). Gross/OD only appear when
 * those optional fields were actually filled on the record.
 */
export function displayPremiums(policy = {}) {
  const net = money(policy.premium)
  const grossRaw = policy.grossPremium
  const hasGross = grossRaw !== undefined && grossRaw !== null && String(grossRaw).trim() !== ''
  const odRaw = policy.odPremium
  const hasOd = odRaw !== undefined && odRaw !== null && String(odRaw).trim() !== ''
  const discountRaw = policy.discountPct
  const hasDiscount = discountRaw !== undefined && discountRaw !== null && String(discountRaw).trim() !== '' && Number(discountRaw) !== 0
  const ncbRaw = policy.ncbPct
  const hasNcb = ncbRaw !== undefined && ncbRaw !== null && String(ncbRaw).trim() !== '' && String(ncbRaw) !== '0'
  return {
    net,
    gross: hasGross ? money(grossRaw) : net,
    hasGross,
    od: hasOd ? money(odRaw) : 0,
    hasOd,
    hasDiscount,
    discountPct: hasDiscount ? discountRaw : '',
    hasNcb,
    ncbPct: hasNcb ? ncbRaw : '',
  }
}

export const AUTO_WA_PDF_KEY = 'gi-auto-wa-on-pdf'

export function isAutoWaOnPdfEnabled() {
  try {
    return window.localStorage.getItem(AUTO_WA_PDF_KEY) === '1'
  } catch {
    return false
  }
}

export function setAutoWaOnPdfEnabled(on) {
  try {
    window.localStorage.setItem(AUTO_WA_PDF_KEY, on ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}

export function policyCopyMessage(policy, url) {
  const link = url || policy?.policyPdfUrl || ''
  return (
    `Dear ${policy?.clientName || 'Client'},\n\n` +
    `Your ${policy?.policyType || 'insurance'} policy document is ready.\n\n` +
    `Policy No: ${policy?.policyNumber || '—'}\n` +
    `Insurer: ${policy?.insurer || '—'}\n` +
    `Premium: ${policy?.premium || '—'}\n` +
    (link ? `\n${link}\n` : '\n') +
    `\nGohil Investments\nWealth Management & Insurance Advisory\n` +
    `Harshdipsinh Gohil - 7698997894\nPradipsinh Gohil - 9426204547\nBhavnagar, Gujarat`
  )
}
