import { describe, expect, it } from 'vitest'
import { fyMonthKeys, trackerRows, validateCommissionAmount, historyByMonth, historyBatches, paginateRows } from './commissionTracker'

describe('commissionTracker', () => {
  it('builds an April–March FY axis', () => {
    const months = fyMonthKeys(2026)
    expect(months[0]).toEqual({ key: '2026-04', label: 'Apr' })
    expect(months[11]).toEqual({ key: '2027-03', label: 'Mar' })
  })

  it('marks received, missing and not-applicable months', () => {
    const { rows } = trackerRows({
      fyStart: 2026,
      policies: [{
        id: 'p1', policyNumber: 'P1', clientName: 'Asha', insurer: 'Star Health',
        premium: 12000, fyCommission: 10, policyYear: 1,
        startDate: '2026-06-01', expiryDate: '2027-05-31',
      }],
      transactions: [{ policyId: 'p1', payoutMonth: '2026-07', receivedCommission: 1200 }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].cells['2026-04'].state).toBe('na')
    expect(rows[0].cells['2026-07'].state).toBe('received')
    expect(rows[0].cells['2026-08'].state).toBe('missing')
    expect(rows[0].receivedTotal).toBe(1200)
  })

  it('filters by client name / policy / pan search', () => {
    const { rows } = trackerRows({
      fyStart: 2026,
      query: 'asha',
      policies: [
        { id: 'p1', policyNumber: 'P1', clientName: 'Asha Shah', insurer: 'Star', premium: 1000, fyCommission: 10, startDate: '2026-04-01' },
        { id: 'p2', policyNumber: 'P2', clientName: 'Ketan', insurer: 'Star', premium: 1000, fyCommission: 10, startDate: '2026-04-01' },
      ],
      transactions: [],
    })
    expect(rows.map(r => r.policyId)).toEqual(['p1'])
  })

  it('rejects negative or overflow amounts', () => {
    expect(validateCommissionAmount(-1)).toMatch(/negative/)
    expect(validateCommissionAmount(99_000_000)).toMatch(/too large/)
    expect(validateCommissionAmount(250)).toBe('')
  })

  it('rolls posted rows into a month history', () => {
    const hist = historyByMonth([
      { policyId: 'p1', payoutMonth: '2026-07', receivedCommission: 100 },
      { policyId: 'p1', payoutMonth: '2026-07', receivedCommission: 50 },
      { policyId: 'p2', payoutMonth: '2026-08', receivedCommission: 20 },
    ], ['p1'])
    expect(hist.total).toBe(150)
    expect(hist.months).toEqual([{ month: '2026-07', amount: 150, count: 2 }])
  })

  it('groups posted rows into import batches', () => {
    const batches = historyBatches([
      { batchId: 'batch-1', sourceFileName: 'star.xlsx', payoutMonth: '2026-07', receivedCommission: 100 },
      { batchId: 'batch-1', sourceFileName: 'star.xlsx', payoutMonth: '2026-07', receivedCommission: 40 },
      { batchId: 'batch-2', sourceFileName: 'icici.csv', payoutMonth: '2026-08', receivedCommission: 20 },
    ])
    expect(batches).toHaveLength(2)
    expect(batches[0].id).toBe('batch-2')
    expect(batches[1].count).toBe(2)
    expect(batches[1].amount).toBe(140)
  })

  it('pages ledger rows 100 at a time', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: i }))
    const first = paginateRows(rows, 1, 100)
    expect(first.pages).toBe(2)
    expect(first.rows).toHaveLength(100)
    expect(paginateRows(rows, 2, 100).rows).toHaveLength(20)
  })
})
