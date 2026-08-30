import { describe, it, expect } from 'vitest'
import { familyMembersOf, familyCoverTotals, familyPremiumCalendar } from './family360.js'

const clients = [
  { id: 'a', name: 'Head', familyId: 'f1', familyName: 'Patel' },
  { id: 'b', name: 'Spouse', familyId: 'f1', familyName: 'Patel' },
  { id: 'c', name: 'Other Patel', familyName: 'Patel' },
]

describe('familyMembersOf', () => {
  it('groups by familyId and ignores same-name households without that id', () => {
    const members = familyMembersOf(clients[0], clients)
    expect(members.map(row => row.id).sort()).toEqual(['a', 'b'])
  })
})

describe('familyCoverTotals', () => {
  it('splits health and life cover from active policies only', () => {
    const totals = familyCoverTotals([
      { policyType: 'Health', status: 'Active', sumInsured: 2500000, premium: 20000 },
      { policyType: 'Life', status: 'Active', sumAssured: 15000000, premium: 18000 },
      { policyType: 'Health', status: 'Cancelled', sumInsured: 999999 },
    ])
    expect(totals.healthCover).toBe(2500000)
    expect(totals.lifeCover).toBe(15000000)
    expect(totals.premium).toBe(38000)
  })
})

describe('familyPremiumCalendar', () => {
  it('orders upcoming dues', () => {
    const rows = familyPremiumCalendar([
      { clientId: 'b', policyType: 'Health', premium: 1, startDate: '2026-01-01', expiryDate: '2026-12-01', status: 'Active' },
      { clientId: 'a', policyType: 'Life', premium: 1, startDate: '2026-01-01', expiryDate: '2026-06-01', status: 'Active' },
    ], clients)
    expect(rows[0].ownerName).toBe('Head')
  })
})
