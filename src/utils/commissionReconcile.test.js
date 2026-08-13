import { describe, it, expect } from 'vitest'
import {
  AGEING_BUCKETS,
  RECONCILE_STATUS,
  ageingBucket,
  ageingSummary,
  expectedCommission,
  insurerScorecard,
  netByPolicy,
  receivablesForecast,
  reconcilePolicies,
  reconcileSummary,
  tdsSummary,
  toleranceFor,
} from './commissionReconcile'

const ASOF = new Date('2026-08-10T00:00:00Z')

const policy = (over = {}) => ({
  id: 'p1', policyNumber: 'POL-1', clientName: 'Asha', insurer: 'Star Health',
  policyType: 'Health', premium: 10000, fyCommission: 15, ryCommission: 10,
  policyYear: 1, status: 'Active', startDate: '2026-05-01', expiryDate: '2027-04-30',
  ...over,
})

const txn = (over = {}) => ({
  policyId: 'p1', netReceived: 1500, payoutMonth: '2026-06', payoutDate: '2026-06-15',
  insurer: 'Star Health', tds: 0, ...over,
})

describe('expectedCommission', () => {
  it('uses the FY rate in year one', () => {
    expect(expectedCommission(policy())).toBe(1500)
  })

  // The whole point of storing two rates — a renewal must not be valued at the
  // first-year rate or every renewal looks short-paid.
  it('uses the RY rate from year two onward', () => {
    expect(expectedCommission(policy({ policyYear: 2 }))).toBe(1000)
    expect(expectedCommission(policy({ policyYear: 7 }))).toBe(1000)
  })

  it.each([
    ['no rate on file', { fyCommission: 0 }],
    ['no premium', { premium: 0 }],
    ['junk values', { premium: 'abc', fyCommission: null }],
  ])('returns 0 for %s', (_label, over) => {
    expect(expectedCommission(policy(over))).toBe(0)
  })
})

describe('toleranceFor', () => {
  it('allows one percent for rounding and GST-net premiums', () => {
    expect(toleranceFor(10000)).toBe(100)
  })

  it('never drops below a rupee, so small policies still reconcile', () => {
    expect(toleranceFor(10)).toBe(1)
    expect(toleranceFor(0)).toBe(1)
  })
})

describe('netByPolicy', () => {
  // A clawback must cancel the payout it reverses, not be counted as income.
  it('nets a reversal against the original payout', () => {
    const map = netByPolicy([txn(), txn({ netReceived: -1500, payoutMonth: '2026-07' })])
    expect(map.get('p1').received).toBe(0)
    expect(map.get('p1').credits).toBe(1500)
    expect(map.get('p1').reversals ?? map.get('p1').debits).toBe(-1500)
    expect(map.get('p1').count).toBe(2)
  })

  it('falls back to receivedCommission when netReceived is absent', () => {
    expect(netByPolicy([{ policyId: 'p1', receivedCommission: 900 }]).get('p1').received).toBe(900)
  })

  it('ignores rows with no policy link', () => {
    expect(netByPolicy([{ netReceived: 500 }]).size).toBe(0)
  })
})

