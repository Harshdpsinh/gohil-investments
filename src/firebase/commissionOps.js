// src/firebase/commissionOps.js
// Extra commission writes that do not belong in the 1,500-line firestore.js.
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from './config'
import { addCommissionTransaction, CRM_COLLECTIONS } from './firestore'
import { insurerRewritePlan, legacySettlementPayload, manualCommissionPayload, policiesToSettle } from '../utils/commissionSettle'

const TXNS = CRM_COLLECTIONS.COMMISSION_TRANSACTIONS
const POLICIES = CRM_COLLECTIONS.POLICIES
const MASTER = CRM_COLLECTIONS.COMMISSION_MASTER

export async function updateCommissionTransaction(id, data = {}) {
  if (!id) throw new Error('Commission row id is required.')
  const payload = {}
  const numeric = ['premium', 'expectedCommission', 'receivedCommission', 'rewardCommission', 'tds', 'gst', 'netReceived', 'difference']
  for (const field of numeric) {
    if (data[field] !== undefined) payload[field] = Number(data[field]) || 0
  }
  for (const field of ['payoutDate', 'payoutMonth', 'remarks', 'insurer', 'businessType', 'planName', 'status']) {
    if (data[field] !== undefined) payload[field] = String(data[field] ?? '')
  }
  if (payload.receivedCommission !== undefined && payload.netReceived === undefined) {
    payload.netReceived = payload.receivedCommission
  }
  if (payload.expectedCommission !== undefined && payload.netReceived !== undefined && payload.difference === undefined) {
    payload.difference = payload.netReceived - payload.expectedCommission
  }
  payload.updatedAt = serverTimestamp()
  await updateDoc(doc(db, TXNS, id), payload)
}

export async function addManualCommission(policy, values, { user } = {}) {
  return addCommissionTransaction(manualCommissionPayload(policy, values, { user }))
}

export async function settleExistingBookCommissions(policies, transactions, { user, cutoff = new Date() } = {}) {
  const targets = policiesToSettle(policies, transactions, { cutoff })
  let posted = 0
  let skipped = 0
  for (const policy of targets) {
    try {
      await addCommissionTransaction(legacySettlementPayload(policy, { user }))
      posted += 1
    } catch (err) {
      if (err?.code === 'commission/duplicate-post') skipped += 1
      else throw err
    }
  }
  await setDoc(doc(db, MASTER, 'book-settlement'), {
    settledAt: serverTimestamp(),
    cutoff: cutoff.toISOString(),
    posted,
    skipped,
    settledBy: user?.email || user?.uid || '',
  }, { merge: true })
  return { posted, skipped, remaining: targets.length - posted - skipped }
}

export async function getBookSettlement() {
  const snap = await getDoc(doc(db, MASTER, 'book-settlement'))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function rewriteIciciInsurerNames(policies = [], transactions = []) {
  const plan = insurerRewritePlan(policies, transactions)
  const writes = [
    ...plan.policyUpdates.map(row => ({ ref: doc(db, POLICIES, row.id), data: { insurer: row.to, updatedAt: serverTimestamp() } })),
    ...plan.transactionUpdates.map(row => ({ ref: doc(db, TXNS, row.id), data: { insurer: row.to, updatedAt: serverTimestamp() } })),
  ]
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db)
    writes.slice(i, i + 400).forEach(({ ref, data }) => batch.update(ref, data))
    await batch.commit()
  }
  return { policies: plan.policyUpdates.length, transactions: plan.transactionUpdates.length }
}
