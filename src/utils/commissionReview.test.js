import { describe, expect, it } from 'vitest'
import { RECONCILE_STATUS } from './commissionReconcile'
import { commissionReviewPrompt, draftFromReview, latestCommissionPosting } from './commissionReview'

describe('latestCommissionPosting', () => {
  it('returns null when this policy has no posted row', () => {
    expect(latestCommissionPosting([{ policyId: 'other', id: 't1' }], 'p1')).toBeNull()
    expect(latestCommissionPosting([], 'p1')).toBeNull()
  })

  it('picks the newest payout for that policy', () => {
    const rows = [
      { id: 'old', policyId: 'p1', payoutDate: '2026-06-01', netReceived: 100 },
      { id: 'new', policyId: 'p1', payoutDate: '2026-07-15', netReceived: 200 },
      { id: 'other', policyId: 'p2', payoutDate: '2026-08-01', netReceived: 900 },
    ]
    expect(latestCommissionPosting(rows, 'p1').id).toBe('new')
  })
})

describe('commissionReviewPrompt', () => {
  it('flags unpaid and short rows as needing an update', () => {
    expect(commissionReviewPrompt(RECONCILE_STATUS.AWAITED).needsUpdate).toBe(true)
    expect(commissionReviewPrompt(RECONCILE_STATUS.SHORT).needsUpdate).toBe(true)
    expect(commissionReviewPrompt(RECONCILE_STATUS.SHORT).title).toBe('This commission needs an update')
    expect(commissionReviewPrompt(RECONCILE_STATUS.RECEIVED).needsUpdate).toBe(false)
  })
})

describe('draftFromReview', () => {
  it('prefills the posted amount when a ledger row exists', () => {
    const draft = draftFromReview({
      row: { expected: 1500, received: 900, tds: 10 },
      existing: { netReceived: 880, tds: 12, payoutMonth: '2026-07', remarks: 'Star July' },
    })
    expect(draft.amount).toBe('880')
    expect(draft.tds).toBe('12')
    expect(draft.payoutMonth).toBe('2026-07')
    expect(draft.remarks).toBe('Star July')
  })

  it('prefills expected when nothing has been posted yet', () => {
    const draft = draftFromReview({
      row: { expected: 1500, received: 0, tds: 0 },
      now: new Date('2026-07-20T12:00:00Z'),
    })
    expect(draft.amount).toBe('1500')
    expect(draft.payoutMonth).toBe('2026-07')
  })
})
