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

/**
 * Upsert a commission_master rate rule from a statement-driven proposal.
 * Admin-only via firestore.rules. Stamps audit fields on the master doc
 * (no separate commission_structure_updates collection — least rules churn).
 */
export async function upsertCommissionMaster(proposal, { existing } = {}) {
  if (!proposal?.id || !proposal?.payload) {
    throw new Error('Structure update proposal is required.')
  }
  const ref = doc(db, MASTER, proposal.id)
  const snap = existing ? { exists: () => true, data: () => existing } : await getDoc(ref)
  const before = snap.exists() ? snap.data() : null

  // Re-derive previousPct from live master when available so concurrent edits don't lose history.
  const previousPct = before && Number.isFinite(Number(before.commissionPct))
    ? Number(before.commissionPct)
    : proposal.previousPct

  const { guards: _guards, ...safeProposal } = proposal.payload
  const payload = {
    ...safeProposal,
    previousPct,
    beforeSnapshot: before
      ? {
          commissionPct: before.commissionPct ?? null,
          rewardPct: before.rewardPct ?? null,
          active: before.active ?? null,
          policyYear: before.policyYear ?? null,
        }
      : proposal.payload.beforeSnapshot,
    updatedAt: serverTimestamp(),
  }
  // Never let FY payload rewrite an RY doc or vice versa — id already isolates,
  // but refuse if an existing doc somehow has the opposite year key.
  if (before?.policyYear && payload.policyYear && before.policyYear !== payload.policyYear) {
    const err = new Error(`Refusing to clobber ${before.policyYear} master with ${payload.policyYear} rates.`)
    err.code = 'commission/year-clobber'
    throw err
  }

  await setDoc(ref, payload, { merge: true })
  return { id: proposal.id, previousPct, newPct: payload.newPct, ref }
}
