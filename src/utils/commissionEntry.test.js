import { describe, expect, it } from 'vitest'
import {
  amountFromPct, bookedPct, draftFromAmount, dueInMonth, entryRows, entryTotals, insurerChoices, pctFromAmount,
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

  it('lists a yearly policy on its start month and its end month only', () => {
    expect(dueInMonth(star, '2026-04')).toBe(true)
    expect(dueInMonth(star, '2027-03')).toBe(true)
    expect(dueInMonth({ ...star, startDate: '15/04/2026', expiryDate: '14/04/2027' }, '2026-07')).toBe(false)
    expect(dueInMonth({ ...star, startDate: '15/04/2026', expiryDate: '14/04/2027' }, '2027-04')).toBe(true)
    expect(dueInMonth({ ...star, status: 'Renewed-Out' }, '2026-04')).toBe(false)
  })

  it('lists installment policies on each premium month between start and end', () => {
    const monthly = { ...star, frequency: 'Monthly' }
    expect(dueInMonth(monthly, '2026-07')).toBe(true)
    expect(dueInMonth(monthly, '2027-04')).toBe(false)
    const quarterly = { ...star, frequency: 'Quarterly' }
    expect(dueInMonth(quarterly, '2026-07')).toBe(true)
    expect(dueInMonth(quarterly, '2026-05')).toBe(false)
  })

  it('uses the life anniversary when there is no end date', () => {
    expect(dueInMonth(lic, '2026-01')).toBe(true)
    expect(dueInMonth(lic, '2026-07')).toBe(false)
    expect(dueInMonth({ ...lic, nextPremiumDue: '2026-08-12' }, '2026-08')).toBe(true)
  })

  it('lists only the chosen company and month, and marks what is already paid', () => {
    const rows = entryRows({
      policies: [star, lic, { ...star, id: 'p4', startDate: '2026-09-01', policyNumber: 'FUTURE' }],
      transactions: [{ policyId: 'p1', payoutMonth: '2026-04', receivedCommission: 1500 }],
      insurerKey: insurerChoices([star])[0].key,
      month: '2026-04',
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
      month: '2026-04',
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

  it('narrows a month to one client without dropping the rest of that client’s policies', () => {
    const other = { ...star, id: 'p9', policyNumber: 'S9', clientName: 'Mehul', insurer: 'LIC', policyType: 'Life' }
    const rows = entryRows({
      policies: [star, other],
      transactions: [],
      month: '2026-04',
      client: 'asha',
    })
    expect(rows.map(r => r.policyNumber)).toEqual(['S1'])
  })

  it('recalculates the percentage when the rupee amount is typed', () => {
    expect(draftFromAmount(10000, '1250')).toMatchObject({ pct: '12.5', error: '' })
    expect(draftFromAmount(10000, '-1').error).toMatch(/negative/)
  })
})
