// src/firebase/firestore.js
import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc,
  deleteDoc, query, where, orderBy, serverTimestamp,
  onSnapshot, writeBatch, setDoc, limit
} from 'firebase/firestore'
import { db } from './config'

const CLIENTS   = 'clients'
const POLICIES  = 'policies'
const PROPOSALS = 'proposals'
const DOCS_META = 'documents'
const USERS     = 'users'
const CLAIMS    = 'claims'
const TASKS     = 'tasks'

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

export async function addClient(data) {
  return addDoc(clientsRef(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
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
  return updateDoc(doc(db,CLIENTS,id), { ...data, updatedAt: serverTimestamp() })
}

/**
 * cascadeUpdateClient(id, data)
 * Updates the client record AND propagates name/mobile/email changes
 * to every linked policy, claim, and task. Uses chunked batches of
 * 400 to stay well under Firestore's 500-write-per-batch limit.
 */
export async function cascadeUpdateClient(id, data) {
  // Helper: commit a list of {ref, upd} pairs in 400-write batches
  async function commitInChunks(pairs) {
    for (let i = 0; i < pairs.length; i += 400) {
      const b = writeBatch(db)
      pairs.slice(i, i + 400).forEach(({ ref, upd }) => b.update(ref, upd))
      await b.commit()
    }
  }

  // 1. Update the client document itself (its own single-write batch)
  const clientBatch = writeBatch(db)
  clientBatch.update(doc(db, CLIENTS, id), { ...data, updatedAt: serverTimestamp() })
  await clientBatch.commit()

  // 2. Propagate changes to all linked records
  const hasName   = !!data.name
  const hasMobile = data.mobile !== undefined
  const hasEmail  = data.email  !== undefined

  if (hasName || hasMobile || hasEmail) {
    const [pols, cls, tsk] = await Promise.all([
      getDocs(query(collection(db, POLICIES), where('clientId', '==', id))),
      getDocs(query(collection(db, CLAIMS),   where('clientId', '==', id))),
      getDocs(query(collection(db, TASKS),    where('clientId', '==', id))),
    ])

    const polPairs = pols.docs.map(d => {
      const upd = { updatedAt: serverTimestamp() }
      if (hasName)   upd.clientName   = data.name
      if (hasMobile) upd.clientMobile = data.mobile
      if (hasEmail)  upd.clientEmail  = data.email
      return { ref: d.ref, upd }
    })
    const clsPairs = cls.docs.map(d => {
      const upd = { updatedAt: serverTimestamp() }
      if (hasName)   upd.clientName   = data.name
      if (hasMobile) upd.clientMobile = data.mobile
      return { ref: d.ref, upd }
    })
    const tskPairs = tsk.docs.map(d => {
      const upd = { updatedAt: serverTimestamp() }
      if (hasName) upd.clientName = data.name
      return { ref: d.ref, upd }
    })

    await commitInChunks([...polPairs, ...clsPairs, ...tskPairs])
  }
}

export async function deleteClient(id) {
  const pols = await getDocs(query(collection(db,POLICIES), where('clientId','==',id)))
  const batch = writeBatch(db)
  pols.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(db,CLIENTS,id))
  return batch.commit()
}

/**
 * bulkDeleteClients(ids[])
 * Deletes multiple clients and all linked policies in chunked batches.
 */
export async function bulkDeleteClients(ids) {
  const allPolicyRefs = []
  for (const id of ids) {
    const pols = await getDocs(query(collection(db, POLICIES), where('clientId', '==', id)))
    pols.docs.forEach(d => allPolicyRefs.push(d.ref))
  }
  const allRefs = [
    ...ids.map(id => doc(db, CLIENTS, id)),
    ...allPolicyRefs,
  ]
  const chunks = []
  for (let i = 0; i < allRefs.length; i += 400) chunks.push(allRefs.slice(i, i + 400))
  for (const chunk of chunks) {
    const batch = writeBatch(db)
    chunk.forEach(ref => batch.delete(ref))
    await batch.commit()
  }
}

// ── CLIMER — CLIENT MERGER MODULE ─────────────────────────────
/**
 * mergeClients(duplicateId, masterId)
 *
 * Single merge: reassigns ALL data from duplicate → master then
 * deletes the duplicate. Handles:
 *   - Policies (reassign clientId + clientName)
 *   - Claims   (reassign clientId + clientName)
 *   - Tasks    (reassign clientId + clientName)
 *   - Documents (copy subcollection docs to master, delete from dup)
 *
 * Returns { policiesMoved, claimsMoved, tasksMoved, docsMoved }
 */
export async function mergeClients(duplicateId, masterId) {
  if (!duplicateId || !masterId) throw new Error('Both duplicate and master IDs required')
  if (duplicateId === masterId) throw new Error('Cannot merge a client into itself')

  const master = await getClient(masterId)
  if (!master) throw new Error('Master client not found')
  const dup = await getClient(duplicateId)
  if (!dup) throw new Error('Duplicate client not found')

  // Collect all records linked to duplicate
  const [dupPolicies, dupClaims, dupTasks, dupDocs] = await Promise.all([
    getDocs(query(collection(db, POLICIES), where('clientId', '==', duplicateId))),
    getDocs(query(collection(db, CLAIMS),   where('clientId', '==', duplicateId))),
    getDocs(query(collection(db, TASKS),    where('clientId', '==', duplicateId))),
    getDocs(collection(db, CLIENTS, duplicateId, DOCS_META)),
  ])

  const ops = []

  // Reassign policies to master
  dupPolicies.docs.forEach(d => {
    ops.push({ ref: d.ref, data: {
      clientId:     masterId,
      clientName:   master.name,
      clientMobile: master.mobile || dup.mobile || '',
      clientEmail:  master.email  || dup.email  || '',
      updatedAt:    serverTimestamp(),
    }})
  })

  // Reassign claims to master
  dupClaims.docs.forEach(d => {
    ops.push({ ref: d.ref, data: {
      clientId:   masterId,
      clientName: master.name,
      updatedAt:  serverTimestamp(),
    }})
  })

  // Reassign tasks to master
  dupTasks.docs.forEach(d => {
    ops.push({ ref: d.ref, data: {
      clientId:   masterId,
      clientName: master.name,
      updatedAt:  serverTimestamp(),
    }})
  })

  // Execute reassignment in chunks of 400
  const chunks = []
  for (let i = 0; i < ops.length; i += 400) chunks.push(ops.slice(i, i + 400))
  for (const chunk of chunks) {
    const batch = writeBatch(db)
    chunk.forEach(({ ref, data }) => batch.update(ref, data))
    await batch.commit()
  }

  // Move documents subcollection: copy to master then delete from dup
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

  // Finally delete the duplicate client record
  await deleteDoc(doc(db, CLIENTS, duplicateId))

  return {
    policiesMoved: dupPolicies.size,
    claimsMoved:   dupClaims.size,
    tasksMoved:    dupTasks.size,
    docsMoved,
  }
}

/**
 * bulkMergeClients(duplicateIds[], masterId)
 *
 * Bulk merge: merges multiple duplicate clients into one master.
 * Calls mergeClients() sequentially for each duplicate.
 * Returns array of per-duplicate results.
 */
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

export function subscribeClients(callback) {
  return onSnapshot(query(clientsRef(), orderBy('createdAt','desc')),
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() }))))
}

