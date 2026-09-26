import { describe, expect, it } from 'vitest'
import {
  amountFromPct, bookedPct, draftFromAmount, entryRows, entryTotals, insurerChoices, pctFromAmount,
} from './commissionEntry'

const star = {
  id: 'p1', policyNumber: 'S1', clientName: 'Asha', insurer: 'Star Health',
  premium: 10000, fyCommission: 15, policyYear: 1,
  startDate: '2026-04-01', expiryDate: '2027-03-31', policyType: 'Health',
}
const lic = {
  id: 'p2', policyNumber: 'L1', clientName: 'Ketan', insurer: 'LIC',
  premium: 20000, fyCommission: 25, ryCommission: 5, policyYear: 2,
  startDate: '2025-01-01', policyType: 'Life',
}

describe('commissionEntry', () => {
  it('groups insurer spellings and counts policies', () => {
    const choices = insurerChoices([star, lic, { ...star, id: 'p3', insurer: 'Star Health and Allied Insurance' }])
    expect(choices.find(c => c.name.includes('Star'))?.count).toBe(2)
    expect(choices.find(c => c.name.includes('LIC'))?.name).toBe('LIC of India')
  })

  it('uses the renewal rate after year one', () => {
    expect(bookedPct(star)).toBe(15)
    expect(bookedPct(lic)).toBe(5)
    expect(amountFromPct(20000, 5)).toBe(1000)
    expect(pctFromAmount(20000, 1000)).toBe(5)
  })

  it('lists only the chosen company and month, and marks what is already paid', () => {
    const rows = entryRows({
      policies: [star, lic, { ...star, id: 'p4', startDate: '2026-09-01', policyNumber: 'FUTURE' }],
      transactions: [{ policyId: 'p1', payoutMonth: '2026-07', receivedCommission: 1500 }],
      insurerKey: insurerChoices([star])[0].key,
      month: '2026-07',
    })
    expect(rows.map(r => r.policyNumber)).toEqual(['S1'])
    expect(rows[0].received).toBe(true)
    expect(rows[0].expected).toBe(1500)
  })

  it('leaves a policy unpaid when that month has no ledger row', () => {
    const rows = entryRows({
      policies: [star],
      transactions: [{ policyId: 'p1', payoutMonth: '2026-06', receivedCommission: 1500 }],
      insurerKey: insurerChoices([star])[0].key,
      month: '2026-07',
    })
    expect(rows[0].received).toBe(false)
    expect(rows[0].bookedPct).toBe(15)
  })

  it('totals only the rows you are about to save, and works out the blended percentage', () => {
    const totals = entryTotals([
      { premium: 10000, amount: 1500, include: true },
      { premium: 20000, amount: 1000, include: true },
      { premium: 5000, amount: 500, include: false },
    ])
    expect(totals).toEqual({ policies: 2, premium: 30000, commission: 2500, pct: 8.33 })
  })

  it('recalculates the percentage when the rupee amount is typed', () => {
    expect(draftFromAmount(10000, '1250')).toMatchObject({ pct: '12.5', error: '' })
    expect(draftFromAmount(10000, '-1').error).toMatch(/negative/)
  })
})
