// src/firebase/firestore.js
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc,
  deleteDoc, query, where, orderBy, serverTimestamp,
  onSnapshot, writeBatch, setDoc, limit, runTransaction, Timestamp, startAfter
} from 'firebase/firestore'
import { db } from './config'
import { addFrequencyInterval, computeNextPolicyDue, getDueDate as getPolicyDueDate, normaliseFrequency, parseAnyDate, toInputDate } from '../utils/dateUtils'
import {
  cleanFirestoreData, assertPolicyDateOrder, exactPolicyKey, normalisePolicyPayload,
  assertString, assertOptionalNumber, assertOptionalDate, assertInList,
  assertOptionalEmail, assertOptionalMobile, policyIsActive,
} from '../utils/validation'
// Re-exported so existing importers of firebase/firestore keep working.
export {
  cleanFirestoreData, assertPolicyDateOrder, exactPolicyKey, normalisePolicyPayload,
  policyIsActive,
}

const CLIENTS   = 'clients'
const POLICIES  = 'policies'
const PROPOSALS = 'proposals'
const FAMILIES  = 'families'
const DOCS_META = 'documents'
const USERS     = 'users'
const CLAIMS    = 'claims'
const AUDIT_LOGS = 'audit_logs'
const DOCUMENTS = 'documents'
const MESSAGE_LOGS = 'message_logs'
const LEADS = 'leads'
const LEAD_FOLLOWUPS = 'lead_followups'
const ENDORSEMENTS = 'endorsements'
const COMMISSION_MASTER = 'commission_master'
const COMMISSION_TRANSACTIONS = 'commission_transactions'
const RENEWAL_REMINDER_SETTINGS = 'renewal_reminder_settings'
const RENEWAL_REMINDER_LOGS = 'renewal_reminder_logs'
const SUB_BROKERS = 'sub_brokers'
const SALES_MANAGERS = 'sales_managers'
const REPORTS_SAVED_FILTERS = 'reports_saved_filters'
const CLIENT_FIELDS = [
  'name', 'mobile', 'email', 'pan', 'aadhar', 'dob', 'gender',
  'address', 'city', 'state', 'occupation', 'employment', 'income',
  'qualification', 'designation', 'kycStatus', 'familyId', 'familyName',
  'familyRole', 'notes',
]
const BACKUP_COLLECTIONS = [
  CLIENTS, POLICIES, PROPOSALS, CLAIMS, USERS, FAMILIES,
  AUDIT_LOGS, DOCUMENTS, MESSAGE_LOGS, LEADS, LEAD_FOLLOWUPS, ENDORSEMENTS,
  COMMISSION_MASTER, COMMISSION_TRANSACTIONS,
  RENEWAL_REMINDER_SETTINGS, RENEWAL_REMINDER_LOGS,
  SUB_BROKERS, SALES_MANAGERS, REPORTS_SAVED_FILTERS,
]

export const CRM_COLLECTIONS = Object.freeze({
  CLIENTS,
  POLICIES,
  PROPOSALS,
  FAMILIES,
  USERS,
  CLAIMS,
  AUDIT_LOGS,
  DOCUMENTS,
  MESSAGE_LOGS,
  LEADS,
  LEAD_FOLLOWUPS,
  ENDORSEMENTS,
  COMMISSION_MASTER,
  COMMISSION_TRANSACTIONS,
  RENEWAL_REMINDER_SETTINGS,
  RENEWAL_REMINDER_LOGS,
  SUB_BROKERS,
  SALES_MANAGERS,
  REPORTS_SAVED_FILTERS,
})

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

