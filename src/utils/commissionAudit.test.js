import { describe, expect, it } from 'vitest'
import { AUDIT_STATUS, auditCommission, payoutMoney } from './commissionAudit'

const policy = (over = {}) => ({
  id: 'p1',
  policyNumber: 'P/2026/0002955',
  clientName: 'Asha Shah',
  insurer: 'Star Health',
  planName: 'Family Health',
  premium: 10000,
  fyCommission: 15,
  policyYear: 1,
  startDate: '2026-04-01',
  clientId: 'c1',
  ...over,
})

const payout = (over = {}) => ({
  id: 't1',
  policyNumber: 'P/2026/0002955',
  clientName: 'Asha Shah',
  insurer: 'Star Health',
  planName: 'Family Health',
  premium: 10000,
  receivedCommission: 1500,
  netReceived: 1425,
  tds: 75,
  payoutDate: '2026-06-15',
  payoutMonth: '2026-06',
  ...over,
})

describe('payoutMoney', () => {
  it('compares expected with gross when TDS is identified', () => {
    expect(payoutMoney(payout()).actual).toBe(1500)
  })

  it('uses net when the statement gives no TDS split', () => {
    expect(payoutMoney({ netReceived: 900, receivedCommission: 1000 }).actual).toBe(900)
  })
})

describe('auditCommission', () => {
  it('matches an exact policy number inside tolerance and ignores TDS', () => {
    const report = auditCommission({ policies: [policy()], payouts: [payout()] })
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].status).toBe(AUDIT_STATUS.MATCHED)
    expect(report.rows[0].variance).toBe(0)
    expect(report.rows[0].tds).toBe(75)
    expect(report.summary.matched).toBe(1)
  })

  it('classifies a short payment without inventing a reason', () => {
    const report = auditCommission({
      policies: [policy()],
      payouts: [payout({ receivedCommission: 1000, netReceived: 1000, tds: 0 })],
    })
    expect(report.shortfalls).toHaveLength(1)
    expect(report.shortfalls[0].variance).toBe(500)
    expect(report.shortfalls[0].reason).toMatch(/not established/)
  })

  it('lists a CRM booking with no payout as missing', () => {
    const report = auditCommission({ policies: [policy()], payouts: [] })
    expect(report.missingInStatement).toHaveLength(1)
    expect(report.missingInStatement[0].expected).toBe(1500)
    expect(report.missingInStatement[0].actual).toBeNull()
  })

  it('does not treat a name-only payout as posted', () => {
    const report = auditCommission({
      policies: [policy()],
      payouts: [payout({ id: 't2', policyNumber: '', clientName: 'Asha Shah', insurer: '' })],
    })
    expect(report.missingInStatement).toHaveLength(1)
    expect(report.rows.some(row => row.status === AUDIT_STATUS.MATCHED)).toBe(false)
  })

  it('flags a policy-number match when the client name conflicts', () => {
    const report = auditCommission({
      policies: [policy()],
      payouts: [payout({ clientName: 'Totally Different Person' })],
    })
    expect(report.conflicts).toHaveLength(1)
    expect(report.conflicts[0].score).toBeLessThan(60)
    expect(report.missingInStatement).toHaveLength(1)
  })

  it('keeps an unusable payout out of received and names it unbooked', () => {
    const report = auditCommission({
      policies: [policy({ policyNumber: 'OTHER-1' })],
      payouts: [payout({ policyNumber: 'ZZ-999', clientName: 'Nobody Known' })],
    })
    expect(report.unbooked).toHaveLength(1)
    expect(report.rows.find(row => row.status === AUDIT_STATUS.MISSING).actual).toBeNull()
    expect(report.unbooked[0].actual).toBe(1500)
  })

  it('does not count a duplicate source row twice', () => {
    const report = auditCommission({
      policies: [policy()],
      payouts: [
        payout({ id: '', rowHash: 'same', sourceRow: 4 }),
        payout({ id: '', rowHash: 'same', sourceRow: 4 }),
      ],
    })
    expect(report.duplicates).toHaveLength(1)
    expect(report.rows.find(row => row.status === AUDIT_STATUS.MATCHED).actual).toBe(1500)
  })

  it('sums two different components for the same policy', () => {
    const report = auditCommission({
      policies: [policy({ fyCommission: 20 })],
      payouts: [
        payout({ id: 'a', receivedCommission: 1000, netReceived: 1000, tds: 0, sourceRow: 1 }),
        payout({ id: 'b', receivedCommission: 1000, netReceived: 1000, tds: 0, sourceRow: 2 }),
      ],
    })
    const row = report.rows.find(item => item.policyNumber === 'P/2026/0002955' && item.status !== AUDIT_STATUS.DUPLICATE)
    expect(row.actual).toBe(2000)
    expect(row.components).toHaveLength(2)
    expect(row.status).toBe(AUDIT_STATUS.MATCHED)
  })
})
