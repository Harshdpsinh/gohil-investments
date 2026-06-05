// src/firebase/firestore.js
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc,
  deleteDoc, query, where, orderBy, serverTimestamp,
  onSnapshot, writeBatch, setDoc, limit, runTransaction, Timestamp
} from 'firebase/firestore'
import { db } from './config'
import { addFrequencyInterval, computeNextPolicyDue, getDueDate as getPolicyDueDate, normaliseFrequency, parseAnyDate, toInputDate } from '../utils/dateUtils'

const CLIENTS   = 'clients'
const POLICIES  = 'policies'
const PROPOSALS = 'proposals'
const DOCS_META = 'documents'
const USERS     = 'users'
const CLAIMS    = 'claims'
const TASKS     = 'tasks'
const CLIENT_FIELDS = [
  'name', 'mobile', 'email', 'pan', 'aadhar', 'dob', 'gender',
  'address', 'city', 'state', 'occupation', 'employment', 'income',
  'qualification', 'designation', 'kycStatus', 'notes',
]
const BACKUP_COLLECTIONS = [CLIENTS, POLICIES, PROPOSALS, CLAIMS, TASKS, USERS]

function serialiseBackupValue(value) {
  if (value === null || value === undefined) return value
  if (typeof value?.toDate === 'function' && typeof value.seconds === 'number') {
    return { __backupType: 'timestamp', iso: value.toDate().toISOString() }
  }
  if (value instanceof Date) {
    return { __backupType: 'timestamp', iso: value.toISOString() }
  }
  if (Array.isArray(value)) return value.map(serialiseBackupValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialiseBackupValue(v)]))
  }
  return value
}

function deserialiseBackupValue(value) {
  if (value === null || value === undefined) return value
  if (value?.__backupType === 'timestamp' && value.iso) {
    const date = new Date(value.iso)
    return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date)
  }
  if (Array.isArray(value)) return value.map(deserialiseBackupValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deserialiseBackupValue(v)]))
  }
  return value
}

async function commitBackupWritesInChunks(writes, onProgress = () => {}) {
  let done = 0
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db)
    const chunk = writes.slice(i, i + 400)
    chunk.forEach(({ ref, data }) => batch.set(ref, data, { merge: true }))
    await batch.commit()
    done += chunk.length
    onProgress(done, writes.length)
  }
}

export async function createCRMBackup() {
  const collections = {}
  const totals = {}

  for (const name of BACKUP_COLLECTIONS) {
    const snap = await getDocs(collection(db, name))
    collections[name] = snap.docs.map(d => ({
      id: d.id,
      data: serialiseBackupValue(d.data()),
    }))
    totals[name] = snap.size
  }

  const clientDocuments = []
  for (const client of collections[CLIENTS] || []) {
    const snap = await getDocs(collection(db, CLIENTS, client.id, DOCS_META))
    snap.docs.forEach(d => {
      clientDocuments.push({
        clientId: client.id,
        id: d.id,
        data: serialiseBackupValue(d.data()),
      })
    })
  }
  totals.clientDocuments = clientDocuments.length

  return {
    app: 'gohil-investments-crm',
    version: 1,
    createdAt: new Date().toISOString(),
    totals,
    collections,
    subcollections: {
      clientDocuments,
    },
  }
}

export async function restoreCRMBackup(backup, onProgress = () => {}) {
  if (!backup || backup.app !== 'gohil-investments-crm' || !backup.collections) {
    throw new Error('This backup file is not a valid Gohil Investments CRM backup.')
  }

  const writes = []
  for (const name of BACKUP_COLLECTIONS) {
    const records = backup.collections[name] || []
    records.forEach(record => {
      if (!record?.id || !record.data) return
      writes.push({
        ref: doc(db, name, record.id),
        data: deserialiseBackupValue(record.data),
      })
    })
  }

  ;(backup.subcollections?.clientDocuments || []).forEach(record => {
    if (!record?.clientId || !record?.id || !record.data) return
    writes.push({
      ref: doc(db, CLIENTS, record.clientId, DOCS_META, record.id),
      data: deserialiseBackupValue(record.data),
    })
  })

  if (writes.length === 0) throw new Error('Backup file does not contain any records to restore.')
  await commitBackupWritesInChunks(writes, onProgress)
  return writes.length
}

// ── USER ROLES ────────────────────────────────────────────────
export async function getUserRole(uid) {
  try { const s = await getDoc(doc(db,USERS,uid)); return s.exists() ? s.data() : null } catch { return null }
}

export async function setUserRole(uid, data) {
  return setDoc(doc(db,USERS,uid), { ...data, updatedAt: serverTimestamp() }, { merge: true })
}
export async function getAllUsers() {
  const s = await getDocs(collection(db,USERS))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}

// ── CLIENTS ───────────────────────────────────────────────────
export const clientsRef = () => collection(db, CLIENTS)

const CLIENT_KYC_OPTIONS = ['Pending', 'In Progress', 'Complete']
const CLIENT_GENDER_OPTIONS = ['Male', 'Female', 'Other']

