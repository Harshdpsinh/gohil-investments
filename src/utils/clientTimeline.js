// Builds a single client activity stream from records the CRM already stores.
// Pure — no firebase, no react. Pages pass in whatever they have loaded.
import { parseAnyDate } from './dateUtils.js'

function ts(value) {
  const date = parseAnyDate(value)
  if (date) return date.getTime()
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function iso(value) {
  const date = parseAnyDate(value)
  return date ? date.toISOString() : ''
}

/**
 * Merge policies, claims, WhatsApp rows, endorsements and handwritten notes
 * into one newest-first timeline. Unknown collections are ignored so a
 * partial load still renders.
 */
export function buildClientTimeline({
  client = null,
  policies = [],
  claims = [],
  messages = [],
  endorsements = [],
  notes = [],
} = {}) {
  const events = []
  const clientId = client?.id

  if (client?.createdAt) {
    events.push({
      id: `client-created-${clientId || 'x'}`,
      type: 'client',
      title: 'Client added',
      body: client.name || '',
      at: ts(client.createdAt),
      atLabel: iso(client.createdAt),
    })
  }

  for (const policy of policies) {
    if (clientId && policy.clientId && policy.clientId !== clientId) continue
    events.push({
      id: `policy-${policy.id}`,
      type: 'policy',
      title: policy.parentPolicyId || policy.policyYear > 1 ? 'Policy renewed' : 'Policy added',
      body: [policy.policyNumber, policy.insurer, policy.policyType].filter(Boolean).join(' · '),
      at: ts(policy.createdAt || policy.startDate),
      atLabel: iso(policy.createdAt || policy.startDate),
      href: '/policies',
    })
  }

  for (const claim of claims) {
    if (clientId && claim.clientId && claim.clientId !== clientId) continue
    events.push({
      id: `claim-${claim.id}`,
      type: 'claim',
      title: `Claim ${claim.status || 'opened'}`,
      body: [claim.claimNumber || claim.policyNumber, claim.insurer].filter(Boolean).join(' · '),
      at: ts(claim.intimationDate || claim.createdAt),
      atLabel: iso(claim.intimationDate || claim.createdAt),
      href: '/claims',
    })
  }

  for (const item of endorsements) {
    if (clientId && item.clientId && item.clientId !== clientId) continue
    events.push({
      id: `endorsement-${item.id}`,
      type: 'endorsement',
      title: item.type || 'Endorsement',
      body: item.summary || item.notes || item.policyNumber || '',
      at: ts(item.createdAt || item.effectiveDate),
      atLabel: iso(item.createdAt || item.effectiveDate),
    })
  }

  const mobileTail = String(client?.mobile || '').replace(/\D/g, '').slice(-10)
  for (const message of messages) {
    const waTail = String(message.waId || '').replace(/\D/g, '').slice(-10)
    if (mobileTail && waTail && waTail !== mobileTail) continue
    const inbound = message.direction === 'in'
    events.push({
      id: `wa-${message.id || message.messageId}`,
      type: inbound ? 'whatsapp-in' : 'whatsapp-out',
      title: inbound ? 'WhatsApp received' : 'WhatsApp sent',
      body: String(message.text || message.caption || '').slice(0, 160),
      at: Number(message.timestamp) || ts(message.createdAt),
      atLabel: '',
    })
  }

  for (const note of notes) {
    events.push({
      id: `note-${note.id}`,
      type: 'note',
      title: note.title || 'Note',
      body: note.body || '',
      at: ts(note.createdAt),
      atLabel: iso(note.createdAt),
      author: note.createdBy || '',
    })
  }

  return events
    .filter(event => event.at > 0)
    .sort((a, b) => b.at - a.at)
}

export const TIMELINE_TYPE_LABEL = {
  client: 'Client',
  policy: 'Policy',
  claim: 'Claim',
  endorsement: 'Endorsement',
  'whatsapp-in': 'WhatsApp',
  'whatsapp-out': 'WhatsApp',
  note: 'Note',
}
