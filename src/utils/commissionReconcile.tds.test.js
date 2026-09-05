import { describe, it, expect } from 'vitest'
import { RECONCILE_STATUS, reconcilePolicies, tdsSummary, txnGross } from './commissionReconcile'

const ASOF = new Date('2026-08-10T00:00:00Z')
const policy = (over = {}) => ({
  id: 'p1', policyNumber: 'POL-1', clientName: 'Asha', insurer: 'Star Health',
  policyType: 'Health', premium: 10000, fyCommission: 15, ryCommission: 10,
  policyYear: 1, status: 'Active', startDate: '2026-05-01', expiryDate: '2027-04-30',
  ...over,
})

describe('txnGross', () => {
  it('prefers the stored gross over bank-net plus TDS', () => {
    expect(txnGross({ receivedCommission: 1500, netReceived: 1425, tds: 75 })).toBe(1500)
  })

  it('rebuilds gross from net + TDS on older rows that only stored net', () => {
    expect(txnGross({ netReceived: 1425, tds: 75 })).toBe(1500)
  })
})

describe('TDS must not look like a short payment', () => {
  it('settles when gross matches the policy rate even if TDS was deducted', () => {
    const [row] = reconcilePolicies(
      [policy()],
      [{ policyId: 'p1', receivedCommission: 1500, netReceived: 1425, tds: 75, payoutMonth: '2026-06' }],
      { asOf: ASOF },
    )
    expect(row.status).toBe(RECONCILE_STATUS.RECEIVED)
    expect(row.received).toBe(1500)
    expect(row.tds).toBe(75)
  })
})

describe('tdsSummary gross is not double-counted', () => {
  it('does not add TDS on top of a row that already stored the gross', () => {
    const summary = tdsSummary([
      { insurer: 'Star Health', receivedCommission: 1500, netReceived: 1425, tds: 75, payoutMonth: '2026-06' },
    ])
    expect(summary.gross).toBe(1500)
    expect(summary.total).toBe(75)
    expect(summary.byInsurer[0].net).toBe(1425)
  })
})
