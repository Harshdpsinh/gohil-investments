import { describe, it, expect } from 'vitest'
import {
  matchRow,
  normaliseStatement,
  postedAmounts,
  commissionRateField,
  pickCurrentTerm,
} from './commissionImport'

describe('postedAmounts', () => {
  it('keeps gross and net the same when there is no TDS', () => {
    expect(postedAmounts({ commissionAmount: 1500 })).toEqual({
      receivedCommission: 1500, netReceived: 1500, tds: 0,
    })
  })

  it('subtracts TDS from gross when the sheet has no net column', () => {
    expect(postedAmounts({ commissionAmount: 1000, tds: 50 })).toEqual({
      receivedCommission: 1000, netReceived: 950, tds: 50,
    })
  })

  it('uses the Net Payment column as bank-landed cash', () => {
    expect(postedAmounts({ commissionAmount: 3504, netPayable: 3433.92, tds: 0 })).toEqual({
      receivedCommission: 3504, netReceived: 3433.92, tds: 0,
    })
  })

  it('reads Niva Bupa Net Payment separately from Commission Structure', () => {
    const [row] = normaliseStatement([{
      'Policy Number': '32482287202604',
      'Customer Name': 'VIKRAMSINH RANA',
      'Commission Structure': 3504,
      'Payout %': 12.71,
      'Net Payment': 3433.92,
    }])
    expect(row.commissionAmount).toBe(3504)
    expect(row.netPayable).toBe(3433.92)
    expect(postedAmounts(row).netReceived).toBe(3433.92)
  })
})

describe('commissionRateField', () => {
  it('writes first-year statements onto fyCommission', () => {
    expect(commissionRateField({ policyYear: 1 }, 'Fresh')).toBe('fyCommission')
    expect(commissionRateField({ policyYear: 1 }, '')).toBe('fyCommission')
  })

  it('writes renewal statements onto ryCommission, not fyCommission', () => {
    expect(commissionRateField({ policyYear: 2 }, '')).toBe('ryCommission')
    expect(commissionRateField({ policyYear: 1 }, 'Renewal')).toBe('ryCommission')
  })
})

describe('pickCurrentTerm', () => {
  it('prefers the live policy when a renewed-out twin shares the number', () => {
    const live = { id: 'new', status: 'Active', policyYear: 2 }
    const old = { id: 'old', status: 'Renewed-Out', is_renewed: true, policyYear: 1 }
    expect(pickCurrentTerm([old, live]).id).toBe('new')
  })

  it('refuses to guess when two live policies share the number', () => {
    expect(pickCurrentTerm([
      { id: 'a', status: 'Active' },
      { id: 'b', status: 'Active' },
    ])).toBeNull()
  })
})

describe('matchRow live-term preference', () => {
  const row = {
    policyNumber: 'POL-001', clientName: 'Meera Patel', insurer: 'HDFC ERGO',
    premium: 12000, commissionAmount: 1500,
  }

  it('posts against the active renewal when the original term shares the number', () => {
    const book = [
      { id: 'old', policyNumber: 'POL-001', clientName: 'Meera Patel', insurer: 'HDFC ERGO', status: 'Renewed-Out', is_renewed: true, policyYear: 1 },
      { id: 'live', policyNumber: 'POL-001', clientName: 'Meera Patel', insurer: 'HDFC ERGO', status: 'Active', policyYear: 2 },
    ]
    const matched = matchRow(row, book)
    expect(matched.status).toBe('matched')
    expect(matched.policy.id).toBe('live')
    expect(matched.reason).toMatch(/live policy/)
  })

  it('still asks a human when two live policies share the number', () => {
    const book = [
      { id: 'a', policyNumber: 'POL-001', clientName: 'Meera Patel', insurer: 'HDFC ERGO', status: 'Active' },
      { id: 'b', policyNumber: 'POL-001', clientName: 'X', insurer: 'Y', status: 'Active' },
    ]
    const matched = matchRow(row, book)
    expect(matched.status).toBe('review')
    expect(matched.policy).toBeNull()
    expect(matched.reason).toMatch(/share this number/)
  })
})
