// src/utils/commissionSettle.js
import { expectedCommission } from './commissionReconcile'
import { parseAnyDate } from './dateUtils'
import { canonicalInsurer, insurerKey } from './insurers'

function createdAtDate(policy) {
  const raw = policy?.createdAt
  if (!raw) return parseAnyDate(policy?.startDate)
  if (typeof raw.toDate === 'function') return raw.toDate()
  if (typeof raw.seconds === 'number') return new Date(raw.seconds * 1000)
  return parseAnyDate(raw)
}

export function policiesToSettle(policies = [], transactions = [], { cutoff = null } = {}) {
  const paid = new Set(transactions.map(txn => txn?.policyId).filter(Boolean))
  return policies.filter(policy => {
    if (!policy?.id || policy.deleted) return false
    if (paid.has(policy.id)) return false
    if (expectedCommission(policy) <= 0) return false
    if (cutoff) {
      const created = createdAtDate(policy)
      if (created && created > cutoff) return false
    }
    return true
  })
}

export function legacySettlementPayload(policy = {}, { user = {}, payoutMonth = '' } = {}) {
  const expected = expectedCommission(policy)
  const month = payoutMonth || String(policy.startDate || '').slice(0, 7)
  return {
    policyId: policy.id || '',
    policyNumber: policy.policyNumber || '',
    clientId: policy.clientId || '',
    clientName: policy.clientName || '',
    insurer: policy.insurer || '',
    businessType: Number(policy.policyYear) > 1 ? 'Renewal' : 'Fresh',
    planName: policy.planName || '',
    premium: Number(policy.premium) || 0,
    expectedCommission: expected,
    receivedCommission: expected,
    rewardCommission: 0,
    tds: 0,
    gst: 0,
    netReceived: expected,
    difference: 0,
    payoutDate: '',
    payoutMonth: month,
    status: 'posted',
    postingKey: `legacy-settled_${policy.id}`,
    createdBy: user.uid || '',
    createdByEmail: user.email || '',
    remarks: 'One-time settlement: commission received before this policy was uploaded to the app',
  }
}

export function manualCommissionPayload(policy = {}, values = {}, { user = {} } = {}) {
  const amount = Number(values.amount)
  if (!policy?.id) throw new Error('Pick a policy first.')
  if (!Number.isFinite(amount)) throw new Error('Commission amount is required.')
  const expected = expectedCommission(policy)
  const payoutDate = String(values.payoutDate || '').trim()
  const payoutMonth = String(values.payoutMonth || payoutDate.slice(0, 7) || '').trim()
  if (!payoutMonth) throw new Error('Payout month is required.')
  return {
    policyId: policy.id,
    policyNumber: policy.policyNumber || '',
    clientId: policy.clientId || '',
    clientName: policy.clientName || '',
    insurer: policy.insurer || '',
    businessType: values.businessType || (Number(policy.policyYear) > 1 ? 'Renewal' : 'Fresh'),
    planName: values.planName || policy.planName || '',
    premium: Number(policy.premium) || 0,
    expectedCommission: expected,
    receivedCommission: amount,
    rewardCommission: 0,
    tds: Number(values.tds) || 0,
    gst: Number(values.gst) || 0,
    netReceived: amount,
    difference: amount - expected,
    payoutDate,
    payoutMonth,
    status: 'posted',
    postingKey: '',
    createdBy: user.uid || '',
    createdByEmail: user.email || '',
    remarks: values.remarks || 'Manual commission entry',
  }
}

export function rewrittenIciciName(name, policyType = '') {
  const text = String(name || '').trim()
  if (!text) return ''
  const key = insurerKey(text)
  if (key !== 'icic' && key !== 'icici') return ''
  return canonicalInsurer(text, { policyType })
}

export function insurerRewritePlan(policies = [], transactions = []) {
  const policyUpdates = []
  const transactionUpdates = []
  for (const policy of policies) {
    const next = rewrittenIciciName(policy.insurer, policy.policyType)
    if (next && next !== policy.insurer) policyUpdates.push({ id: policy.id, from: policy.insurer, to: next })
  }
  for (const txn of transactions) {
    const policy = policies.find(p => p.id === txn.policyId)
    const next = rewrittenIciciName(txn.insurer, policy?.policyType)
    if (next && next !== txn.insurer) transactionUpdates.push({ id: txn.id, from: txn.insurer, to: next })
  }
  return { policyUpdates, transactionUpdates }
}
