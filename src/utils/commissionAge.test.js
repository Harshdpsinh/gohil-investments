import { describe, it, expect } from 'vitest'
import { agedOutstanding, agedOutstandingTotals } from './commissionAge.js'

describe('agedOutstanding', () => {
  it('keeps only chaseable rows at or past the day threshold', () => {
    const rows = [
      { policyId: 'a', chaseable: true, ageingDays: 59, expected: 100 },
      { policyId: 'b', chaseable: true, ageingDays: 60, expected: 200 },
      { policyId: 'c', chaseable: true, ageingDays: 120, expected: 300 },
      { policyId: 'd', chaseable: false, ageingDays: 200, expected: 999 },
    ]
    const aged = agedOutstanding(rows, 60)
    expect(aged.map(row => row.policyId)).toEqual(['b', 'c'])
    expect(agedOutstandingTotals(rows, 60)).toEqual({ count: 2, amount: 500 })
  })
})