function normaliseClientPayload(data, { partial = false } = {}) {
  const next = Object.fromEntries(
    CLIENT_FIELDS
      .filter(field => Object.prototype.hasOwnProperty.call(data || {}, field))
      .map(field => [field, data[field]])
  )

  if (!partial || next.name !== undefined) next.name = assertString(next.name, 'Client name', 120)
  if (next.email !== undefined) {
    assertOptionalEmail(next.email)
    next.email = String(next.email || '').trim().toLowerCase()
  }
  if (next.mobile !== undefined) {
    assertOptionalMobile(next.mobile)
    next.mobile = String(next.mobile || '').trim()
  }
  if (next.dob !== undefined) assertOptionalDate(next.dob, 'Date of birth')
  if (next.gender) assertInList(next.gender, CLIENT_GENDER_OPTIONS, 'Gender')
  if (next.kycStatus) assertInList(next.kycStatus, CLIENT_KYC_OPTIONS, 'KYC status')
  if (next.income !== undefined) assertOptionalNumber(next.income, 'Annual income')

  if (next.pan) {
    next.pan = String(next.pan).trim().toUpperCase()
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(next.pan)) {
      throw new Error('PAN must be in format ABCDE1234F.')
    }
  }
  if (next.aadhar) {
    const digits = String(next.aadhar).replace(/\D/g, '')
    if (digits.length !== 12) throw new Error('Aadhar must contain exactly 12 digits.')
    next.aadhar = digits
  }

  ;['address', 'city', 'state', 'occupation', 'employment', 'qualification', 'designation', 'notes'].forEach(field => {
    if (next[field] !== undefined && next[field] !== null) {
      next[field] = String(next[field]).trim()
    }
  })

  return cleanFirestoreData(next)
}

export async function addClient(data) {
  const payload = normaliseClientPayload(data)
  return addDoc(clientsRef(), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}
export async function getClient(id) {
  const s = await getDoc(doc(db,CLIENTS,id))
  return s.exists() ? { id:s.id, ...s.data() } : null
}
export async function getAllClients() {
  const s = await getDocs(query(clientsRef(), orderBy('createdAt','desc')))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}
export async function updateClient(id, data) {
  const payload = normaliseClientPayload(data, { partial: true })
  return updateDoc(doc(db,CLIENTS,id), { ...payload, updatedAt: serverTimestamp() })
}

async function deleteRefsInChunks(refs) {
  const uniqueRefs = [...new Map(refs.map(ref => [ref.path, ref])).values()]
  for (let i = 0; i < uniqueRefs.length; i += 400) {
    const batch = writeBatch(db)
    uniqueRefs.slice(i, i + 400).forEach(ref => batch.delete(ref))
    await batch.commit()
  }
}

async function policyCascadeRefs(policyId) {
  if (!policyId) return []
  const [claimsByPolicy, tasksByPolicy] = await Promise.all([
    getDocs(query(collection(db, CLAIMS), where('policyId', '==', policyId))),
    getDocs(query(collection(db, TASKS),  where('policyId', '==', policyId))),
  ])
  return [
    ...claimsByPolicy.docs.map(d => d.ref),
    ...tasksByPolicy.docs.map(d => d.ref),
    doc(db, POLICIES, policyId),
  ]
}

async function cascadeUpdatePolicyLinks(policyId, policyData = {}) {
  if (!policyId) return
  const linkedUpdate = {}
  const copyFields = [
    'policyNumber',
    'policyType',
    'insurer',
    'clientId',
    'clientName',
    'clientMobile',
    'clientEmail',
  ]
  copyFields.forEach(field => {
    if (policyData[field] !== undefined) linkedUpdate[field] = policyData[field]
  })
  if (Object.keys(linkedUpdate).length === 0) return

  linkedUpdate.updatedAt = serverTimestamp()
  const [claimsByPolicy, tasksByPolicy] = await Promise.all([
    getDocs(query(collection(db, CLAIMS), where('policyId', '==', policyId))),
    getDocs(query(collection(db, TASKS),  where('policyId', '==', policyId))),
  ])
  const refs = [
    ...claimsByPolicy.docs.map(d => d.ref),
    ...tasksByPolicy.docs.map(d => d.ref),
  ]

  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db)
    refs.slice(i, i + 400).forEach(ref => batch.update(ref, linkedUpdate))
    await batch.commit()
  }
}

/**
 * cascadeUpdateClient(id, data)
 * Updates the client record AND propagates name/mobile/email changes
 * to every linked policy, claim, and task. Uses chunked batches of
 * 400 to stay well under Firestore's 500-write-per-batch limit.
 */
export async function cascadeUpdateClient(id, data) {
  const payload = normaliseClientPayload(data, { partial: true })

  async function commitInChunks(pairs) {
    for (let i = 0; i < pairs.length; i += 400) {
      const b = writeBatch(db)
      pairs.slice(i, i + 400).forEach(({ ref, upd }) => b.update(ref, upd))
      await b.commit()
    }
  }

  const clientBatch = writeBatch(db)
  clientBatch.update(doc(db, CLIENTS, id), { ...payload, updatedAt: serverTimestamp() })
  await clientBatch.commit()

  const hasName   = !!payload.name
  const hasMobile = payload.mobile !== undefined
  const hasEmail  = payload.email  !== undefined

  if (hasName || hasMobile || hasEmail) {
    const [pols, cls, tsk] = await Promise.all([
      getDocs(query(collection(db, POLICIES), where('clientId', '==', id))),
      getDocs(query(collection(db, CLAIMS),   where('clientId', '==', id))),
      getDocs(query(collection(db, TASKS),    where('clientId', '==', id))),
    ])

    const polPairs = pols.docs.map(d => {
      const upd = { updatedAt: serverTimestamp() }
      if (hasName)   upd.clientName   = payload.name
      if (hasMobile) upd.clientMobile = payload.mobile
      if (hasEmail)  upd.clientEmail  = payload.email
      return { ref: d.ref, upd }
    })
    const clsPairs = cls.docs.map(d => {
      const upd = { updatedAt: serverTimestamp() }
      if (hasName)   upd.clientName   = payload.name
      if (hasMobile) upd.clientMobile = payload.mobile
      return { ref: d.ref, upd }
    })
    const tskPairs = tsk.docs.map(d => {
      const upd = { updatedAt: serverTimestamp() }
      if (hasName) upd.clientName = payload.name
      return { ref: d.ref, upd }
    })

    await commitInChunks([...polPairs, ...clsPairs, ...tskPairs])
  }
}

