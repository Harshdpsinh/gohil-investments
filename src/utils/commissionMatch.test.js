import { describe, expect, it } from 'vitest'
import {
  alreadyPostedHashes, commissionDiscrepancy, fnv1a, importBucket, matchScore, rowHash,
} from './commissionMatch'

describe('commissionMatch', () => {
  it('scores exact matches at 100 and unmatched at 0', () => {
    expect(matchScore({ status: 'matched', reason: 'Policy number, name and insurer agree' })).toBe(100)
    expect(matchScore({ status: 'unmatched' })).toBe(0)
    expect(matchScore({ status: 'review', reason: 'name differs' })).toBe(55)
  })

  it('hashes the same logical row the same way twice', () => {
    const row = { policyNumber: 'P-1', payoutMonth: '2026-07', commissionAmount: 95, sourceRow: 4, premium: 748 }
    expect(rowHash(row)).toBe(rowHash({ ...row }))
    expect(rowHash({ ...row, commissionAmount: 96 })).not.toBe(rowHash(row))
    expect(fnv1a('a')).toBe(fnv1a('a'))
  })

  it('flags a short payment against the policy rate', () => {
    const policy = { premium: 10000, fyCommission: 10, policyYear: 1 }
    const disc = commissionDiscrepancy({ commissionAmount: 500, premium: 10000 }, policy)
    expect(disc.expected).toBe(1000)
    expect(disc.received).toBe(500)
    expect(disc.hasDiscrepancy).toBe(true)
    expect(disc.tone).toBe('short')
  })

  it('puts exact no-conflict rows in ready and conflicts in review', () => {
    const policy = { premium: 1000, fyCommission: 10, policyYear: 1 }
    const ready = { status: 'matched', matchScore: 100, policy, commissionAmount: 100, premium: 1000 }
    const review = { status: 'matched', matchScore: 100, policy, commissionAmount: 40, premium: 1000 }
    expect(importBucket(ready, policy)).toBe('ready')
    expect(importBucket(review, policy)).toBe('review')
    expect(importBucket({ status: 'unmatched' })).toBe('unmatched')
  })

  it('indexes hashes already on the ledger', () => {
    const { files, rows, dates, rowDates } = alreadyPostedHashes([
      { sourceFileHash: 'abc', rowHash: 'rh_1', payoutMonth: '2026-07' },
    ])
    expect(files.has('abc')).toBe(true)
    expect(rows.has('rh_1')).toBe(true)
    expect(dates.abc).toBe('2026-07')
    expect(rowDates.rh_1).toBe('2026-07')
  })
})
