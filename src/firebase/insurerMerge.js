// src/firebase/insurerMerge.js
// Rewrites stored company spellings onto the master name. Commission figures,
// policy numbers and dates are not touched — only insurer-name fields.
import { collection, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from './config'
import { insurerFieldPatch } from '../utils/insurers'

const TARGETS = [
  { name: 'policies', fields: ['insurer', 'prevInsurer', 'tpInsurer'] },
  { name: 'claims', fields: ['insurer'] },
  { name: 'proposals', fields: ['insurer'] },
  { name: 'commission_transactions', fields: ['insurer'] },
  { name: 'commission_master', fields: ['insurer', 'company'] },
  { name: 'endorsements', fields: ['insurer'] },
  { name: 'leads', fields: ['insurer'] },
  { name: 'clients', fields: ['latestPolicyInsurer'] },
  { name: 'renewal_reminder_logs', fields: ['insurer'] },
]

/**
 * Scan every collection that stores a company name and rewrite known variants
 * to the canonical spelling. Unknown names are left alone.
 */
export async function mergeCanonicalInsurerNames(onProgress = () => {}) {
  const writes = []
  const byCollection = {}
  let scanned = 0

  for (const target of TARGETS) {
    let snap
    try {
      snap = await getDocs(collection(db, target.name))
    } catch {
      byCollection[target.name] = { scanned: 0, updated: 0, skipped: true }
      continue
    }

    let updated = 0
    snap.docs.forEach(item => {
      scanned += 1
      const patch = insurerFieldPatch(item.data() || {}, target.fields)
      if (Object.keys(patch).length === 0) return
      writes.push({
        ref: item.ref,
        data: { ...patch, updatedAt: serverTimestamp() },
      })
      updated += 1
    })
    byCollection[target.name] = { scanned: snap.size, updated }
  }

  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db)
    writes.slice(i, i + 400).forEach(({ ref, data }) => batch.update(ref, data))
    await batch.commit()
    onProgress(Math.min(i + 400, writes.length), writes.length)
  }

  return { scanned, updated: writes.length, byCollection }
}