export async function deleteClient(id) {
  const [pols, cls, tsk, docs] = await Promise.all([
    getDocs(query(collection(db, POLICIES), where('clientId', '==', id))),
    getDocs(query(collection(db, CLAIMS),   where('clientId', '==', id))),
    getDocs(query(collection(db, TASKS),    where('clientId', '==', id))),
    getDocs(collection(db, CLIENTS, id, DOCS_META)),
  ])
  const policyLinkedRefs = (await Promise.all(pols.docs.map(d => policyCascadeRefs(d.id)))).flat()

  await deleteRefsInChunks([
    ...policyLinkedRefs,
    ...pols.docs.map(d => d.ref),
    ...cls.docs.map(d => d.ref),
    ...tsk.docs.map(d => d.ref),
    ...docs.docs.map(d => d.ref),
    doc(db, CLIENTS, id),
  ])
}

export async function bulkDeleteClients(ids) {
  const allRefs = []
  for (const id of ids) {
    const [pols, cls, tsk, docs] = await Promise.all([
      getDocs(query(collection(db, POLICIES), where('clientId', '==', id))),
      getDocs(query(collection(db, CLAIMS),   where('clientId', '==', id))),
      getDocs(query(collection(db, TASKS),    where('clientId', '==', id))),
      getDocs(collection(db, CLIENTS, id, DOCS_META)),
    ])
    const policyLinkedRefs = (await Promise.all(pols.docs.map(d => policyCascadeRefs(d.id)))).flat()
    allRefs.push(
      ...policyLinkedRefs,
      ...pols.docs.map(d => d.ref),
      ...cls.docs.map(d => d.ref),
      ...tsk.docs.map(d => d.ref),
      ...docs.docs.map(d => d.ref),
      doc(db, CLIENTS, id),
    )
  }
  await deleteRefsInChunks(allRefs)
}

// ── CLIMER — CLIENT MERGER MODULE ─────────────────────────────
export async function mergeClients(duplicateId, masterId) {
  if (!duplicateId || !masterId) throw new Error('Both duplicate and master IDs required')
  if (duplicateId === masterId) throw new Error('Cannot merge a client into itself')

  const master = await getClient(masterId)
  if (!master) throw new Error('Master client not found')
  const dup = await getClient(duplicateId)
  if (!dup) throw new Error('Duplicate client not found')

  const [dupPolicies, dupClaims, dupTasks, dupDocs] = await Promise.all([
    getDocs(query(collection(db, POLICIES), where('clientId', '==', duplicateId))),
    getDocs(query(collection(db, CLAIMS),   where('clientId', '==', duplicateId))),
    getDocs(query(collection(db, TASKS),    where('clientId', '==', duplicateId))),
    getDocs(collection(db, CLIENTS, duplicateId, DOCS_META)),
  ])

  const ops = []

  dupPolicies.docs.forEach(d => {
    ops.push({ ref: d.ref, data: {
      clientId:     masterId,
      clientName:   master.name,
      clientMobile: master.mobile || dup.mobile || '',
      clientEmail:  master.email  || dup.email  || '',
      updatedAt:    serverTimestamp(),
    }})
  })
  dupClaims.docs.forEach(d => {
    ops.push({ ref: d.ref, data: {
      clientId:   masterId,
      clientName: master.name,
      updatedAt:  serverTimestamp(),
    }})
  })
  dupTasks.docs.forEach(d => {
    ops.push({ ref: d.ref, data: {
      clientId:   masterId,
      clientName: master.name,
      updatedAt:  serverTimestamp(),
    }})
  })

  const chunks = []
  for (let i = 0; i < ops.length; i += 400) chunks.push(ops.slice(i, i + 400))
  for (const chunk of chunks) {
    const batch = writeBatch(db)
    chunk.forEach(({ ref, data }) => batch.update(ref, data))
    await batch.commit()
  }

  let docsMoved = 0
  for (const docSnap of dupDocs.docs) {
    const docData = docSnap.data()
    await addDoc(collection(db, CLIENTS, masterId, DOCS_META), {
      ...docData,
      movedFromClient: duplicateId,
      movedAt: serverTimestamp(),
    })
    await deleteDoc(doc(db, CLIENTS, duplicateId, DOCS_META, docSnap.id))
    docsMoved++
  }

  await deleteDoc(doc(db, CLIENTS, duplicateId))

  return {
    policiesMoved: dupPolicies.size,
    claimsMoved:   dupClaims.size,
    tasksMoved:    dupTasks.size,
    docsMoved,
  }
}

export async function bulkMergeClients(duplicateIds, masterId) {
  if (!masterId) throw new Error('Master client ID required')
  if (!duplicateIds?.length) throw new Error('No duplicate IDs provided')
  const filtered = duplicateIds.filter(id => id !== masterId)
  if (!filtered.length) throw new Error('No valid duplicates to merge')

  const results = []
  for (const dupId of filtered) {
    try {
      const result = await mergeClients(dupId, masterId)
      results.push({ duplicateId: dupId, success: true, ...result })
    } catch (err) {
      results.push({ duplicateId: dupId, success: false, error: err.message })
    }
  }
  return results
}

