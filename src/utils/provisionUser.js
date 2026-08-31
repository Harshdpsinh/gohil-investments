// src/utils/provisionUser.js
// Pure checks for Manage Staff. The API writes Auth + Firestore; this
// module must stay free of firebase so the unit suite can run it.
import { VALID_ROLES } from './roles.js'

export function validateProvisionInput({ name, email, password, role } = {}, { passwordRequired = false } = {}) {
  const cleanName = String(name || '').trim()
  const cleanEmail = String(email || '').trim().toLowerCase()
  const cleanRole = String(role || '').trim().toLowerCase()
  const cleanPassword = String(password || '')

  if (!cleanName) throw new Error('Name is required.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('Enter a valid email address.')
  }
  if (!VALID_ROLES.includes(cleanRole)) {
    throw new Error('Role must be admin, staff or reader.')
  }
  if (passwordRequired && cleanPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }
  if (cleanPassword && cleanPassword.length < 8) {
    throw new Error('Password must be at least 8 characters.')
  }

  return { name: cleanName, email: cleanEmail, role: cleanRole, password: cleanPassword }
}

export function provisionProfileFields({ name, email, role }) {
  return { name, email, role }
}
