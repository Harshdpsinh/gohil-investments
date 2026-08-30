// Family grouping for the profile tab. Read-only — never writes Firestore.
import { fmtCurrency, fmtDate, getDueDate, daysUntil } from './dateUtils.js'

const STOP = new Set(['Renewed-Out', 'Cancelled', 'Matured'])
const isActive = policy => !STOP.has(String(policy?.status || 'Active').trim()) && !policy?.is_renewed

/**
 * Prefer familyId. Same familyName only groups people who also have no id,
 * so two unrelated "Patel" households do not merge.
 */
export function familyMembersOf(client, clients = []) {
  if (!client) return []
  if (client.familyId) {
    return clients.filter(row => row.familyId === client.familyId)
  }
  const name = String(client.familyName || '').trim().toLowerCase()
  if (!name) return [client]
  return clients.filter(row => !row.familyId && String(row.familyName || '').trim().toLowerCase() === name)
}

export function familyPoliciesOf(members = [], policies = []) {
  const ids = new Set(members.map(row => row.id))
  return policies.filter(policy => ids.has(policy.clientId))
}

export function familyCoverTotals(policies = []) {
  const active = policies.filter(isActive)
  const cover = policy => Number(policy.sumInsured || policy.sumAssured || policy.idv) || 0
  const premium = policy => Number(policy.premium) || 0
  const ofType = type => active.filter(policy => policy.policyType === type)
  return {
    members: 0,
    policies: active.length,
    premium: active.reduce((sum, policy) => sum + premium(policy), 0),
    healthCover: ofType('Health').reduce((sum, policy) => sum + cover(policy), 0),
    lifeCover: ofType('Life').reduce((sum, policy) => sum + cover(policy), 0),
    motorIdv: ofType('Motor').reduce((sum, policy) => sum + cover(policy), 0),
  }
}

export function familyPremiumCalendar(policies = [], members = []) {
  return policies
    .filter(isActive)
    .map(policy => {
      const due = getDueDate(policy)
      const owner = members.find(row => row.id === policy.clientId)
      return {
        policy,
        ownerName: owner?.name || policy.clientName || 'Family member',
        dueDate: due,
        days: daysUntil(due),
      }
    })
    .filter(row => row.dueDate)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
}

export function familySummaryMessage(client, members = [], policies = []) {
  const totals = familyCoverTotals(policies)
  const calendar = familyPremiumCalendar(policies, members).slice(0, 8)
  const names = members.map(row => row.name).filter(Boolean).join(', ') || client?.name || 'your family'
  const lines = calendar.map(row =>
    `- ${row.ownerName}: ${row.policy.policyType || 'Policy'} ${row.policy.policyNumber || ''} due ${fmtDate(row.dueDate)} (${fmtCurrency(row.policy.premium)})`
  )
  return [
    `Dear ${client?.name || 'Customer'},`,
    '',
    `Family portfolio summary for ${names}.`,
    `Active policies: ${totals.policies}`,
    `Annual premium: ${fmtCurrency(totals.premium)}`,
    totals.healthCover ? `Total health cover: ${fmtCurrency(totals.healthCover)}` : '',
    totals.lifeCover ? `Total life cover: ${fmtCurrency(totals.lifeCover)}` : '',
    '',
    'Upcoming premiums:',
    ...(lines.length ? lines : ['- None on file']),
    '',
    'Gohil Investments',
    'Harshdipsinh Gohil — 7698997894',
    'Bhavnagar, Gujarat',
  ].filter(line => line !== undefined).join('\n')
}