// ── FIX BUG 2: All subscribe functions now accept an optional onError callback.
// Without an error callback, onSnapshot errors are silently swallowed by Firebase,
// causing loading states to hang forever when connectivity is interrupted.
// ─────────────────────────────────────────────────────────────────────────────
export function subscribeClients(callback, onError) {
  return onSnapshot(
    query(clientsRef(), orderBy('createdAt','desc')),
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() }))),
    onError || (err => console.error('subscribeClients:', err.code, err.message))
  )
}

export async function findClientByMobileOrName(mobile, name) {
  const allS = await getDocs(clientsRef())
  const clients = allS.docs
    .map(d => ({ id:d.id, ...d.data() }))
    .filter(c => !c.deleted)
  const clean = (mobile||'').replace(/\D/g,'').slice(-10)
  if (clean.length >= 10) {
    const m = clients.find(c => (c.mobile||'').replace(/\D/g,'').slice(-10) === clean)
    if (m) return m
  }
  if (name?.trim()) {
    const m = clients.find(c => (c.name||'').toLowerCase().trim() === name.toLowerCase().trim())
    if (m) return m
  }
  return null
}

// ── POLICIES ──────────────────────────────────────────────────
export const policiesRef = () => collection(db, POLICIES)
const POLICY_TYPES = ['Health','Life','Motor','Home','Travel','Marine','Fire','Other']
const POLICY_STATUSES = ['Active','Lapsed','Cancelled','Matured','Renewed-Out']
const POLICY_FREQUENCIES = ['Yearly','Half-Yearly','Quarterly','Monthly']

function _nextDueStr(startDate, frequency) {
  return toInputDate(computeNextPolicyDue({ startDate, frequency })) || null
}

function _policyDueStr(policy) {
  const expiry = parseAnyDate(policy.expiryDate)
  const isLifePolicy = String(policy.policyType || '').trim().toLowerCase() === 'life'
  if (!isLifePolicy && expiry) return toInputDate(expiry)
  const due = computeNextPolicyDue(policy)
  if (!due) return null
  return toInputDate(due)
}

function resolvePolicyDueStr(policy) {
  const isLifePolicy = String(policy?.policyType || '').trim().toLowerCase() === 'life'
  return isLifePolicy
    ? (toInputDate(policy?.nextPremiumDue) || _policyDueStr(policy))
    : _policyDueStr(policy)
}

function cleanFirestoreData(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  )
}

function assertPolicyDateOrder(startDate, expiryDate) {
  if (!startDate) throw new Error('Start date is required.')
  if (!expiryDate) throw new Error('Expiry date is required.')
  if (new Date(expiryDate) <= new Date(startDate)) {
    throw new Error('Expiry date must be after start date.')
  }
}

async function assertUniquePolicyNumber(policyNumber, currentId = null) {
  const number = String(policyNumber || '').trim()
  if (!number) return
  const s = await getDocs(query(policiesRef(), where('policyNumber', '==', number), limit(5)))
  const duplicate = s.docs.find(d => d.id !== currentId && !d.data().deleted)
  if (duplicate) throw new Error(`Policy number "${number}" already exists.`)
}

function normalisePolicyPayload(data, { partial = false } = {}) {
  const next = { ...data }

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

function assertString(value, label, max = 200) {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${label} is required.`)
  if (text.length > max) throw new Error(`${label} must be ${max} characters or less.`)
  return text
}

function assertOptionalNumber(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return
  const n = Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`)
  }
}

function assertOptionalDate(value, label) {
  if (!value) return
  if (Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a valid date.`)
}

function assertInList(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}.`)
  }
}

function assertOptionalEmail(email) {
  if (!email) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    throw new Error('Email address is not valid.')
  }
}

function assertOptionalMobile(mobile) {
  if (!mobile) return
  const digits = String(mobile).replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Mobile number must contain 10 to 15 digits.')
  }
}

function policyIsActive(policy) {
  return !['Renewed-Out', 'Cancelled', 'Matured'].includes(String(policy?.status || 'Active').trim())
}

function policySortTime(policy) {
  return parseAnyDate(policy?.createdAt)?.getTime()
    || parseAnyDate(policy?.startDate)?.getTime()
    || parseAnyDate(policy?.expiryDate)?.getTime()
    || 0
}

async function syncClientPolicySummary(clientId, policyHint = {}) {
  if (!clientId) return
  const clientRef = doc(db, CLIENTS, clientId)
  const [clientSnap, policiesSnap] = await Promise.all([
    getDoc(clientRef),
    getDocs(query(collection(db, POLICIES), where('clientId', '==', clientId))),
  ])
  if (!clientSnap.exists()) return

  const policies = policiesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => !p.deleted)
  const active = policies.filter(policyIsActive)
  const latest = [...active].sort((a, b) => policySortTime(b) - policySortTime(a))[0] || null
  const client = clientSnap.data() || {}
  const update = {
    policyCount: policies.length,
    activePolicyCount: active.length,
    latestPolicyId: latest?.id || '',
    latestPolicyNumber: latest?.policyNumber || '',
    latestPolicyType: latest?.policyType || '',
    latestPolicyInsurer: latest?.insurer || '',
    latestPolicyExpiryDate: latest?.expiryDate || '',
    latestPolicyDueDate: latest ? (resolvePolicyDueStr(latest) || '') : '',
    updatedAt: serverTimestamp(),
  }

  if (!client.mobile && policyHint.clientMobile) update.mobile = String(policyHint.clientMobile).trim()
  if (!client.email && policyHint.clientEmail) update.email = String(policyHint.clientEmail).trim().toLowerCase()

  await setDoc(clientRef, cleanFirestoreData(update), { merge: true })
}

