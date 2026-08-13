import { describe, it, expect } from 'vitest'
import {
  GROUP_KEYS,
  PERIOD_PRESETS,
  financialYearOf,
  financialYearRange,
  groupBusiness,
  isRenewalPolicy,
  periodRange,
  policiesInPeriod,
  priorYearRange,
  renewalRatio,
  summariseBusiness,
  yearOnYear,
} from './businessDone'

const ASOF = new Date(2026, 7, 10) // 10 Aug 2026, local

const policy = (over = {}) => ({
  id: 'p1', clientName: 'Asha', insurer: 'Star Health', policyType: 'Health',
  premium: 10000, policyYear: 1, status: 'Active',
  startDate: '2026-05-01', expiryDate: '2027-04-30', ...over,
})

describe('financialYearOf', () => {
  // April-March. A calendar-year split would put Q4 business in the wrong year
  // and never match an insurer's target sheet.
  it.each([
    ['2026-04-01', 2026],
    ['2026-12-31', 2026],
    ['2027-03-31', 2026],
    ['2027-04-01', 2027],
    ['2026-03-31', 2025],
  ])('%s belongs to FY %i', (date, fy) => expect(financialYearOf(date)).toBe(fy))

  it('returns null for an unparseable date', () => {
    expect(financialYearOf('not a date')).toBeNull()
  })
})

describe('financialYearRange', () => {
  it('spans April to March and labels it the Indian way', () => {
    expect(financialYearRange(2026)).toEqual({ from: '2026-04-01', to: '2027-03-31', label: 'FY 2026-27' })
  })
})

