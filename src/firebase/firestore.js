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
export async function deleteClient(id) {
  const pols = await getDocs(query(collection(db,POLICIES), where('clientId','==',id)))
  const batch = writeBatch(db)
  pols.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(db,CLIENTS,id))
  return batch.commit()
}
export function subscribeClients(callback) {
  return onSnapshot(query(clientsRef(), orderBy('createdAt','desc')),
    s => callback(s.docs.map(d => ({ id:d.id, ...d.data() }))))
}

// Proposal upsert helper
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

export async function addPolicy(data) {
  return addDoc(policiesRef(), {
    ...data,
    parentPolicyId: data.parentPolicyId || null,
    policyYear:     data.policyYear     || 1,
    renewedAt:      null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
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
  return updateDoc(doc(db,POLICIES,id), { ...data, updatedAt: serverTimestamp() })
}
export async function deletePolicy(id) { return deleteDoc(doc(db,POLICIES,id)) }
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
/**
 * saveRenewal(oldPolicyId, newPolicyData)
 *
 * Atomically:
 *   1. Marks old policy as status='Renewed-Out' + renewedAt=now
 *   2. Creates new policy with parentPolicyId=oldPolicyId, policyYear=old+1
 *
 * Returns the new policy's document reference.
 */
export async function saveRenewal(oldPolicyId, newData) {
  // Fetch old policy to get policyYear
  const old = await getPolicy(oldPolicyId)
  if (!old) throw new Error('Original policy not found')

  const batch = writeBatch(db)

  // 1. Archive the old policy
  batch.update(doc(db, POLICIES, oldPolicyId), {
    status:    'Renewed-Out',
    renewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  // 2. New policy document ref
  const newRef = doc(collection(db, POLICIES))
  batch.set(newRef, {
    ...newData,
    parentPolicyId: oldPolicyId,
    policyYear:     (old.policyYear || 1) + 1,
    status:         'Active',
    renewedAt:      null,
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  })

  await batch.commit()
  return newRef
}

/**
 * getPolicyChain(policyId)
 *
 * Returns { current, previous } for side-by-side comparison view.
 * previous is null if this is the first-year policy.
 */
export async function getPolicyChain(policyId) {
  const current = await getPolicy(policyId)
  if (!current) return { current: null, previous: null }
  const previous = current.parentPolicyId
    ? await getPolicy(current.parentPolicyId)
    : null
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
// Claim statuses (pipeline order)
export const CLAIM_STATUSES = [
  'Intimated',
  'Documents Submitted',
  'Under Review',
  'Approved',
  'Settled',
  'Rejected',
]

export const claimsRef = () => collection(db, CLAIMS)

export async function addClaim(data) {
  return addDoc(claimsRef(), {
    ...data,
    status:    data.status || 'Intimated',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
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
  return addDoc(tasksRef(), {
    ...data,
    done:      false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
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