export async function addPolicy(data) {
  const payload = normalisePolicyPayload(data)
  assertPolicyDateOrder(payload.startDate, payload.expiryDate)
  await assertUniquePolicyNumber(payload.policyNumber)
  const nextPremiumDue = resolvePolicyDueStr(payload)
  const ref = await addDoc(policiesRef(), cleanFirestoreData({
    ...payload,
    parentPolicyId: payload.parentPolicyId || null,
    policyYear:     payload.policyYear     || 1,
    nextPremiumDue: nextPremiumDue || null,
    renewedAt:      null,
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp()
  }))
  await syncClientPolicySummary(payload.clientId, payload)
  return ref
}

export async function importPoliciesBatch(rows, onProgress = () => {}) {
  const prepared = []
  const seenPolicyNumbers = new Set()
  for (const row of rows) {
    const payload = normalisePolicyPayload(row)
    assertPolicyDateOrder(payload.startDate, payload.expiryDate)
    const policyKey = String(payload.policyNumber || '').trim().toLowerCase()
    if (seenPolicyNumbers.has(policyKey)) throw new Error(`Policy number "${payload.policyNumber}" appears more than once in this import.`)
    seenPolicyNumbers.add(policyKey)
    await assertUniquePolicyNumber(payload.policyNumber)
    prepared.push({
      ...payload,
      parentPolicyId: payload.parentPolicyId || null,
      policyYear:     payload.policyYear     || 1,
      nextPremiumDue: resolvePolicyDueStr(payload) || null,
      deleted:        false,
      deletedAt:      null,
      renewedAt:      null,
      createdAt:      serverTimestamp(),
      updatedAt:      serverTimestamp(),
    })
  }

  let imported = 0
  for (let i = 0; i < prepared.length; i += 400) {
    const batch = writeBatch(db)
    const chunk = prepared.slice(i, i + 400)
    chunk.forEach(payload => batch.set(doc(policiesRef()), cleanFirestoreData(payload)))
    await batch.commit()
    imported += chunk.length
    onProgress(imported, prepared.length)
  }
  const clientIds = [...new Set(prepared.map(p => p.clientId).filter(Boolean))]
  for (const clientId of clientIds) {
    const hint = prepared.find(p => p.clientId === clientId) || {}
    await syncClientPolicySummary(clientId, hint)
  }
  return imported
}
export async function getPolicy(id) {
  const s = await getDoc(doc(db,POLICIES,id))
  return s.exists() ? { id:s.id, ...s.data() } : null
}
export async function getAllPolicies() {
  const s = await getDocs(query(policiesRef(), orderBy('expiryDate','asc')))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}
export async function updatePolicy(id, data) {
  const payload = normalisePolicyPayload(data, { partial: true })
  const existingSnap = await getDoc(doc(db, POLICIES, id))
  const existing = existingSnap.data() || {}
  if ((data.startDate && data.expiryDate) || data.startDate || data.expiryDate) {
    assertPolicyDateOrder(payload.startDate || existing.startDate, payload.expiryDate || existing.expiryDate)
  }
  if (payload.policyNumber !== undefined) await assertUniquePolicyNumber(payload.policyNumber, id)
  const update = { ...payload, updatedAt: serverTimestamp() }
  const mergedPolicy = { ...existing, ...payload }
  const isLifePolicy = String(mergedPolicy.policyType || '').trim().toLowerCase() === 'life'
  if (!isLifePolicy) update.nextPremiumDue = _policyDueStr(mergedPolicy) || null
  if (payload.nextPremiumDue === undefined && (payload.startDate || payload.frequency)) {
    if (!existing.nextPremiumDue) {
      const start = payload.startDate || existing.startDate
      const freq  = payload.frequency || existing.frequency
      update.nextPremiumDue = _policyDueStr({ ...existing, ...payload, startDate: start, frequency: freq }) || null
    }
  }
  await updateDoc(doc(db,POLICIES,id), update)
  await cascadeUpdatePolicyLinks(id, update)
  const clientIds = [...new Set([existing.clientId, update.clientId].filter(Boolean))]
  for (const clientId of clientIds) {
    await syncClientPolicySummary(clientId, { ...existing, ...update })
  }
}
// ── SOFT DELETE — marks policy as deleted instead of removing it.
//    Accounted deletes can always be undone from the Recycle Bin.
// FIX: use setDoc+merge — updateDoc throws "No document to update" when
// local React state is stale (same root cause as the renewal error).
export async function deletePolicy(id) {
  const snap = await getDoc(doc(db, POLICIES, id))
  const policy = snap.exists() ? { id: snap.id, ...snap.data() } : null
  await setDoc(doc(db, POLICIES, id), {
    deleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
  if (policy?.clientId) await syncClientPolicySummary(policy.clientId, policy)
}

export async function bulkDeletePolicies(ids) {
  const policies = []
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db)
    for (const id of ids.slice(i, i + 400)) {
      const snap = await getDoc(doc(db, POLICIES, id))
      if (snap.exists()) policies.push({ id: snap.id, ...snap.data() })
      batch.set(doc(db, POLICIES, id), {
        deleted: true,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })
    }
    await batch.commit()
  }
  const clientIds = [...new Set(policies.map(p => p.clientId).filter(Boolean))]
  for (const clientId of clientIds) await syncClientPolicySummary(clientId)
}

