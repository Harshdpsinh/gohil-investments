import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isInstallmentFrequency, listInstallments } from './installments.js'

const TODAY = new Date(2026, 6, 27, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('isInstallmentFrequency', () => {
  it('treats monthly / quarterly / half-yearly as installments', () => {
    expect(isInstallmentFrequency('Monthly')).toBe(true)
    expect(isInstallmentFrequency('qtr')).toBe(true)
    expect(isInstallmentFrequency('Half Yearly')).toBe(true)
    expect(isInstallmentFrequency('Yearly')).toBe(false)
  })
})

describe('listInstallments', () => {
  it('keeps a monthly life premium due this month and skips yearly / cancelled', () => {
    const rows = listInstallments([
      { id: '1', frequency: 'Monthly', nextPremiumDue: '2026-08-05', policyType: 'Life', status: 'Active', policyNumber: 'M1' },
      { id: '2', frequency: 'Yearly', expiryDate: '2026-08-05', policyType: 'Health', status: 'Active' },
      { id: '3', frequency: 'Monthly', nextPremiumDue: '2026-08-05', status: 'Cancelled' },
    ])
    expect(rows.map(r => r.policy.id)).toEqual(['1'])
    expect(rows[0].frequency).toBe('Monthly')
    expect(rows[0].status.id).toBe('month')
  })

  it('sorts overdue before upcoming', () => {
    const rows = listInstallments([
      { id: 'a', frequency: 'Monthly', nextPremiumDue: '2026-08-10', policyType: 'Life', status: 'Active' },
      { id: 'b', frequency: 'Monthly', nextPremiumDue: '2026-07-20', policyType: 'Life', status: 'Active' },
    ])
    expect(rows.map(r => r.policy.id)).toEqual(['b', 'a'])
  })
})