export async function findClientByMobileOrName(mobile, name) {
  const allS = await getDocs(clientsRef())
  const clients = allS.docs.map(d => ({ id:d.id, ...d.data() }))
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

// ── Premium due date helper ───────────────────────────────────
function computeNextPremiumDueStr(startDate, frequency) {
  if (!startDate) return null
  let start
  if (startDate?.seconds) start = new Date(startDate.seconds * 1000)
  else { try { start = new Date(startDate) } catch { return null } }
  if (!start || isNaN(start.getTime())) return null

  const freq = (frequency||'Yearly').toLowerCase()
  let days = 365
  if (freq.includes('month'))  days = 30
  else if (freq.includes('quarter') || freq.includes('3 month')) days = 90
  else if (freq.includes('half') || freq.includes('6 month')) days = 180

  const today = new Date()
  let next = new Date(start)
  while (next <= today) next = new Date(next.getTime() + days * 86400000)
  return next.toISOString().split('T')[0]
}

export async function addPolicy(data) {
  const nextPremiumDue = computeNextPremiumDueStr(data.startDate, data.frequency)
  return addDoc(policiesRef(), {
    ...data,
    parentPolicyId: data.parentPolicyId || null,
    policyYear:     data.policyYear     || 1,
    nextPremiumDue: nextPremiumDue || null,
    renewedAt:      null,
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp()
  })
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
  const update = { ...data, updatedAt: serverTimestamp() }
  if (data.startDate || data.frequency) {
    const existing = (await getDoc(doc(db,POLICIES,id))).data() || {}
    const start = data.startDate || existing.startDate
    const freq  = data.frequency || existing.frequency
    update.nextPremiumDue = computeNextPremiumDueStr(start, freq) || null
  }
  return updateDoc(doc(db,POLICIES,id), update)
}
export async function deletePolicy(id) { return deleteDoc(doc(db,POLICIES,id)) }

export async function bulkDeletePolicies(ids) {
  const chunks = []
  for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400))
  for (const chunk of chunks) {
    const batch = writeBatch(db)
    chunk.forEach(id => batch.delete(doc(db, POLICIES, id)))
    await batch.commit()
  }
}