// ── RECYCLE BIN: fetch all soft-deleted policies ──────────────
export async function getDeletedPolicies() {
  const s = await getDocs(query(policiesRef(), where('deleted', '==', true)))
  return s.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── RESTORE: remove the deleted flag ─────────────────────────
// FIX: setDoc+merge — same reason as deletePolicy above.
export async function restorePolicy(id) {
  await setDoc(doc(db, POLICIES, id), {
    deleted:   false,
    deletedAt: null,
    updatedAt: serverTimestamp(),
  }, { merge: true })
  const policy = await getPolicy(id)
  if (policy?.clientId) await syncClientPolicySummary(policy.clientId, policy)
}

// ── PERMANENT DELETE: only when explicitly chosen in Recycle Bin ──
export async function permanentDeletePolicy(id) {
  const policy = await getPolicy(id)
  await deleteRefsInChunks(await policyCascadeRefs(id))
  if (policy?.clientId) await syncClientPolicySummary(policy.clientId, policy)
}

export async function checkDuplicate(data) {
  const { policyNumber, registrationNo } = data

  if (policyNumber?.trim()) {
    const s = await getDocs(query(policiesRef(), where('policyNumber', '==', policyNumber.trim()), limit(5)))
    const match = s.docs.find(d => !d.data().deleted)
    if (match) return { isDup: true, reason: `Policy number "${policyNumber}" already exists`, existing: { id: match.id, ...match.data() } }
  }
  if (registrationNo?.trim()) {
    const s = await getDocs(query(policiesRef(), where('registrationNo', '==', registrationNo.trim()), limit(5)))
    const match = s.docs.find(d => !d.data().deleted)
    if (match) return { isDup: true, reason: `Registration number "${registrationNo}" already exists`, existing: { id: match.id, ...match.data() } }
  }
  return { isDup: false, reason: '', existing: null }
}

export async function checkDuplicatePolicyNumber(policyNumber, currentId = null) {
  if (!policyNumber?.trim()) return false
  const s = await getDocs(query(policiesRef(), where('policyNumber', '==', policyNumber.trim()), limit(5)))
  return s.docs.some(d => d.id !== currentId && !d.data().deleted)
}

// FIX BUG 2: error callback added
export function subscribePolicies(callback, onError) {
  return onSnapshot(
    query(policiesRef(), orderBy('expiryDate','asc')),
    // Filter out soft-deleted policies client-side (avoids needing a composite index)
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() })).filter(p => !p.deleted)),
    onError || (err => console.error('subscribePolicies:', err.code, err.message))
  )
}

export async function savePolicyPdfUrl(policyId, url, name, storagePath = '', storageBucket = '') {
  return updateDoc(doc(db,POLICIES,policyId), {
    policyPdfUrl: url,
    policyPdfName: name,
    policyPdfStoragePath: storagePath || null,
    policyPdfStorageBucket: storageBucket || null,
    updatedAt: serverTimestamp()
  })
}

// ── RENEWAL VERSIONING ────────────────────────────────────────
/**
 * saveRenewal(oldPolicyId, newData)
 *
 * Atomically closes the old policy term and creates the renewed one
 * in a transaction. The deterministic child ID prevents duplicate renewed
 * policies if the user double-clicks or the request is retried.
 *
 * newData must include:
 *   - newPolicyNumber  {string}  — new policy number (blank = keep same)
 *   - startDate        {string}  — new term start (YYYY-MM-DD)
 *   - expiryDate       {string}  — new term expiry (YYYY-MM-DD)
 *   - frequency        {string}  — payment frequency
 *   - ...all other policy fields to carry forward
 */
export async function saveRenewal(oldPolicyId, newData) {
  const oldRef = doc(db, POLICIES, oldPolicyId)
  const newRef = doc(db, POLICIES, `${oldPolicyId}_renewal`)

  assertPolicyDateOrder(newData.startDate, newData.expiryDate)
  const requestedPolicyNumber = (newData.newPolicyNumber || '').trim()
  if (requestedPolicyNumber) {
    const dupSnap = await getDocs(query(policiesRef(), where('policyNumber', '==', requestedPolicyNumber), limit(5)))
    const duplicate = dupSnap.docs.find(d => d.id !== oldPolicyId && d.id !== newRef.id && !d.data().deleted)
    if (duplicate) {
      throw new Error(`Policy number "${requestedPolicyNumber}" already exists. Use a unique renewal policy number or leave it blank to keep the existing number.`)
    }
  }

  const ref = await runTransaction(db, async tx => {
    const oldSnap = await tx.get(oldRef)
    if (!oldSnap.exists()) throw new Error('Original policy not found.')

    const old = { id: oldSnap.id, ...oldSnap.data() }
    if ((old.status || '').trim() === 'Renewed-Out' || old.is_renewed) {
      throw new Error('This policy has already been renewed. Refresh the page to see the new policy.')
    }

    const existingNewSnap = await tx.get(newRef)
    if (existingNewSnap.exists()) {
      throw new Error('A renewal record already exists for this policy. Refresh the page before trying again.')
    }

    const { newPolicyNumber, id, renewedAt, renewedToPolicyNumber, deleted, deletedAt, ...restData } = newData
    const policyNumber = (newPolicyNumber || restData.policyNumber || old.policyNumber || '').trim()
    if (!policyNumber) throw new Error('New policy number is required.')
    if (!restData.clientId) throw new Error('Renewal must be linked to a client.')

    const policyPayload = normalisePolicyPayload({
      ...restData,
      policyNumber,
      status: 'Active',
    })
    assertPolicyDateOrder(policyPayload.startDate, policyPayload.expiryDate)
    const newNextPremiumDue = policyPayload.nextPremiumDue || _policyDueStr(policyPayload)

    tx.update(oldRef, {
      status:                'Renewed-Out',
      is_renewed:            true,
      renewedAt:             serverTimestamp(),
      renewedToPolicyId:     newRef.id,
      renewedToPolicyNumber: policyNumber,
      updatedAt:             serverTimestamp(),
    })

    tx.set(newRef, cleanFirestoreData({
      ...policyPayload,
      parentPolicyId:       oldPolicyId,
      renewedFromPolicyId:  oldPolicyId,
      policyYear:           (old.policyYear || 1) + 1,
      nextPremiumDue:       newNextPremiumDue || null,
      status:               'Active',
      is_renewed:           false,
      renewedAt:            null,
      renewedToPolicyId:    null,
      renewedToPolicyNumber:null,
      deleted:              false,
      deletedAt:            null,
      createdAt:            serverTimestamp(),
      updatedAt:            serverTimestamp(),
    }))

    return newRef
  })
  await syncClientPolicySummary(newData.clientId, newData)
  return ref
}

