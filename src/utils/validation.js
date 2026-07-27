// src/utils/validation.js
// Pure validation and normalisation for records on their way into Firestore.
// Extracted from firebase/firestore.js so it can be unit tested without touching
// Firebase. Nothing in this file may import firebase or perform I/O — that is the
// whole point of it existing.
import { normaliseFrequency } from './dateUtils'

export const POLICY_TYPES = ['Health','Life','Motor','Home','Travel','Marine','Fire','Other']
export const POLICY_STATUSES = ['Active','Lapsed','Cancelled','Matured','Renewed-Out']
export const POLICY_FREQUENCIES = ['Yearly','Half-Yearly','Quarterly','Monthly']

export function cleanFirestoreData(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  )
}

export function assertPolicyDateOrder(startDate, expiryDate) {
  if (!startDate) throw new Error('Start date is required.')
  if (!expiryDate) throw new Error('Expiry date is required.')
  if (new Date(expiryDate) <= new Date(startDate)) {
    throw new Error('Expiry date must be after start date.')
  }
}

const POLICY_DUPLICATE_SYSTEM_FIELDS = new Set([
  'id', 'createdAt', 'updatedAt', 'deleted', 'deletedAt', 'renewedAt',
])

function comparablePolicyValue(value) {
  if (Array.isArray(value)) return value.map(comparablePolicyValue)
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().toISOString()
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, comparablePolicyValue(value[key])]))
  }
  return value
}

function comparablePolicyRecord(policy = {}) {
  return Object.fromEntries(
    Object.keys(policy)
      .filter(key => !POLICY_DUPLICATE_SYSTEM_FIELDS.has(key) && policy[key] !== undefined)
      .sort()
      .map(key => [key, comparablePolicyValue(policy[key])])
  )
}

export function exactPolicyKey(policy) {
  return JSON.stringify(comparablePolicyRecord(policy))
}

export function normalisePolicyPayload(data, { partial = false } = {}) {
  const next = { ...(data || {}) }
  ;['id', 'createdAt', 'updatedAt', 'deleted', 'deletedAt', 'renewedAt'].forEach(field => delete next[field])

  if (!partial || next.policyNumber !== undefined) {
    next.policyNumber = assertString(next.policyNumber, 'Policy number', 80)
  }
  if (!partial || next.clientId !== undefined) {
    if (!next.clientId) throw new Error('Client is required.')
  }
  if (next.clientName !== undefined) next.clientName = String(next.clientName || '').trim()
  if (next.clientMobile !== undefined) {
    assertOptionalMobile(next.clientMobile)
    next.clientMobile = String(next.clientMobile || '').trim()
  }
  if (next.clientEmail !== undefined) {
    assertOptionalEmail(next.clientEmail)
    next.clientEmail = String(next.clientEmail || '').trim().toLowerCase()
  }
  if (!partial && next.policyType === undefined) next.policyType = 'Health'
  if (!partial && next.status === undefined) next.status = 'Active'
  if (!partial && next.frequency === undefined) next.frequency = 'Yearly'
  if (next.policyType !== undefined) assertInList(next.policyType, POLICY_TYPES, 'Policy type')
  if (next.status !== undefined) assertInList(next.status || 'Active', POLICY_STATUSES, 'Policy status')
  if (next.frequency !== undefined) {
    next.frequency = normaliseFrequency(next.frequency)
    assertInList(next.frequency, POLICY_FREQUENCIES, 'Premium frequency')
  }
  if (next.isMultiYearPolicy !== undefined) {
    next.isMultiYearPolicy = Boolean(next.isMultiYearPolicy)
  }
  if (next.coverageTermYears !== undefined && next.coverageTermYears !== '') {
    const years = Number(next.coverageTermYears)
    if (!Number.isInteger(years) || years < 1 || years > 5) {
      throw new Error('Coverage term must be between 1 and 5 years.')
    }
    next.coverageTermYears = years
    next.isMultiYearPolicy = years > 1
  }
  if (next.insurer !== undefined && next.insurer !== null) next.insurer = String(next.insurer).trim()
  if (!partial && !next.insurer) throw new Error('Insurer is required.')

  assertOptionalNumber(next.premium, 'Premium', { min: 1, max: 1000000000 })
  assertOptionalNumber(next.fyCommission, 'FY commission', { min: 0, max: 100 })
  assertOptionalNumber(next.ryCommission, 'RY commission', { min: 0, max: 100 })
  assertOptionalNumber(next.sumInsured, 'Sum insured')
  assertOptionalNumber(next.sumAssured, 'Sum assured')
  assertOptionalNumber(next.idv, 'IDV')
  assertOptionalDate(next.startDate, 'Start date')
  assertOptionalDate(next.expiryDate, 'Expiry date')
  assertOptionalDate(next.nextPremiumDue, 'Premium due date')

  ;['planName', 'nominee', 'nomineeRelation', 'registrationNo', 'notes'].forEach(field => {
    if (next[field] !== undefined && next[field] !== null) next[field] = String(next[field]).trim()
  })
  if (next.registrationNo) next.registrationNo = next.registrationNo.toUpperCase()

  return cleanFirestoreData(next)
}

export function assertString(value, label, max = 200) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${label} is required.`)
  if (text.length > max) throw new Error(`${label} must be ${max} characters or less.`)
  return text
}

export function assertOptionalNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`)
  }
}

export function assertOptionalDate(value, label) {
  if (!value) return
  if (Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a valid date.`)
}

export function assertInList(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}.`)
  }
}

export function assertOptionalEmail(email) {
  if (!email) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    throw new Error('Email address is not valid.')
  }
}

export function assertOptionalMobile(mobile) {
  if (!mobile) return
  const digits = String(mobile).replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Mobile number must contain 10 to 15 digits.')
  }
}

export function policyIsActive(policy) {
  return !['Renewed-Out', 'Cancelled', 'Matured'].includes(String(policy?.status || 'Active').trim())
}