export async function checkDuplicate(data) {
  const { policyNumber, clientName, premium, insurer, registrationNo } = data

  if (policyNumber?.trim()) {
    const s = await getDocs(query(policiesRef(), where('policyNumber', '==', policyNumber.trim()), limit(1)))
    if (!s.empty) return { isDup: true, reason: `Policy number "${policyNumber}" already exists`, existing: { id: s.docs[0].id, ...s.docs[0].data() } }
  }
  if (registrationNo?.trim()) {
    const s = await getDocs(query(policiesRef(), where('registrationNo', '==', registrationNo.trim()), limit(1)))
    if (!s.empty) return { isDup: true, reason: `Registration number "${registrationNo}" already exists`, existing: { id: s.docs[0].id, ...s.docs[0].data() } }
  }
  if (clientName?.trim() && premium && insurer?.trim()) {
    const s = await getDocs(query(policiesRef(),
      where('clientName', '==', clientName.trim()),
      where('premium',    '==', premium),
      where('insurer',    '==', insurer.trim()),
      limit(3)
    ))
    if (!s.empty) {
      const match = s.docs[0]
      return { isDup: true, reason: `Same client "${clientName}" + premium ₹${premium} + insurer "${insurer}" already on record (${match.data().policyNumber})`, existing: { id: match.id, ...match.data() } }
    }
  }
  return { isDup: false, reason: '', existing: null }
}

export async function checkDuplicatePolicyNumber(policyNumber) {
  if (!policyNumber?.trim()) return false
  const s = await getDocs(query(policiesRef(), where('policyNumber', '==', policyNumber.trim()), limit(1)))
  return !s.empty
}
export function subscribePolicies(callback) {
  return onSnapshot(query(policiesRef(), orderBy('expiryDate','asc')),
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() }))))
}
export async function savePolicyPdfUrl(policyId, url, name) {
  return updateDoc(doc(db,POLICIES,policyId), {
    policyPdfUrl: url, policyPdfName: name, updatedAt: serverTimestamp()
  })
}

// ── RENEWAL VERSIONING ────────────────────────────────────────
export async function saveRenewal(oldPolicyId, newData) {
  const old = await getPolicy(oldPolicyId)
  if (!old) throw new Error('Original policy not found')

  const batch = writeBatch(db)
  batch.update(doc(db, POLICIES, oldPolicyId), {
    status:    'Renewed-Out',
    renewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  const newRef = doc(collection(db, POLICIES))
  const newNextPremiumDue = computeNextPremiumDueStr(newData.startDate, newData.frequency)
  batch.set(newRef, {
    ...newData,
    parentPolicyId: oldPolicyId,
    policyYear:     (old.policyYear || 1) + 1,
    nextPremiumDue: newNextPremiumDue || null,
    status:         'Active',
    renewedAt:      null,
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  })

  await batch.commit()
  return newRef
}

export async function getPolicyChain(policyId) {
  const current = await getPolicy(policyId)
  if (!current) return { current: null, previous: null }
  const previous = current.parentPolicyId ? await getPolicy(current.parentPolicyId) : null
  return { current, previous }
}

// ── PROPOSALS ─────────────────────────────────────────────────
export const proposalsRef = () => collection(db, PROPOSALS)
export async function addProposal(data) {
  return addDoc(proposalsRef(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}
export async function getAllProposals() {
  const s = await getDocs(query(proposalsRef(), orderBy('createdAt','desc')))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}
export async function updateProposal(id, data) {
  return updateDoc(doc(db,PROPOSALS,id), { ...data, updatedAt: serverTimestamp() })
}
export async function deleteProposal(id) { return deleteDoc(doc(db,PROPOSALS,id)) }

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
  return addDoc(claimsRef(), { ...data, status: data.status || 'Intimated', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}
export async function updateClaim(id, data) {
  return updateDoc(doc(db,CLAIMS,id), { ...data, updatedAt: serverTimestamp() })
}
export async function deleteClaim(id) { return deleteDoc(doc(db,CLAIMS,id)) }
export function subscribeClaims(callback) {
  return onSnapshot(query(claimsRef(), orderBy('createdAt','desc')),
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() }))))
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
  return addDoc(tasksRef(), { ...data, done: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}
export async function updateTask(id, data) {
  return updateDoc(doc(db,TASKS,id), { ...data, updatedAt: serverTimestamp() })
}
export async function deleteTask(id) { return deleteDoc(doc(db,TASKS,id)) }
export function subscribeTasks(callback) {
  return onSnapshot(query(tasksRef(), orderBy('dueDate','asc')),
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() }))))
}
export async function getAllTasks() {
  const s = await getDocs(query(tasksRef(), orderBy('dueDate','asc')))
  return s.docs.map(d => ({ id:d.id, ...d.data() }))
}