export async function createCRMBackup(onProgress = () => {}) {
  const collections = {}
  const totals = {}
  const steps = BACKUP_COLLECTIONS.length + 1
  let step = 0

  for (const name of BACKUP_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, name))
      collections[name] = snap.docs.map(d => ({
        id: d.id,
        data: serialiseBackupValue(d.data()),
      }))
      totals[name] = snap.size
    } catch (error) {
      // Name the collection that failed. A bare "Missing or insufficient
      // permissions" gives no clue which rule to look at.
      throw new Error(`Backup failed while reading "${name}": ${error?.message || error}`)
    }
    onProgress(++step, steps, name)
  }

  // Each client has its own documents subcollection, so this is one read per
  // client. Run them in batches rather than one at a time — sequentially this
  // took as many round trips as you have clients and looked like a hang.
  const clientDocuments = []
  const clientList = collections[CLIENTS] || []
  try {
    for (let i = 0; i < clientList.length; i += 25) {
      const batch = clientList.slice(i, i + 25)
      const snaps = await Promise.all(
        batch.map(client => getDocs(collection(db, CLIENTS, client.id, DOCS_META)))
      )
      snaps.forEach((snap, index) => {
        snap.docs.forEach(d => {
          clientDocuments.push({
            clientId: batch[index].id,
            id: d.id,
            data: serialiseBackupValue(d.data()),
          })
        })
      })
    }
  } catch (error) {
    throw new Error(`Backup failed while reading client documents: ${error?.message || error}`)
  }
  totals.clientDocuments = clientDocuments.length
  onProgress(++step, steps, 'clientDocuments')

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

  (backup.subcollections?.clientDocuments || []).forEach(record => {
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

// ── PHASE 1 FOUNDATION MODULES ────────────────────────────────
function foundationRef(name) {
  return collection(db, name)
}

function normaliseFoundationPayload(data = {}, { requireName = false, nameField = 'name' } = {}) {
  const payload = { ...data }
  if (requireName) payload[nameField] = assertString(payload[nameField], nameField, 160)
  Object.entries(payload).forEach(([key, value]) => {
    if (typeof value === 'string') payload[key] = value.trim()
  })
  return cleanFirestoreData(payload)
}

async function addFoundationDoc(collectionName, data = {}, options = {}) {
  const payload = normaliseFoundationPayload(data, options)
  return addDoc(foundationRef(collectionName), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

async function updateFoundationDoc(collectionName, id, data = {}, options = {}) {
  if (!id) throw new Error('Record id is required.')
  const payload = normaliseFoundationPayload(data, options)
  return setDoc(doc(db, collectionName, id), {
    ...payload,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

async function listFoundationDocs(collectionName, orderField = 'createdAt', direction = 'desc') {
  const s = await getDocs(query(foundationRef(collectionName), orderBy(orderField, direction)))
  return s.docs.map(d => ({ id: d.id, ...d.data() }))
}

function sortByCreatedAt(rows, direction = 'desc') {
  const dir = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a.createdAt?.seconds || 0
    const bv = b.createdAt?.seconds || 0
    return (av - bv) * dir
  })
}

export async function createAuditLog(data = {}) {
  const payload = normaliseFoundationPayload({
    action: data.action || '',
    entityType: data.entityType || '',
    entityId: data.entityId || '',
    summary: data.summary || '',
    before: data.before || null,
    after: data.after || null,
    userId: data.userId || '',
    userEmail: data.userEmail || '',
    metadata: data.metadata || {},
  })
  if (!payload.action) throw new Error('Audit action is required.')
  if (!payload.entityType) throw new Error('Audit entity type is required.')
  return addDoc(foundationRef(AUDIT_LOGS), {
    ...payload,
    createdAt: serverTimestamp(),
  })
}

export async function getAuditLogs({ entityType = '', entityId = '' } = {}) {
  const base = foundationRef(AUDIT_LOGS)
  const constraints = []
  if (entityType) constraints.push(where('entityType', '==', entityType))
  if (entityId) constraints.push(where('entityId', '==', entityId))
  const s = await getDocs(query(base, ...constraints))
  return sortByCreatedAt(s.docs.map(d => ({ id: d.id, ...d.data() })))
}

export async function addDocumentRecord(data = {}) {
  if (!data.ownerType || !data.ownerId) throw new Error('Document owner is required.')
  if (!data.name && !data.fileName) throw new Error('Document name is required.')
  return addFoundationDoc(DOCUMENTS, {
    ownerType: data.ownerType,
    ownerId: data.ownerId,
    documentType: data.documentType || 'other',
    name: data.name || data.fileName,
    url: data.url || '',
    storagePath: data.storagePath || '',
    contentType: data.contentType || '',
    size: Number(data.size || 0),
    notes: data.notes || '',
  })
}

export async function getDocumentRecords(ownerType, ownerId) {
  if (!ownerType || !ownerId) return []
  const s = await getDocs(query(
    foundationRef(DOCUMENTS),
    where('ownerType', '==', ownerType),
    where('ownerId', '==', ownerId),
  ))
  return sortByCreatedAt(s.docs.map(d => ({ id: d.id, ...d.data() })))
}

export async function addMessageLog(data = {}) {
  if (!data.channel) throw new Error('Message channel is required.')
  return addFoundationDoc(MESSAGE_LOGS, {
    channel: data.channel,
    templateType: data.templateType || '',
    entityType: data.entityType || '',
    entityId: data.entityId || '',
    clientId: data.clientId || '',
    policyId: data.policyId || '',
    recipientName: data.recipientName || '',
    recipientMobile: data.recipientMobile || '',
    recipientEmail: data.recipientEmail || '',
    messagePreview: data.messagePreview || '',
    status: data.status || 'draft',
    sentAt: data.sentAt || null,
  })
}

export async function getRenewalReminderSettings() {
  const snap = await getDoc(doc(db, RENEWAL_REMINDER_SETTINGS, 'active'))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export function subscribeRenewalReminderSettings(callback, onError) {
  return onSnapshot(
    doc(db, RENEWAL_REMINDER_SETTINGS, 'active'),
    snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError || (err => console.error('subscribeRenewalReminderSettings:', err.code, err.message))
  )
}

export async function saveRenewalReminderSettings(data = {}) {
  const intervals = (data.intervals || []).map(item => ({
    id: item.id || `d${Number(item.days) || 0}`,
    days: Math.max(0, Number(item.days) || 0),
    enabled: item.enabled !== false,
  }))
  return setDoc(doc(db, RENEWAL_REMINDER_SETTINGS, 'active'), cleanFirestoreData({
    enabled: data.enabled !== false,
    prompt: String(data.prompt || '').trim(),
    intervals,
    updatedAt: serverTimestamp(),
  }), { merge: true })
}

export function subscribeRenewalReminderLogs(callback, onError) {
  return onSnapshot(
    query(collection(db, RENEWAL_REMINDER_LOGS), orderBy('createdAt', 'desc'), limit(100)),
    snap => callback(snap.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError || (err => console.error('subscribeRenewalReminderLogs:', err.code, err.message))
  )
}

export async function claimRenewalReminder(data = {}) {
  if (!data.id) throw new Error('Reminder id is required.')
  const ref = doc(db, RENEWAL_REMINDER_LOGS, data.id)
  return runTransaction(db, async tx => {
    const existing = await tx.get(ref)
    if (existing.exists()) return { claimed: false, id: ref.id }
    tx.set(ref, cleanFirestoreData({
      ...renewalReminderLogPayload(data),
      status: 'sending',
      manual: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }))
    return { claimed: true, id: ref.id }
  })
}

export async function finishRenewalReminderLog(id, data = {}) {
  return setDoc(doc(db, RENEWAL_REMINDER_LOGS, id), cleanFirestoreData({
    status: data.status || 'sent',
    messageId: data.messageId || '',
    error: data.error || '',
    sentAt: data.status === 'sent' ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  }), { merge: true })
}

export async function addManualRenewalReminderLog(data = {}) {
  return addDoc(collection(db, RENEWAL_REMINDER_LOGS), cleanFirestoreData({
    ...renewalReminderLogPayload(data),
    status: data.status || 'sent',
    manual: true,
    messageId: data.messageId || '',
    error: data.error || '',
    sentAt: data.status === 'sent' ? serverTimestamp() : null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }))
}

function renewalReminderLogPayload(data = {}) {
  const policy = data.policy || {}
  const client = data.client || {}
  return {
    policyId: policy.id || data.policyId || '',
    policyNumber: policy.policyNumber || '',
    policyType: policy.policyType || '',
    insurer: policy.insurer || '',
    clientId: policy.clientId || client.id || '',
    clientName: client.name || policy.clientName || '',
    recipientMobile: data.mobile || policy.clientMobile || client.mobile || '',
    dueDate: data.dueDate || '',
    daysBefore: data.daysBefore ?? null,
    messagePreview: String(data.message || '').slice(0, 500),
  }
}

export async function addCommissionTransaction(data = {}) {
  if (!data.policyId && !data.policyNumber) throw new Error('Commission transaction must be linked to a policy.')
  const payload = normaliseFoundationPayload({
    policyId: data.policyId || '',
    policyNumber: data.policyNumber || '',
    clientId: data.clientId || '',
    clientName: data.clientName || '',
    insurer: data.insurer || '',
    // Fresh / Renewal and the plan (LOB) as the statement reported them. These
    // are queryable fields, not remarks text, because the ledger dashboards
    // split on them — a policy's own policyYear is a different question.
    businessType: data.businessType || '',
    planName: data.planName || '',
    premium: Number(data.premium || 0),
    expectedCommission: Number(data.expectedCommission || 0),
    receivedCommission: Number(data.receivedCommission || 0),
    rewardCommission: Number(data.rewardCommission || 0),
    tds: Number(data.tds || 0),
    gst: Number(data.gst || 0),
    netReceived: Number(data.netReceived || 0),
    difference: Number(data.difference || 0),
    payoutDate: data.payoutDate || '',
    payoutMonth: data.payoutMonth || '',
    referenceNumber: data.referenceNumber || '',
    status: data.status || 'pending',
    postingKey: data.postingKey || '',
    createdBy: data.createdBy || '',
    createdByEmail: data.createdByEmail || '',
    remarks: data.remarks || '',
  })
  if (!payload.postingKey) return addFoundationDoc(COMMISSION_TRANSACTIONS, payload)

  const transactionRef = doc(db, COMMISSION_TRANSACTIONS, payload.postingKey)
  // The posting-key shape has changed twice, and rows already in the ledger keep
  // whichever id was current when they were posted. Every historical shape has to
  // be checked or re-uploading an old statement posts the whole thing again.
  const legacyRefs = [...new Set((data.legacyPostingKeys || []).map(k => String(k || '').trim()))]
    .filter(k => k && k !== payload.postingKey)
    .map(k => doc(db, COMMISSION_TRANSACTIONS, k))
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(transactionRef)
    const legacy = await Promise.all(legacyRefs.map(ref => transaction.get(ref)))
    if (existing.exists() || legacy.some(snapshot => snapshot.exists())) {
      const error = new Error('This commission row has already been posted.')
      error.code = 'commission/duplicate-post'
      throw error
    }
    transaction.set(transactionRef, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      postedAt: serverTimestamp(),
    })
  })
  return transactionRef
}

export async function getAllCommissionTransactions() {
  return listFoundationDocs(COMMISSION_TRANSACTIONS)
}

export async function getCommissionTransactionsPage({ pageSize = 100, cursor = null } = {}) {
  const safeSize = Math.min(250, Math.max(10, Number(pageSize) || 100))
  const constraints = [orderBy('createdAt', 'desc')]
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(safeSize + 1))
  const snapshot = await getDocs(query(foundationRef(COMMISSION_TRANSACTIONS), ...constraints))
  const hasMore = snapshot.docs.length > safeSize
  const visibleDocs = snapshot.docs.slice(0, safeSize)
  return {
    rows: visibleDocs.map(item => ({ id: item.id, ...item.data() })),
    cursor: visibleDocs.at(-1) || null,
    hasMore,
  }
}

export async function saveReportFilter(data = {}) {
  return addFoundationDoc(REPORTS_SAVED_FILTERS, {
    name: data.name || '',
    reportType: data.reportType || '',
    filters: data.filters || {},
    userId: data.userId || '',
  }, { requireName: true })
}

export async function getAllSavedReportFilters() {
  return listFoundationDocs(REPORTS_SAVED_FILTERS)
}

// ── CLIENTS ───────────────────────────────────────────────────
export const clientsRef = () => collection(db, CLIENTS)

const CLIENT_KYC_OPTIONS = ['Pending', 'In Progress', 'Complete']
const CLIENT_GENDER_OPTIONS = ['Male', 'Female', 'Other']

function clientBackfillFromSource(client, source = {}) {
  const update = {}
  const selfMember = Array.isArray(source.members)
    ? source.members.find(m => String(m?.relationship || '').trim().toLowerCase() === 'self')
    : null
  const copyIfBlank = (clientField, ...sourceFields) => {
    if (client[clientField]) return
    const value = sourceFields.map(field => source[field]).find(v => v !== undefined && v !== null && String(v).trim() !== '')
    if (value !== undefined) update[clientField] = value
  }

  copyIfBlank('mobile', 'clientMobile', 'mobile')
  copyIfBlank('email', 'clientEmail', 'email')
  copyIfBlank('dob', 'clientDob', 'dob', 'dateOfBirth')
  if (!client.dob && !update.dob && selfMember?.dob) update.dob = selfMember.dob
  copyIfBlank('gender', 'clientGender', 'gender')
  copyIfBlank('pan', 'clientPan', 'pan')
  copyIfBlank('aadhar', 'clientAadhar', 'aadhar', 'aadhaar')
  copyIfBlank('address', 'clientAddress', 'address')
  copyIfBlank('city', 'clientCity', 'city')
  copyIfBlank('state', 'clientState', 'state')
  copyIfBlank('occupation', 'clientOccupation', 'occupation')
  copyIfBlank('income', 'clientIncome', 'income')
  copyIfBlank('qualification', 'clientQualification', 'qualification')
  copyIfBlank('designation', 'clientDesignation', 'designation')

  return normaliseClientPayload(update, { partial: true })
}

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

  ['address', 'city', 'state', 'occupation', 'employment', 'qualification', 'designation', 'notes'].forEach(field => {
    if (next[field] !== undefined && next[field] !== null) {
      next[field] = String(next[field]).trim()
    }
  })
  ;['familyId', 'familyName', 'familyRole'].forEach(field => {
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
  return s.docs.map(d => ({ id:d.id, ...d.data() })).filter(c => !c.mergedIntoClientId)
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
  const claimsByPolicy = await getDocs(query(collection(db, CLAIMS), where('policyId', '==', policyId)))
  return [
    ...claimsByPolicy.docs.map(d => d.ref),
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
  const claimsByPolicy = await getDocs(query(collection(db, CLAIMS), where('policyId', '==', policyId)))
  const refs = claimsByPolicy.docs.map(d => d.ref)

  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db)
    refs.slice(i, i + 400).forEach(ref => batch.update(ref, linkedUpdate))
    await batch.commit()
  }
}

/**
 * cascadeUpdateClient(id, data)
 * Updates the client record AND propagates name/mobile/email changes
 * to every linked policy and claim. Uses chunked batches of
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
    const [pols, cls] = await Promise.all([
      getDocs(query(collection(db, POLICIES), where('clientId', '==', id))),
      getDocs(query(collection(db, CLAIMS),   where('clientId', '==', id))),
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
    await commitInChunks([...polPairs, ...clsPairs])
  }
}

export async function deleteClient(id) {
  const [pols, cls, docs] = await Promise.all([
    getDocs(query(collection(db, POLICIES), where('clientId', '==', id))),
    getDocs(query(collection(db, CLAIMS),   where('clientId', '==', id))),
    getDocs(collection(db, CLIENTS, id, DOCS_META)),
  ])
  const policyLinkedRefs = (await Promise.all(pols.docs.map(d => policyCascadeRefs(d.id)))).flat()

  await deleteRefsInChunks([
    ...policyLinkedRefs,
    ...pols.docs.map(d => d.ref),
    ...cls.docs.map(d => d.ref),
    ...docs.docs.map(d => d.ref),
    doc(db, CLIENTS, id),
  ])
}

export async function bulkDeleteClients(ids) {
  const allRefs = []
  for (const id of ids) {
    const [pols, cls, docs] = await Promise.all([
      getDocs(query(collection(db, POLICIES), where('clientId', '==', id))),
      getDocs(query(collection(db, CLAIMS),   where('clientId', '==', id))),
      getDocs(collection(db, CLIENTS, id, DOCS_META)),
    ])
    const policyLinkedRefs = (await Promise.all(pols.docs.map(d => policyCascadeRefs(d.id)))).flat()
    allRefs.push(
      ...policyLinkedRefs,
      ...pols.docs.map(d => d.ref),
      ...cls.docs.map(d => d.ref),
      ...docs.docs.map(d => d.ref),
      doc(db, CLIENTS, id),
    )
  }
  await deleteRefsInChunks(allRefs)
}

// ── FAMILY UNITS ───────────────────────────────────────────────
export const familiesRef = () => collection(db, FAMILIES)

export async function createFamilyUnit(data = {}) {
  const name = assertString(data.name || data.familyName, 'Family name', 120)
  return addDoc(familiesRef(), cleanFirestoreData({
    name,
    notes: String(data.notes || '').trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }))
}

export async function getAllFamilies() {
  const s = await getDocs(query(familiesRef(), orderBy('name', 'asc')))
  return s.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function linkClientToFamily(clientId, familyId, familyName, familyRole = '') {
  if (!clientId) throw new Error('Client is required.')
  return setDoc(doc(db, CLIENTS, clientId), cleanFirestoreData({
    familyId: String(familyId || '').trim(),
    familyName: String(familyName || '').trim(),
    familyRole: String(familyRole || '').trim(),
    updatedAt: serverTimestamp(),
  }), { merge: true })
}

export async function unlinkClientFromFamily(clientId) {
  if (!clientId) throw new Error('Client is required.')
  return setDoc(doc(db, CLIENTS, clientId), {
    familyId: '',
    familyName: '',
    familyRole: '',
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

// ── CLIMER — CLIENT MERGER MODULE ─────────────────────────────
export async function mergeClients(duplicateId, masterId) {
  if (!duplicateId || !masterId) throw new Error('Both duplicate and master IDs required')
  if (duplicateId === masterId) throw new Error('Cannot merge a client into itself')

  const master = await getClient(masterId)
  if (!master) throw new Error('Master client not found')
  const dup = await getClient(duplicateId)
  if (!dup) throw new Error('Duplicate client not found')

  const [dupPolicies, dupClaims, dupDocs] = await Promise.all([
    getDocs(query(collection(db, POLICIES), where('clientId', '==', duplicateId))),
    getDocs(query(collection(db, CLAIMS),   where('clientId', '==', duplicateId))),
    getDocs(collection(db, CLIENTS, duplicateId, DOCS_META)),
  ])

  const ops = []
  const masterBackfill = {
    ...clientBackfillFromSource(master, dup),
  }

  dupPolicies.docs.forEach(d => {
    const policyData = d.data()
    Object.assign(masterBackfill, clientBackfillFromSource({ ...master, ...masterBackfill }, policyData))
    ops.push({ ref: d.ref, data: {
      clientId:     masterId,
      clientName:   master.name,
      clientMobile: master.mobile || masterBackfill.mobile || dup.mobile || policyData.clientMobile || '',
      clientEmail:  master.email  || masterBackfill.email  || dup.email  || policyData.clientEmail  || '',
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

  const chunks = []
  for (let i = 0; i < ops.length; i += 400) chunks.push(ops.slice(i, i + 400))
  for (const chunk of chunks) {
    const batch = writeBatch(db)
    chunk.forEach(({ ref, data }) => batch.update(ref, data))
    await batch.commit()
  }

  if (Object.keys(masterBackfill).length > 0) {
    await setDoc(doc(db, CLIENTS, masterId), cleanFirestoreData({
      ...masterBackfill,
      updatedAt: serverTimestamp(),
    }), { merge: true })
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

  await setDoc(doc(db, CLIENTS, duplicateId), cleanFirestoreData({
    mergedIntoClientId: masterId,
    mergedIntoClientName: master.name,
    mergedAt: serverTimestamp(),
    archivedAfterMerge: true,
    updatedAt: serverTimestamp(),
  }), { merge: true })
  await syncClientPolicySummary(masterId, masterBackfill)

  return {
    policiesMoved: dupPolicies.size,
    claimsMoved:   dupClaims.size,
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
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() })).filter(c => !c.mergedIntoClientId)),
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

// Stays here rather than in utils/validation.js: it depends on resolvePolicyDueStr,
// which is part of this module's policy-due resolution.
function withPolicyDefaults(payload) {
  return {
    ...payload,
    parentPolicyId: payload.parentPolicyId || null,
    policyYear: payload.policyYear || 1,
    nextPremiumDue: resolvePolicyDueStr(payload) || null,
    renewedAt: null,
  }
}

async function findExactPolicyDuplicate(payload, currentId = null) {
  const number = String(payload?.policyNumber || '').trim()
  if (!number) return null
  const snapshot = await getDocs(query(policiesRef(), where('policyNumber', '==', number), limit(100)))
  const candidateKey = exactPolicyKey(payload)
  const match = snapshot.docs.find(item => (
    item.id !== currentId && !item.data().deleted && exactPolicyKey(item.data()) === candidateKey
  ))
  return match ? { id: match.id, ...match.data() } : null
}

async function assertNoExactPolicyDuplicate(payload, currentId = null) {
  const duplicate = await findExactPolicyDuplicate(payload, currentId)
  if (duplicate) throw new Error('An identical policy already exists. Change at least one policy field before saving.')
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

  Object.assign(update, clientBackfillFromSource(client, policyHint))

  await setDoc(clientRef, cleanFirestoreData(update), { merge: true })
}

export async function addPolicy(data) {
  const payload = normalisePolicyPayload(data)
  assertPolicyDateOrder(payload.startDate, payload.expiryDate)
  const policyRecord = withPolicyDefaults(payload)
  await assertNoExactPolicyDuplicate(policyRecord)
  const ref = await addDoc(policiesRef(), cleanFirestoreData({
    ...policyRecord,
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp()
  }))
  await syncClientPolicySummary(payload.clientId, payload)
  return ref
}

export async function importPoliciesBatch(rows, onProgress = () => {}) {
  const prepared = []
  const seenPolicies = new Set()
  for (const row of rows) {
    const payload = normalisePolicyPayload(row)
    assertPolicyDateOrder(payload.startDate, payload.expiryDate)
    const policyRecord = withPolicyDefaults(payload)
    const policyKey = exactPolicyKey(policyRecord)
    if (seenPolicies.has(policyKey)) throw new Error('An identical policy appears more than once in this import.')
    seenPolicies.add(policyKey)
    await assertNoExactPolicyDuplicate(policyRecord)
    prepared.push({
      ...policyRecord,
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
  await assertNoExactPolicyDuplicate({ ...mergedPolicy, ...update }, id)
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
  if (!data?.policyNumber) return { isDup: false, reason: '', existing: null }
  const payload = withPolicyDefaults(cleanFirestoreData({ ...data }))
  const match = await findExactPolicyDuplicate(payload, data.id || null)
  return match
    ? { isDup: true, reason: 'Every field matches an existing policy.', existing: match }
    : { isDup: false, reason: '', existing: null }
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

export async function savePolicyPdfUrl(policyId, url, name, storagePath = '', storageBucket = '', extra = {}) {
  return updateDoc(doc(db,POLICIES,policyId), {
    policyPdfUrl: url,
    policyPdfName: name,
    policyPdfYear: extra.documentYear || extra.policyPdfYear || null,
    policyPdfStoragePath: storagePath || null,
    policyPdfStorageBucket: storageBucket || null,
    policyPdfStorageProvider: extra.storageProvider || null,
    policyPdfPublicId: extra.publicId || null,
    policyPdfResourceType: extra.resourceType || null,
    policyPdfDeleteToken: extra.deleteToken || null,
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
    const renewedPremium = options.premium !== undefined ? Number(options.premium) : null
    if (isLifePolicy && options.premium !== undefined && (!Number.isFinite(renewedPremium) || renewedPremium <= 0)) {
      throw new Error('Renewed premium must be greater than 0.')
    }
    if (!isLifePolicy && expiry && nextInstallmentDue > expiry) {
      throw new Error('Premium due date cannot be after policy expiry for non-life policies. Use Renew instead.')
    }

    tx.update(policyRef, {
      frequency: nextFrequency,
      ...(isLifePolicy && renewedPremium !== null ? { premium: renewedPremium } : {}),
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
