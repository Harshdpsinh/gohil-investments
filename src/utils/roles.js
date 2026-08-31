// src/utils/roles.js
// Single source of truth for CRM roles. useAuth, Admin Users, and tests
// import from here. Firestore rules duplicate the same strings — keep them in sync.
export const VALID_ROLES = ['admin', 'staff', 'reader']

export const OWNER_ADMIN_EMAILS = [
  'harshdeepgohil@gmail.com',
  'harshdpsinh@gmail.com',
]

export function ownerAdminEmails(extra = '') {
  const extras = String(extra || '')
    .split(',')
    .map(email => String(email || '').trim().toLowerCase())
    .filter(Boolean)
  return [...new Set([...OWNER_ADMIN_EMAILS, ...extras])]
}

export function normaliseRole(value, email = '', extraOwnerEmails = '') {
  const cleanRole = String(value || '').trim().toLowerCase()
  const cleanEmail = String(email || '').trim().toLowerCase()
  if (ownerAdminEmails(extraOwnerEmails).includes(cleanEmail)) return 'admin'
  if (VALID_ROLES.includes(cleanRole)) return cleanRole
  return ''
}

export function isWriteRole(role) {
  return role === 'admin' || role === 'staff'
}

export function isReadRole(role) {
  return isWriteRole(role) || role === 'reader'
}

export function roleLabel(role) {
  if (role === 'admin') return 'Admin'
  if (role === 'staff') return 'Staff'
  if (role === 'reader') return 'Reader'
  return 'Unprovisioned'
}