describe('reconcilePolicies', () => {
  const run = (policies, transactions) => reconcilePolicies(policies, transactions, { asOf: ASOF })

  it('marks a fully settled policy as received', () => {
    const [row] = run([policy()], [txn()])
    expect(row.status).toBe(RECONCILE_STATUS.RECEIVED)
    expect(row.difference).toBe(0)
    expect(row.ageingDays).toBe(0)
  })

  it('settles within tolerance rather than flagging rounding', () => {
    // ₹10 on ₹1500 is rounding. ₹20 is 1.3% and is a real shortfall — the
    // threshold has to sit between the two or every statement looks wrong.
    expect(run([policy()], [txn({ netReceived: 1490 })])[0].status).toBe(RECONCILE_STATUS.RECEIVED)
    expect(run([policy()], [txn({ netReceived: 1480 })])[0].status).toBe(RECONCILE_STATUS.SHORT)
  })

  it('flags a short payment beyond tolerance', () => {
    const [row] = run([policy()], [txn({ netReceived: 900 })])
    expect(row.status).toBe(RECONCILE_STATUS.SHORT)
    expect(row.difference).toBe(-600)
  })

  it('flags an overpayment, which may be clawed back later', () => {
    const [row] = run([policy()], [txn({ netReceived: 2500 })])
    expect(row.status).toBe(RECONCILE_STATUS.OVER)
  })

  // The blind spot this module exists to remove.
  it('flags a policy in force with nothing received as chaseable', () => {
    const [row] = run([policy()], [])
    expect(row.status).toBe(RECONCILE_STATUS.AWAITED)
    expect(row.chaseable).toBe(true)
    expect(row.ageingDays).toBe(101) // 1 May -> 10 Aug
  })

  it('does not chase a policy whose cover has not started', () => {
    const [row] = run([policy({ startDate: '2026-12-01' })], [])
    expect(row.status).toBe(RECONCILE_STATUS.NOT_DUE)
    expect(row.chaseable).toBe(false)
  })

  // Missing rate is a data-entry gap, not an insurer failing to pay. Reporting
  // it as a shortfall would bury the real shortfalls.
  it('separates a missing commission rate from an unpaid commission', () => {
    const [row] = run([policy({ fyCommission: 0 })], [])
    expect(row.status).toBe(RECONCILE_STATUS.NO_RATE)
    expect(row.chaseable).toBe(false)
  })

  it('does not chase a cancelled policy', () => {
    expect(run([policy({ status: 'Cancelled' })], [])[0].chaseable).toBe(false)
  })

  // A renewed-out policy still earned commission on the term it actually ran.
  it('still chases a policy that was renewed away', () => {
    expect(run([policy({ status: 'Renewed-Out', is_renewed: true })], [])[0].chaseable).toBe(true)
  })

  it('reports whether the client premium was actually collected', () => {
    expect(run([policy()], [])[0].premiumCollected).toBe(false)
    expect(run([policy({ lastPremiumPaidAt: { seconds: 1 } })], [])[0].premiumCollected).toBe(true)
  })

  it('measures days from cover start to first payout', () => {
    const [row] = run([policy()], [txn()])
    expect(row.daysToPay).toBe(45) // 1 May -> 15 Jun
  })

  it('carries TDS and reversals through to the row', () => {
    const [row] = run([policy()], [txn({ tds: 75 }), txn({ netReceived: -200, payoutMonth: '2026-07' })])
    expect(row.tds).toBe(75)
    expect(row.reversals).toBe(-200)
    expect(row.received).toBe(1300)
  })
})

describe('ageingBucket', () => {
  it.each([[0, '0-30'], [30, '0-30'], [31, '31-60'], [60, '31-60'], [61, '61-90'], [90, '61-90'], [91, '90+'], [400, '90+']])(
    '%i days falls in %s', (days, bucket) => expect(ageingBucket(days)).toBe(bucket)
  )
})

describe('ageingSummary', () => {
  it('buckets only what is actually chaseable', () => {
    const rows = reconcilePolicies(
      [
        policy({ id: 'a', startDate: '2026-08-01' }),               // 9 days
        policy({ id: 'b', startDate: '2026-01-01', policyYear: 2 }), // 221 days
        policy({ id: 'c' }),                                         // settled below
      ],
      [txn({ policyId: 'c' })],
      { asOf: ASOF }
    )
    const summary = ageingSummary(rows)
    expect(Object.keys(summary)).toEqual(AGEING_BUCKETS)
    expect(summary['0-30'].count).toBe(1)
    expect(summary['90+'].count).toBe(1)
    expect(summary['90+'].amount).toBe(1000)
    expect(summary['31-60'].count).toBe(0)
  })
})

describe('reconcileSummary', () => {
  it('counts outstanding as unpaid plus the shortfall on short-paid rows', () => {
    const rows = reconcilePolicies(
      [policy({ id: 'a' }), policy({ id: 'b' })],
      [txn({ policyId: 'b', netReceived: 900 })],
      { asOf: ASOF }
    )
    const summary = reconcileSummary(rows)
    expect(summary.counts.awaited).toBe(1)
    expect(summary.counts.short).toBe(1)
    expect(summary.expected).toBe(3000)
    expect(summary.received).toBe(900)
    expect(summary.outstanding).toBe(2100) // 1500 unpaid + 600 short
  })
})

