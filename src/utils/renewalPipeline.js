// Kanban columns for the renewal pipeline. Computed from daysUntilPolicyDue —
// the same helper Renewals uses — so dragging is visual only; no policy fields
// are rewritten.
import { daysUntilPolicyDue } from './dateUtils.js'

const STOP_STATUSES = new Set(['Renewed-Out', 'Cancelled', 'Matured'])

export const PIPELINE_COLUMNS = [
  { id: '60', label: '60–31 days', hint: 'Start the conversation', min: 31, max: 60 },
  { id: '30', label: '30–16 days', hint: 'Quote and follow up', min: 16, max: 30 },
  { id: '15', label: '15–8 days', hint: 'Close this week', min: 8, max: 15 },
  { id: '7', label: '7–0 days', hint: 'Due now', min: 0, max: 7 },
  { id: 'overdue', label: 'Overdue', hint: 'Lapse risk', min: -99999, max: -1 },
]

export function pipelineColumnId(days) {
  if (days === null || days === undefined) return null
  if (days > 60) return null
  const col = PIPELINE_COLUMNS.find(c => days >= c.min && days <= c.max)
  return col ? col.id : null
}

export function groupRenewalPipeline(policies = [], asOf = new Date()) {
  const buckets = Object.fromEntries(PIPELINE_COLUMNS.map(c => [c.id, []]))
  for (const policy of policies) {
    if (STOP_STATUSES.has(String(policy.status || 'Active').trim())) continue
    if (policy.is_renewed) continue
    const days = daysUntilPolicyDue(policy, asOf)
    const column = pipelineColumnId(days)
    if (!column) continue
    buckets[column].push({ policy, days })
  }
  for (const col of PIPELINE_COLUMNS) {
    buckets[col.id].sort((a, b) => a.days - b.days)
  }
  return buckets
}

export function pipelineCounts(buckets) {
  return PIPELINE_COLUMNS.map(col => ({
    id: col.id,
    label: col.label,
    count: (buckets[col.id] || []).length,
  }))
}