describe('periodRange', () => {
  it('bounds this month inclusively, including a 31st', () => {
    expect(periodRange('This month', ASOF)).toMatchObject({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('rolls back across a month boundary', () => {
    expect(periodRange('Last month', ASOF)).toMatchObject({ from: '2026-07-01', to: '2026-07-31' })
  })

  it('bounds the calendar quarter', () => {
    expect(periodRange('This quarter', ASOF)).toMatchObject({ from: '2026-07-01', to: '2026-09-30' })
  })

  it.each([
    ['This FY', '2026-04-01', '2027-03-31'],
    ['Last FY', '2025-04-01', '2026-03-31'],
  ])('%s runs %s to %s', (preset, from, to) => {
    expect(periodRange(preset, ASOF)).toMatchObject({ from, to })
  })

  it('every preset resolves to a usable range', () => {
    PERIOD_PRESETS.forEach(preset => {
      const range = periodRange(preset, ASOF)
      expect(range.from <= range.to).toBe(true)
      expect(range.label).toBeTruthy()
    })
  })
})

describe('priorYearRange', () => {
  it('shifts the window back exactly one year', () => {
    expect(priorYearRange(periodRange('This FY', ASOF))).toMatchObject({ from: '2025-04-01', to: '2026-03-31' })
  })
})

describe('isRenewalPolicy', () => {
  // renewPolicy writes both of these, so no insurer statement is needed to
  // classify business — which is what makes this report accurate immediately.
  it.each([
    ['parentPolicyId', { parentPolicyId: 'old' }],
    ['renewedFromPolicyId', { renewedFromPolicyId: 'old' }],
    ['policyYear above one', { policyYear: 2 }],
  ])('treats %s as a renewal', (_label, over) => {
    expect(isRenewalPolicy(policy(over))).toBe(true)
  })

  it('treats a first-year policy with no parent as fresh', () => {
    expect(isRenewalPolicy(policy())).toBe(false)
  })
})

describe('policiesInPeriod', () => {
  const range = periodRange('This FY', ASOF)

  it('includes both boundary dates', () => {
    const rows = policiesInPeriod(
      [policy({ id: 'a', startDate: '2026-04-01' }), policy({ id: 'b', startDate: '2027-03-31' })],
      range
    )
    expect(rows).toHaveLength(2)
  })

  it('excludes dates outside the window and soft-deleted rows', () => {
    const rows = policiesInPeriod(
      [
        policy({ id: 'a', startDate: '2026-03-31' }),
        policy({ id: 'b', startDate: '2027-04-01' }),
        policy({ id: 'c', deleted: true }),
      ],
      range
    )
    expect(rows).toHaveLength(0)
  })
})

describe('summariseBusiness', () => {
  const range = periodRange('This FY', ASOF)

  it('splits fresh from renewal and totals each side', () => {
    const summary = summariseBusiness(
      [
        policy({ id: 'a' }),
        policy({ id: 'b', premium: 5000 }),
        policy({ id: 'c', premium: 20000, parentPolicyId: 'old', policyYear: 2 }),
      ],
      range
    )
    expect(summary).toMatchObject({
      total: 3, totalPremium: 35000,
      freshCount: 2, freshPremium: 15000,
      renewalCount: 1, renewalPremium: 20000,
    })
  })

  // Booked and collected are different facts; the page shows both.
  it('counts how many have premium actually collected', () => {
    const summary = summariseBusiness(
      [policy({ id: 'a', lastPremiumPaidAt: { seconds: 1 } }), policy({ id: 'b' })],
      range
    )
    expect(summary.collectedCount).toBe(1)
  })
})

describe('groupBusiness', () => {
  const range = periodRange('This FY', ASOF)
  const book = [
    policy({ id: 'a', insurer: 'Star Health', policyType: 'Health', premium: 10000 }),
    policy({ id: 'b', insurer: 'Star Health', policyType: 'Health', premium: 5000, parentPolicyId: 'x', policyYear: 2 }),
    policy({ id: 'c', insurer: 'HDFC ERGO', policyType: 'Motor', premium: 25000 }),
  ]

  it('groups by company with a fresh/renewal split and a share', () => {
    const rows = groupBusiness(book, range, GROUP_KEYS.company)
    expect(rows[0]).toMatchObject({ key: 'HDFC ERGO General Insurance', freshCount: 1, renewalCount: 0, premium: 25000, sharePct: 62.5 })
    expect(rows[1]).toMatchObject({ key: 'Star Health and Allied Insurance', freshCount: 1, renewalCount: 1, premium: 15000, sharePct: 37.5 })
  })

  // The reason company grouping canonicalises: one carrier entered three ways
  // used to appear as three companies each holding a third of the business.
  it('counts one company however many ways it was spelled', () => {
    const rows = groupBusiness(
      [
        policy({ id: 'x', insurer: 'HDFC ERGO', premium: 1000 }),
        policy({ id: 'y', insurer: 'HDFC ERGO General Insurance', premium: 1000 }),
        policy({ id: 'z', insurer: 'hdfc ergo motor', premium: 1000 }),
      ],
      range,
      GROUP_KEYS.company
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'HDFC ERGO General Insurance', count: 3, premium: 3000, sharePct: 100 })
  })

  it('groups by category', () => {
    expect(groupBusiness(book, range, GROUP_KEYS.category).map(r => r.key)).toEqual(['Motor', 'Health'])
  })

  it('groups by start month', () => {
    expect(groupBusiness(book, range, GROUP_KEYS.month)[0].key).toBe('2026-05')
  })

  it('labels a missing key rather than dropping the row', () => {
    // Each GROUP_KEYS picker carries its own label for a blank field...
    expect(groupBusiness([policy({ insurer: '' })], range, GROUP_KEYS.company)[0].key).toBe('Unknown')
    // ...and groupBusiness backstops any picker that returns nothing at all.
    expect(groupBusiness([policy()], range, () => '')[0].key).toBe('Unspecified')
  })

  it('returns an empty list rather than dividing by zero', () => {
    expect(groupBusiness([], range, GROUP_KEYS.company)).toEqual([])
  })
})

describe('renewalRatio', () => {
  const range = periodRange('This FY', ASOF)

  it('measures how many of the period due dates actually renewed', () => {
    const result = renewalRatio(
      [
        policy({ id: 'a', expiryDate: '2026-06-30', is_renewed: true, status: 'Renewed-Out' }),
        policy({ id: 'b', expiryDate: '2026-07-31', is_renewed: true, status: 'Renewed-Out' }),
        policy({ id: 'c', expiryDate: '2026-09-30' }),
        policy({ id: 'd', expiryDate: '2026-10-31', status: 'Cancelled' }),
      ],
      range
    )
    expect(result).toMatchObject({ due: 4, renewed: 2, lost: 1, pending: 1, ratio: 50 })
  })

  it('ignores due dates outside the window', () => {
    expect(renewalRatio([policy({ expiryDate: '2028-01-01' })], range).due).toBe(0)
  })

  it('reports zero rather than NaN when nothing fell due', () => {
    expect(renewalRatio([], range).ratio).toBe(0)
  })
})

describe('yearOnYear', () => {
  it('compares the window against the same window last year', () => {
    const result = yearOnYear(
      [
        policy({ id: 'a', startDate: '2026-05-01', premium: 20000 }),
        policy({ id: 'b', startDate: '2025-05-01', premium: 10000 }),
      ],
      periodRange('This FY', ASOF)
    )
    expect(result.current.total).toBe(1)
    expect(result.prior.total).toBe(1)
    expect(result.growth.totalPremium).toBe(100)
  })

  // Growth against nothing is undefined, not "infinite" and not 0%.
  it('reports null growth when the prior period was empty', () => {
    const result = yearOnYear([policy({ startDate: '2026-05-01' })], periodRange('This FY', ASOF))
    expect(result.growth.totalPremium).toBeNull()
  })
})
