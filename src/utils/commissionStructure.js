// Pure helpers for inline commission_master upserts from statement rates.
// Master writes are keyed FY vs RY separately so Fresh never clobbers Renewal.
import { commissionRateField } from './commissionImport'
import { canonicalInsurer } from './insurers'

const slug = value => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'na'

/** Stable Firestore doc id for a rate rule. */
export function masterStructureId({
  insurer = '',
  product = '',
  insuranceType = '',
  policyYear = '',
  businessType = '',
  premiumMin = '',
  premiumMax = '',
} = {}) {
  return [
    slug(insurer),
    slug(product),
    slug(insuranceType),
    slug(policyYear),
    slug(businessType),
    slug(premiumMin === '' || premiumMin == null ? 'any' : premiumMin),
    slug(premiumMax === '' || premiumMax == null ? 'any' : premiumMax),
  ].join('__').slice(0, 700)
}

export function policyYearKey(policy = {}, businessType = '') {
  return commissionRateField(policy, businessType) === 'ryCommission' ? 'RY' : 'FY'
}

/** Soft premium band when the statement carries a premium; empty = no band. */
export function premiumBand(premium) {
  const amount = Number(premium)
  if (!Number.isFinite(amount) || amount <= 0) return { premiumMin: null, premiumMax: null }
  if (amount < 10000) return { premiumMin: 0, premiumMax: 9999 }
  if (amount < 25000) return { premiumMin: 10000, premiumMax: 24999 }
  if (amount < 50000) return { premiumMin: 25000, premiumMax: 49999 }
  if (amount < 100000) return { premiumMin: 50000, premiumMax: 99999 }
  return { premiumMin: 100000, premiumMax: null }
}

/**
 * Whether this review/import row is allowed to update commission_master.
 * Name-only / unmatched / low-confidence without a bound policy are blocked.
 */
export function canUpdateStructure(row = {}, policy = null) {
  const bound = policy || row.policy || null
  if (!bound?.id) return false
  if (row.status === 'unmatched') return false
  // Review is fine once a policy is bound (OK / Include / matched).
  if (row.status === 'matched' || row.status === 'review') {
    const pct = Number(row.commissionPct)
    const reward = Number(row.rewardPct)
    return (Number.isFinite(pct) && pct > 0 && pct <= 100)
      || (Number.isFinite(reward) && reward > 0 && reward <= 100)
  }
  return false
}

/**
 * Build a proposed commission_master upsert from a statement row + bound policy.
 * Returns null when guards fail. Does not write.
 */
