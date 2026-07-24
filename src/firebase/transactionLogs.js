// src/firebase/transactionLogs.js
// ─────────────────────────────────────────────────────────────
// New collection: transactionLogs
// Pure audit trail — does NOT write to policies, clients, or any
// existing collection. Each doc is a processed transaction record
// created by the Commission Agent page.
// ─────────────────────────────────────────────────────────────
import {
  collection, addDoc, query, orderBy, onSnapshot,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './config'

const COL = 'transactionLogs'

/** Append a processed transaction to the audit log. */
export async function addTransactionLog(result) {
  return addDoc(collection(db, COL), {
    ...result,
    createdAt: serverTimestamp(),
  })
}

/**
 * subscribeTransactionLogs(callback, onError)
 * Realtime listener — newest first.
 * callback receives an array of log docs.
 */
export function subscribeTransactionLogs(callback, onError) {
  return onSnapshot(
    query(collection(db, COL), orderBy('createdAt', 'desc')),
    (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError || (err => console.error('subscribeTransactionLogs:', err.code, err.message)),
  )
}