describe('insurerScorecard', () => {
  it('ranks insurers by exposure and reports how fast each pays', () => {
    const rows = reconcilePolicies(
      [
        policy({ id: 'a', insurer: 'Star Health' }),
        policy({ id: 'b', insurer: 'Star Health' }),
        policy({ id: 'c', insurer: 'HDFC ERGO', premium: 40000 }),
      ],
      [txn({ policyId: 'a' }), txn({ policyId: 'c', netReceived: 6000, payoutDate: '2026-05-31' })],
      { asOf: ASOF }
    )
    const [top, second] = insurerScorecard(rows)
    // Canonical spellings: the scorecard merges variants so one carrier is not
    // reported as two each paying half of what it owes.
    expect(top.insurer).toBe('HDFC ERGO General Insurance')
    expect(top.settledPct).toBe(100)
    expect(top.avgDaysToPay).toBe(30)
    expect(second.insurer).toBe('Star Health and Allied Insurance')
    expect(second.unpaid).toBe(1)
    expect(second.outstanding).toBe(1500)
  })

  it('merges a carrier entered under two spellings into one line', () => {
    const rows = reconcilePolicies(
      [policy({ id: 'a', insurer: 'HDFC ERGO' }), policy({ id: 'b', insurer: 'HDFC ERGO General Insurance' })],
      [],
      { asOf: ASOF }
    )
    const card = insurerScorecard(rows)
    expect(card).toHaveLength(1)
    expect(card[0]).toMatchObject({ insurer: 'HDFC ERGO General Insurance', policies: 2, unpaid: 2 })
  })

  it('reports never-paid as null rather than zero days', () => {
    const rows = reconcilePolicies([policy()], [], { asOf: ASOF })
    expect(insurerScorecard(rows)[0].avgDaysToPay).toBeNull()
  })
})

describe('receivablesForecast', () => {
  it('prices upcoming renewals at the renewal rate, not the first-year rate', () => {
    const forecast = receivablesForecast(
      [policy({ expiryDate: '2026-09-15', startDate: '2025-09-16' })],
      { asOf: ASOF, days: 90 }
    )
    expect(forecast.count).toBe(1)
    expect(forecast.total).toBe(1000) // RY 10%, not FY 15%
    expect(forecast.byMonth['2026-09']).toBe(1000)
  })

  it('ignores policies already renewed away and those beyond the horizon', () => {
    const forecast = receivablesForecast(
      [
        policy({ id: 'a', expiryDate: '2026-09-15', is_renewed: true }),
        policy({ id: 'b', expiryDate: '2027-06-01' }),
      ],
      { asOf: ASOF, days: 90 }
    )
    expect(forecast.count).toBe(0)
    expect(forecast.total).toBe(0)
  })
})

describe('tdsSummary', () => {
  const rows = [
    txn({ insurer: 'Star Health', netReceived: 1425, tds: 75, payoutMonth: '2026-06' }),
    txn({ insurer: 'HDFC ERGO', netReceived: 950, tds: 50, payoutMonth: '2026-07' }),
    txn({ insurer: 'Star Health', netReceived: 1900, tds: 100, payoutMonth: '2025-12' }),
  ]

  it('grosses the payout back up by the tax deducted', () => {
    const summary = tdsSummary(rows)
    expect(summary.total).toBe(225)
    expect(summary.gross).toBe(4500)
    expect(summary.byInsurer[0].insurer).toBe('Star Health')
    expect(summary.byInsurer[0].tds).toBe(175)
  })

  // The financial year is April-March, so a calendar-year window would pull in
  // the wrong quarter and never match Form 26AS.
  it('honours a financial-year window', () => {
    const summary = tdsSummary(rows, { from: '2026-04', to: '2027-03' })
    expect(summary.total).toBe(125)
    expect(summary.byInsurer).toHaveLength(2)
  })
})