export function proposeMasterUpsert(row = {}, policy = null, {
  sourceFileName = '',
  user = null,
  existingMaster = null,
  usePremiumBand = true,
} = {}) {
  const bound = policy || row.policy || null
  if (!canUpdateStructure(row, bound)) return null

  const rateField = commissionRateField(bound, row.businessType)
  const yearKey = rateField === 'ryCommission' ? 'RY' : 'FY'
  const insurer = canonicalInsurer(row.insurer || bound.insurer) || String(row.insurer || bound.insurer || '').trim()
  const product = String(row.planName || bound.planName || '').trim()
  const insuranceType = String(bound.policyType || row.insuranceType || '').trim()
  const businessType = String(row.businessType || '').trim()
  const band = usePremiumBand ? premiumBand(row.premium || bound.premium) : { premiumMin: null, premiumMax: null }

  const newPct = Number(row.commissionPct)
  const rewardPct = Number(row.rewardPct)
  const hasCommission = Number.isFinite(newPct) && newPct > 0 && newPct <= 100
  const hasReward = Number.isFinite(rewardPct) && rewardPct > 0 && rewardPct <= 100
  if (!hasCommission && !hasReward) return null

  const previousFromMaster = existingMaster && Number.isFinite(Number(existingMaster.commissionPct))
    ? Number(existingMaster.commissionPct)
    : null
  const previousFromPolicy = Number(bound[rateField])
  const previousPct = previousFromMaster != null
    ? previousFromMaster
    : (Number.isFinite(previousFromPolicy) ? previousFromPolicy : 0)

  const id = masterStructureId({
    insurer,
    product,
    insuranceType,
    policyYear: yearKey,
    businessType,
    premiumMin: band.premiumMin,
    premiumMax: band.premiumMax,
  })

  const beforeSnapshot = existingMaster
    ? {
        commissionPct: existingMaster.commissionPct ?? null,
        rewardPct: existingMaster.rewardPct ?? null,
        active: existingMaster.active ?? null,
        policyYear: existingMaster.policyYear ?? null,
      }
    : {
        commissionPct: Number.isFinite(previousFromPolicy) ? previousFromPolicy : null,
        rewardPct: null,
        active: null,
        policyYear: yearKey,
        source: 'policy-or-empty',
      }

  const afterSnapshot = {
    commissionPct: hasCommission ? newPct : (existingMaster?.commissionPct ?? null),
    rewardPct: hasReward ? rewardPct : (existingMaster?.rewardPct ?? null),
    active: true,
    policyYear: yearKey,
  }

  const payload = {
    insurer,
    product,
    insuranceType,
    policyYear: yearKey,
    businessType,
    premiumMin: band.premiumMin,
    premiumMax: band.premiumMax,
    active: true,
    structureUpdated: true,
    previousPct,
    newPct: hasCommission ? newPct : previousPct,
    updatedBy: user?.uid || '',
    updatedByEmail: user?.email || '',
    sourceFileName: sourceFileName || '',
    rateField,
    beforeSnapshot,
    afterSnapshot,
  }
  if (hasCommission) payload.commissionPct = newPct
  if (hasReward) payload.rewardPct = rewardPct

  // Keep FY/RY isolation explicit for callers / tests.
  payload.guards = {
    policyYearKey: yearKey,
    willNotClobberOppositeYear: true,
    requiresBoundPolicy: true,
  }

  return { id, payload, rateField, previousPct, newPct: payload.newPct }
}

/** Columns so structure history is visible on CSV/PDF/Excel pulls. */
export const STRUCTURE_HISTORY_COLS = [
  { header: 'Structure Updated', accessor: r => (r.structureUpdated ? 'Yes' : '') },
  { header: 'Previous %', accessor: r => (r.previousPct ?? r.structurePreviousPct ?? '') },
  { header: 'New %', accessor: r => (r.newPct ?? r.structureNewPct ?? '') },
  { header: 'Structure Updated At', accessor: r => r.structureUpdatedAt || r.updatedAt || '' },
  { header: 'Updated By', accessor: r => r.updatedByEmail || r.structureUpdatedBy || r.updatedBy || '' },
  { header: 'Source File', accessor: r => r.sourceFileName || r.structureSourceFileName || '' },
]

/** Merge structure history onto a policy export row (legacy masters/policies stay blank). */
export function withStructureExportFields(row = {}) {
  return {
    ...row,
    structureUpdated: Boolean(row.structureUpdated),
    previousPct: row.previousPct ?? row.structurePreviousPct ?? '',
    newPct: row.newPct ?? row.structureNewPct ?? '',
    updatedAt: row.structureUpdatedAt || row.updatedAt || '',
    updatedBy: row.updatedByEmail || row.structureUpdatedBy || row.updatedBy || '',
    sourceFileName: row.sourceFileName || row.structureSourceFileName || '',
  }
}

/** Additive policy stamp when a structure update is applied. */
export function policyStructureStamp(proposal, { sourceFileName = '' } = {}) {
  if (!proposal?.payload) return {}
  const { payload, rateField } = proposal
  const stamp = {
    structureUpdated: true,
    structurePreviousPct: proposal.previousPct,
    structureNewPct: proposal.newPct,
    structureUpdatedAt: new Date().toISOString(),
    structureUpdatedBy: payload.updatedByEmail || payload.updatedBy || '',
    structureSourceFileName: sourceFileName || payload.sourceFileName || '',
    previousPct: proposal.previousPct,
    newPct: proposal.newPct,
    sourceFileName: sourceFileName || payload.sourceFileName || '',
  }
  if (rateField && Number.isFinite(Number(payload.commissionPct))) {
    stamp[rateField] = Number(payload.commissionPct)
  }
  return stamp
}
