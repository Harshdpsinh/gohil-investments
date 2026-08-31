// Explicit list of actions the overnight reader agent must never complete.
// Kept free of firebase/react so it can be unit-tested and copied into the
// morning review file without pulling in the app.

export const AGENT_ACTION_LOG = 'agent_action_log'

export const FORBIDDEN_ACTIONS = [
  { id: 'signin-privileged', label: 'Sign in as admin, staff, or an owner email', collection: 'auth' },
  { id: 'client-write', label: 'Create, update, merge, or delete a client', collection: 'clients' },
  { id: 'policy-write', label: 'Create, update, import, soft-delete, restore, or permanently delete a policy', collection: 'policies' },
  { id: 'premium-renew', label: 'Mark premium paid or save a renewal', collection: 'policies' },
  { id: 'commission-import', label: 'Import a commission statement', collection: 'commission_transactions' },
  { id: 'commission-manual', label: 'Add or edit a posted commission', collection: 'commission_transactions' },
  { id: 'commission-settle', label: 'Mark the existing book as paid', collection: 'commission_transactions' },
  { id: 'insurer-rewrite', label: 'Rewrite stored ICICI / ICIC names', collection: 'policies' },
  { id: 'claim-write', label: 'Create, update, or delete a claim', collection: 'claims' },
  { id: 'proposal-write', label: 'Create, update, or delete a proposal', collection: 'proposals' },
  { id: 'lead-write', label: 'Create, update, or delete a lead or follow-up', collection: 'leads' },
  { id: 'endorsement-write', label: 'Create, update, or delete an endorsement', collection: 'endorsements' },
  { id: 'file-write', label: 'Upload or delete a file in Storage', collection: 'storage' },
  { id: 'note-write', label: 'Add a client note, occasion log, or message log', collection: 'client_activities' },
  { id: 'report-filter', label: 'Save or delete a report filter', collection: 'reports_saved_filters' },
  { id: 'reminder-settings', label: 'Change renewal reminder settings', collection: 'renewal_reminder_settings' },
  { id: 'inbox-read-flag', label: 'Mark a WhatsApp thread read', collection: 'whatsapp_messages' },
  { id: 'whatsapp-send', label: 'Send WhatsApp (template or freeform)', collection: 'whatsapp_messages' },
  { id: 'user-admin', label: 'Create a user or change a role', collection: 'users' },
  { id: 'backup-restore', label: 'Restore a backup', collection: 'multiple' },
  { id: 'execute-action-file', label: 'Execute a row from OVERNIGHT_ACTIONS.md', collection: 'multiple' },
  { id: 'ship-to-main', label: 'Push or merge to main, deploy rules, or use the Admin SDK', collection: 'infra' },
]

export const WRITE_CONTROL_RE = /\b(save|create|add|delete|remove|import|merge|settle|upload|restore|renew|send|paid|post|edit)\b/i

export function isForbiddenClickLabel(text) {
  return WRITE_CONTROL_RE.test(String(text || ''))
}

export function isPermissionDenied(err) {
  const code = String(err?.code || '')
  const message = String(err?.message || '')
  return code === 'permission-denied'
    || code === 'storage/unauthorized'
    || /permission[- ]denied|insufficient permissions|unauthorized/i.test(message)
}

export function attemptPayload({ op, path, outcome, message, email, source }) {
  return {
    op: String(op || 'write').slice(0, 40),
    path: String(path || '').slice(0, 200),
    outcome: String(outcome || 'denied').slice(0, 40),
    message: String(message || '').slice(0, 300),
    email: String(email || '').slice(0, 120),
    source: String(source || 'app').slice(0, 40),
  }
}
