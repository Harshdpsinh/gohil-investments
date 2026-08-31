import { describe, it, expect } from 'vitest'
import {
  insurerRewritePlan,
  legacySettlementPayload,
  manualCommissionPayload,
  policiesToSettle,
  rewrittenIciciName,
} from './commissionSettle'

const policy = (over = {}) => ({
  id: 'p1', policyNumber: 'POL-1', clientName: 'Asha', insurer: 'Star Health',
  policyType: 'Health', premium: 10000, fyCommission: 15, ryCommission: 10,
  policyYear: 1, startDate: '2025-05-01', createdAt: '2026-03-01',
  ...over,
})

describe('policiesToSettle', () => {
  it('picks a booked policy with a rate and no ledger row', () => {
    expect(policiesToSettle([policy()], [])).toEqual([expect.objectContaining({ id: 'p1' })])
  })

  it('skips a policy that already has a posted receipt', () => {
    expect(policiesToSettle([policy()], [{ policyId: 'p1', netReceived: 1500 }])).toEqual([])
  })

  it('skips a policy with no rate on file', () => {
    expect(policiesToSettle([policy({ fyCommission: 0 })], [])).toEqual([])
  })

  it('skips policies created after the cutoff', () => {
    const cutoff = new Date('2026-08-01')
    const old = policy({ id: 'old', createdAt: '2026-04-01' })
    const fresh = policy({ id: 'new', createdAt: '2026-08-15' })
    expect(policiesToSettle([old, fresh], [], { cutoff }).map(p => p.id)).toEqual(['old'])
  })

  it('skips soft-deleted policies', () => {
    expect(policiesToSettle([policy({ deleted: true })], [])).toEqual([])
  })
})

describe('legacySettlementPayload', () => {
  it('posts the expected amount as received', () => {
    const row = legacySettlementPayload(policy(), { user: { uid: 'u1', email: 'a@b.c' } })
    expect(row.receivedCommission).toBe(1500)
    expect(row.netReceived).toBe(1500)
    expect(row.difference).toBe(0)
    expect(row.postingKey).toBe('legacy-settled_p1')
    expect(row.payoutMonth).toBe('2025-05')
  })
})

describe('manualCommissionPayload', () => {
  it('records the typed amount against the policy', () => {
    const row = manualCommissionPayload(policy(), { amount: 900, payoutMonth: '2026-08', tds: 45 })
    expect(row.netReceived).toBe(900)
    expect(row.tds).toBe(45)
    expect(row.difference).toBe(-600)
    expect(row.postingKey).toBe('')
  })

  it('refuses an entry with no amount', () => {
    expect(() => manualCommissionPayload(policy(), { payoutMonth: '2026-08' }))
      .toThrow(/Commission amount is required/)
  })
})

describe('rewrittenIciciName', () => {
  it('maps the truncated dashboard spelling onto Lombard', () => {
    expect(rewrittenIciciName('ICIC')).toBe('ICICI Lombard General Insurance')
    expect(rewrittenIciciName('ICICI')).toBe('ICICI Lombard General Insurance')
  })

  it('maps a bare ICICI life policy onto Prudential instead', () => {
    expect(rewrittenIciciName('ICIC', 'Life')).toBe('ICICI Prudential Life Insurance')
  })

  it('leaves a name that is already specific alone', () => {
    expect(rewrittenIciciName('ICICI Lombard General Insurance')).toBe('')
    expect(rewrittenIciciName('ICICI Prudential Life Insurance')).toBe('')
    expect(rewrittenIciciName('Star Health')).toBe('')
  })
})

describe('insurerRewritePlan', () => {
  it('rewrites ICIC on the policy and on any linked ledger row', () => {
    const plan = insurerRewritePlan(
      [policy({ insurer: 'ICIC', policyType: 'Motor' })],
      [{ id: 't1', policyId: 'p1', insurer: 'ICIC' }],
    )
    expect(plan.policyUpdates).toEqual([{ id: 'p1', from: 'ICIC', to: 'ICICI Lombard General Insurance' }])
    expect(plan.transactionUpdates).toEqual([{ id: 't1', from: 'ICIC', to: 'ICICI Lombard General Insurance' }])
  })
})