export async function markPremiumPaid(policyId, options = {}) {
  const policyRef = doc(db, POLICIES, policyId)

  const ref = await runTransaction(db, async tx => {
    const snap = await tx.get(policyRef)
    if (!snap.exists()) throw new Error('Policy not found.')

    const policy = { id: snap.id, ...snap.data() }
    if ((policy.status || '').trim() === 'Renewed-Out' || policy.is_renewed) {
      throw new Error('This policy has already been renewed. Refresh the page before updating premium dues.')
    }

    const currentDue = toInputDate(options.currentDue) || getPolicyDueDate(policy) || policy.nextPremiumDue || _policyDueStr(policy)
    if (!currentDue) throw new Error('Could not calculate this policy premium due date.')

    const nextFrequency = options.frequency !== undefined
      ? normaliseFrequency(options.frequency)
      : normaliseFrequency(policy.frequency)

    const manualNextDue = toInputDate(options.nextPremiumDue)
    const nextInstallmentDue = manualNextDue
      ? parseAnyDate(manualNextDue)
      : addFrequencyInterval(currentDue, nextFrequency)
    if (!nextInstallmentDue) throw new Error('Could not calculate next premium due date.')

    const expiry = parseAnyDate(policy.expiryDate)
    const isLifePolicy = String(policy.policyType || '').trim().toLowerCase() === 'life'
    if (!isLifePolicy && expiry && nextInstallmentDue > expiry) {
      throw new Error('Premium due date cannot be after policy expiry for non-life policies. Use Renew instead.')
    }

    tx.update(policyRef, {
      frequency: nextFrequency,
      lastPremiumPaidAt: serverTimestamp(),
      lastPremiumPaidDueDate: currentDue,
      nextPremiumDue: toInputDate(nextInstallmentDue),
      updatedAt: serverTimestamp(),
    })

    return policyRef
  })
  const policy = await getPolicy(policyId)
  if (policy?.clientId) await syncClientPolicySummary(policy.clientId, policy)
  return ref
}

export async function getPolicyChain(policyId) {
  const current = await getPolicy(policyId)
  if (!current) return { current: null, previous: null }
  const previous = current.parentPolicyId ? await getPolicy(current.parentPolicyId) : null
  return { current, previous }
}

