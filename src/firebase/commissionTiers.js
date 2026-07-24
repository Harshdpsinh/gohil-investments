// src/firebase/commissionTiers.js
// ─────────────────────────────────────────────────────────────
// New collection: commissionTiers  (single doc id: "active")
// Mirrors the subscribePolicies pattern from firestore.js.
// ─────────────────────────────────────────────────────────────
import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore'
import { db } from './config'

const COL = 'commissionTiers'
const DOC = 'active'

const DEFAULT_TIERS = [
  { id: 'tier_1', label: '0–50,000',           min: 0,     max: 50000,  rate: 0.02 },
  { id: 'tier_2', label: '50,000–2,00,000',    min: 50000,  max: 200000, rate: 0.04 },
  { id: 'tier_3', label: '2,00,000–5,00,000',  min: 200000, max: 500000, rate: 0.06 },
  { id: 'tier_4', label: '5,00,000+',          min: 500000, max: null,   rate: 0.08 },
]

/** Fetch the active tier configuration. Returns the doc data or the defaults. */
export async function getActiveTiers() {
  try {
    const s = await getDoc(doc(db, COL, DOC))
    if (s.exists() && Array.isArray(s.data().tiers) && s.data().tiers.length > 0) {
      return s.data().tiers
    }
  } catch (err) {
    console.error('getActiveTiers:', err.message)
  }
  return DEFAULT_TIERS
}

/** Save a new tier configuration (overwrites the "active" doc). */
export async function saveTiers(tiers) {
  return setDoc(doc(db, COL, DOC), {
    tiers,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

/**
 * subscribeTiers(callback, onError)
 * Realtime listener — mirrors subscribePolicies pattern.
 * callback receives the tiers array (or defaults).
 */
export function subscribeTiers(callback, onError) {
  return onSnapshot(
    doc(db, COL, DOC),
    (snap) => {
      if (snap.exists() && Array.isArray(snap.data().tiers) && snap.data().tiers.length > 0) {
        callback(snap.data().tiers)
      } else {
        callback(DEFAULT_TIERS)
      }
    },
    onError || (err => console.error('subscribeTiers:', err.code, err.message)),
  )
}
