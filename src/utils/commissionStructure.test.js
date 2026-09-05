import { describe, it, expect } from 'vitest'
import {
  canUpdateStructure,
  masterStructureId,
  policyStructureStamp,
  policyYearKey,
  premiumBand,
  proposeMasterUpsert,
  STRUCTURE_HISTORY_COLS,
  withStructureExportFields,
} from './commissionStructure'

const policy = {
  id: 'p1',
  policyNumber: 'LIC-1',
  clientName: 'Ramesh',
  insurer: 'LIC of India',
  planName: 'Tech Term',
  policyType: 'Life',
  premium: 12000,
  fyCommission: 35,
  ryCommission: 5,
  policyYear: 1,
}

describe('commissionStructure helpers', () => {
  it('builds a stable master id that isolates FY from RY', () => {
    const fy = masterStructureId({
      insurer: 'LIC of India', product: 'Tech Term', insuranceType: 'Life',
      policyYear: 'FY', businessType: 'Fresh', premiumMin: 10000, premiumMax: 24999,
    })
    const ry = masterStructureId({
      insurer: 'LIC of India', product: 'Tech Term', insuranceType: 'Life',
      policyYear: 'RY', businessType: 'Renewal', premiumMin: 10000, premiumMax: 24999,
    })
    expect(fy).toContain('fy')
    expect(ry).toContain('ry')
    expect(fy).not.toBe(ry)
  })

  it('maps Fresh → FY and Renewal → RY without clobbering', () => {
    expect(policyYearKey(policy, 'Fresh')).toBe('FY')
    expect(policyYearKey({ ...policy, policyYear: 2 }, 'Renewal')).toBe('RY')
    expect(policyYearKey({ ...policy, policyYear: 2 }, '')).toBe('RY')
  })

  it('blocks unmatched / unbound rows from structure updates', () => {
    expect(canUpdateStructure({ status: 'unmatched', commissionPct: 12 }, policy)).toBe(false)
    expect(canUpdateStructure({ status: 'matched', commissionPct: 12 }, null)).toBe(false)
    expect(canUpdateStructure({ status: 'matched', commissionPct: 12 }, policy)).toBe(true)
    expect(canUpdateStructure({ status: 'review', commissionPct: 0 }, policy)).toBe(false)
  })

  it('proposeMasterUpsert returns null when guards fail', () => {
    expect(proposeMasterUpsert({ status: 'unmatched', commissionPct: 10 }, policy)).toBeNull()
    expect(proposeMasterUpsert({ status: 'matched', commissionPct: 10 }, null)).toBeNull()
  })

  it('proposeMasterUpsert builds an FY master payload with audit stamps', () => {
    const row = {
      status: 'matched',
      insurer: 'LIC of India',
      planName: 'Tech Term',
      businessType: 'Fresh',
      premium: 12000,
      commissionPct: 32,
      rewardPct: 1.5,
    }
    const proposal = proposeMasterUpsert(row, policy, {
      sourceFileName: 'lic-july.xlsx',
      user: { uid: 'u1', email: 'admin@example.com' },
    })
    expect(proposal).toBeTruthy()
    expect(proposal.payload.policyYear).toBe('FY')
    expect(proposal.payload.commissionPct).toBe(32)
    expect(proposal.payload.rewardPct).toBe(1.5)
    expect(proposal.payload.active).toBe(true)
    expect(proposal.payload.structureUpdated).toBe(true)
    expect(proposal.previousPct).toBe(35)
    expect(proposal.newPct).toBe(32)
    expect(proposal.payload.updatedByEmail).toBe('admin@example.com')
    expect(proposal.payload.sourceFileName).toBe('lic-july.xlsx')
    expect(proposal.payload.beforeSnapshot.commissionPct).toBe(35)
    expect(proposal.payload.afterSnapshot.commissionPct).toBe(32)
    expect(proposal.rateField).toBe('fyCommission')
    expect(proposal.id).toBe(masterStructureId({
      insurer: proposal.payload.insurer,
      product: proposal.payload.product,
      insuranceType: proposal.payload.insuranceType,
      policyYear: 'FY',
      businessType: 'Fresh',
      premiumMin: premiumBand(12000).premiumMin,
      premiumMax: premiumBand(12000).premiumMax,
    }))
  })

  it('proposeMasterUpsert writes RY keys for renewals so FY is untouched', () => {
    const renewalPolicy = { ...policy, policyYear: 3, fyCommission: 35, ryCommission: 7 }
    const proposal = proposeMasterUpsert({
      status: 'review',
      businessType: 'Renewal',
      commissionPct: 6.5,
      premium: 12000,
      insurer: 'LIC of India',
      planName: 'Tech Term',
    }, renewalPolicy, { sourceFileName: 'renewal.csv', user: { email: 'a@b.c' } })
    expect(proposal.payload.policyYear).toBe('RY')
    expect(proposal.rateField).toBe('ryCommission')
    expect(proposal.previousPct).toBe(7)
    expect(proposal.newPct).toBe(6.5)
    expect(proposal.id).toContain('ry')
    expect(proposal.id).not.toContain('__fy__')
  })

  it('uses existing master previousPct when provided (legacy-compatible)', () => {
    const proposal = proposeMasterUpsert({
      status: 'matched', commissionPct: 20, premium: 5000, insurer: 'Star Health',
    }, { ...policy, insurer: 'Star Health', fyCommission: 12 }, {
      existingMaster: { commissionPct: 15, rewardPct: 0, active: true, policyYear: 'FY' },
    })
    expect(proposal.previousPct).toBe(15)
    expect(proposal.payload.beforeSnapshot.commissionPct).toBe(15)
  })

  it('policyStructureStamp is additive and sets the correct rate field', () => {
    const proposal = proposeMasterUpsert({
      status: 'matched', businessType: 'Fresh', commissionPct: 30, premium: 12000,
    }, policy, { sourceFileName: 'x.csv', user: { email: 'a@b.c' } })
    const stamp = policyStructureStamp(proposal, { sourceFileName: 'x.csv' })
    expect(stamp.fyCommission).toBe(30)
    expect(stamp.structureUpdated).toBe(true)
    expect(stamp.previousPct).toBe(35)
    expect(stamp.newPct).toBe(30)
    expect(stamp.sourceFileName).toBe('x.csv')
    expect(stamp.ryCommission).toBeUndefined()
  })

  it('STRUCTURE_HISTORY_COLS expose the audit fields for exports', () => {
    const headers = STRUCTURE_HISTORY_COLS.map(c => c.header)
    expect(headers).toEqual([
      'Structure Updated', 'Previous %', 'New %', 'Structure Updated At', 'Updated By', 'Source File',
    ])
    const row = withStructureExportFields({
      structureUpdated: true,
      previousPct: 10,
      newPct: 12,
      structureUpdatedAt: '2026-09-05T10:00:00.000Z',
      updatedByEmail: 'admin@example.com',
      sourceFileName: 'star.csv',
    })
    expect(STRUCTURE_HISTORY_COLS[0].accessor(row)).toBe('Yes')
    expect(STRUCTURE_HISTORY_COLS[1].accessor(row)).toBe(10)
    expect(STRUCTURE_HISTORY_COLS[2].accessor(row)).toBe(12)
    expect(STRUCTURE_HISTORY_COLS[4].accessor(row)).toBe('admin@example.com')
    expect(STRUCTURE_HISTORY_COLS[5].accessor(row)).toBe('star.csv')
  })

  it('legacy rows without stamps still export blank structure columns', () => {
    const row = withStructureExportFields({ policyNumber: 'X', fyCommission: 10 })
    expect(row.structureUpdated).toBe(false)
    expect(STRUCTURE_HISTORY_COLS.map(c => c.accessor(row))).toEqual(['', '', '', '', '', ''])
  })
})
