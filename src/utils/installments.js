// Next-premium list for monthly / quarterly / half-yearly policies.
// Uses getDueDate — the same due date the rest of the app shows — so this
// page cannot drift from Renewals.
import { getDueDate, normaliseFrequency, parseAnyDate } from './dateUtils.js'
import { differenceInDays, startOfDay } from 'date-fns'

const INSTALLMENT_FREQUENCIES = new Set(['Monthly', 'Quarterly', 'Half-Yearly'])
const STOP_STATUSES = new Set(['Renewed-Out', 'Cancelled', 'Matured'])

export function isInstallmentFrequency(frequency) {
  return INSTALLMENT_FREQUENCIES.has(normaliseFrequency(frequency))
}

export function daysUntilAsOf(value, asOf = new Date()) {
  const date = parseAnyDate(value)
  if (!date) return null
  return differenceInDays(startOfDay(date), startOfDay(asOf))
}

export function installmentStatus(days) {
  if (days === null) return { id: 'unknown', label: 'Unknown' }
  if (days < 0) return { id: 'overdue', label: 'Overdue' }
  if (days === 0) return { id: 'today', label: 'Due today' }
  if (days <= 7) return { id: 'week', label: 'Due this week' }
  if (days <= 30) return { id: 'month', label: 'Due in 30 days' }
  return { id: 'later', label: 'Upcoming' }
}

/**
 * Active installment-paying policies whose next premium falls inside the
 * window (default: 14 days overdue through 45 days ahead).
 */
export function listInstallments(policies = [], { asOf = new Date(), fromDays = -14, toDays = 45 } = {}) {
  const rows = []
  for (const policy of policies) {
    if (STOP_STATUSES.has(String(policy.status || 'Active').trim())) continue
    if (policy.is_renewed) continue
    if (!isInstallmentFrequency(policy.frequency)) continue
    const due = getDueDate(policy)
    const days = daysUntilAsOf(due, asOf)
    if (days === null) continue
    if (days < fromDays || days > toDays) continue
    rows.push({
      policy,
      dueDate: due,
      days,
      frequency: normaliseFrequency(policy.frequency),
      status: installmentStatus(days),
    })
  }
  return rows.sort((a, b) => a.days - b.days)
}