// ── PROPOSALS ─────────────────────────────────────────────────
export const proposalsRef = () => collection(db, PROPOSALS)
function normaliseProposalPayload(data, { partial = false } = {}) {
  const next = { ...data }
  if (!partial || next.proposerName !== undefined) next.proposerName = assertString(next.proposerName, 'Proposer name', 120)
  if (next.email !== undefined && next.email !== '') {
    next.email = String(next.email).trim().toLowerCase()
    assertOptionalEmail(next.email)
  }
  if (next.mobile !== undefined && next.mobile !== '') {
    const digits = String(next.mobile).replace(/\D/g, '')
    const national = digits.startsWith('91') && digits.length > 10
      ? digits.slice(2)
      : digits.startsWith('0') && digits.length === 11
        ? digits.slice(1)
        : digits
    if (national.length !== 10 || !/^[6-9]\d{9}$/.test(national)) {
      throw new Error('Mobile number must be a valid 10 digit Indian number.')
    }
    next.mobile = national
  }
  if (next.pan !== undefined && next.pan !== '') {
    next.pan = String(next.pan).trim().toUpperCase()
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(next.pan)) throw new Error('PAN number is not valid.')
  }
  if (next.aadhar !== undefined && next.aadhar !== '') {
    next.aadhar = String(next.aadhar).replace(/\D/g, '')
    if (!/^\d{12}$/.test(next.aadhar)) throw new Error('Aadhaar number must contain exactly 12 digits.')
  }
  assertOptionalNumber(next.premium, 'Premium', { min: 1 })
  assertOptionalNumber(next.sumAssured, 'Sum insured')
  assertOptionalNumber(next.income, 'Annual income')
  return next
}
export async function addProposal(data) {
  const payload = normaliseProposalPayload(data)
  return addDoc(proposalsRef(), cleanFirestoreData({ ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
}
export async function getAllProposals() {
  const s = await getDocs(query(proposalsRef(), orderBy('createdAt','desc')))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}
export async function updateProposal(id, data) {
  const payload = normaliseProposalPayload(data, { partial: true })
  return updateDoc(doc(db,PROPOSALS,id), cleanFirestoreData({ ...payload, updatedAt: serverTimestamp() }))
}
export async function deleteProposal(id) { return deleteDoc(doc(db,PROPOSALS,id)) }

// FIX BUG 2: error callback added
export function subscribeProposals(callback, onError) {
  return onSnapshot(
    query(proposalsRef(), orderBy('createdAt', 'desc')),
    s => callback(s.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError || (err => console.error('subscribeProposals:', err.code, err.message))
  )
}

// ── CLIENT DOCUMENTS ──────────────────────────────────────────
export async function addDocMeta(clientId, meta) {
  return addDoc(collection(db,CLIENTS,clientId,DOCS_META), { ...meta, uploadedAt: serverTimestamp() })
}
export async function getDocMeta(clientId) {
  const s = await getDocs(collection(db,CLIENTS,clientId,DOCS_META))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}
export async function deleteDocMeta(clientId, docId) {
  return deleteDoc(doc(db,CLIENTS,clientId,DOCS_META,docId))
}

// ── CLAIMS ────────────────────────────────────────────────────
export const CLAIM_STATUSES = [
  'Intimated', 'Documents Submitted', 'Under Review',
  'Approved', 'Settled', 'Rejected',
]
export const claimsRef = () => collection(db, CLAIMS)
export async function addClaim(data) {
  if (!data.clientId && !data.clientName?.trim()) throw new Error('Claim must be linked to a client.')
  if (!data.policyId && !data.insurer?.trim()) throw new Error('Claim must have a policy or insurer.')
  const status = data.status || 'Intimated'
  assertInList(status, CLAIM_STATUSES, 'Claim status')
  assertOptionalDate(data.intimationDate, 'Intimation date')
  assertOptionalDate(data.incidentDate, 'Incident date')
  assertOptionalNumber(data.claimedAmount, 'Claimed amount')
  assertOptionalNumber(data.approvedAmount, 'Approved amount')
  if (data.claimedAmount && data.approvedAmount && Number(data.approvedAmount) > Number(data.claimedAmount)) {
    throw new Error('Approved amount cannot be greater than claimed amount.')
  }
  return addDoc(claimsRef(), cleanFirestoreData({ ...data, status, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
}
export async function updateClaim(id, data) {
  if (data.status !== undefined) assertInList(data.status, CLAIM_STATUSES, 'Claim status')
  assertOptionalDate(data.intimationDate, 'Intimation date')
  assertOptionalDate(data.incidentDate, 'Incident date')
  assertOptionalNumber(data.claimedAmount, 'Claimed amount')
  assertOptionalNumber(data.approvedAmount, 'Approved amount')
  if (data.claimedAmount && data.approvedAmount && Number(data.approvedAmount) > Number(data.claimedAmount)) {
    throw new Error('Approved amount cannot be greater than claimed amount.')
  }
  return updateDoc(doc(db,CLAIMS,id), cleanFirestoreData({ ...data, updatedAt: serverTimestamp() }))
}
export async function deleteClaim(id) { return deleteDoc(doc(db,CLAIMS,id)) }

// FIX BUG 2: error callback added
export function subscribeClaims(callback, onError) {
  return onSnapshot(
    query(claimsRef(), orderBy('createdAt','desc')),
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() }))),
    onError || (err => console.error('subscribeClaims:', err.code, err.message))
  )
}
export async function getAllClaims() {
  const s = await getDocs(query(claimsRef(), orderBy('createdAt','desc')))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}

// ── TASKS ─────────────────────────────────────────────────────
export const TASK_PRIORITIES = ['High','Medium','Low']
export const TASK_TYPES      = ['Call','Email','Meeting','Follow-up','Document Collection','Other']
export const tasksRef = () => collection(db, TASKS)
export async function addTask(data) {
  const title = assertString(data.title, 'Task title')
  assertInList(data.type || 'Call', TASK_TYPES, 'Task type')
  assertInList(data.priority || 'Medium', TASK_PRIORITIES, 'Task priority')
  assertOptionalDate(data.dueDate, 'Due date')
  if (data.policyId && !data.clientId) throw new Error('A policy-linked task must also be linked to a client.')
  return addDoc(tasksRef(), cleanFirestoreData({ ...data, title, done: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
}
export async function updateTask(id, data) {
  if (data.title !== undefined) data.title = assertString(data.title, 'Task title')
  if (data.type !== undefined) assertInList(data.type, TASK_TYPES, 'Task type')
  if (data.priority !== undefined) assertInList(data.priority, TASK_PRIORITIES, 'Task priority')
  assertOptionalDate(data.dueDate, 'Due date')
  if (data.policyId && !data.clientId) throw new Error('A policy-linked task must also be linked to a client.')
  return updateDoc(doc(db,TASKS,id), cleanFirestoreData({ ...data, updatedAt: serverTimestamp() }))
}
export async function deleteTask(id) { return deleteDoc(doc(db,TASKS,id)) }

// FIX BUG 2: error callback added
export function subscribeTasks(callback, onError) {
  return onSnapshot(
    query(tasksRef(), orderBy('dueDate','asc')),
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() }))),
    onError || (err => console.error('subscribeTasks:', err.code, err.message))
  )
}
export async function getAllTasks() {
  const s = await getDocs(query(tasksRef(), orderBy('dueDate','asc')))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}
