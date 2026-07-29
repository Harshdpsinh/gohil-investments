import { describe, it, expect } from 'vitest'
import {
  toNumber, mapColumns, normaliseStatement, matchRow, matchStatement,
  postingKey, summarise,
} from './commissionImport'

const policies = [
  { id: 'p1', policyNumber: 'POL-001', clientName: 'Meera Patel', insurer: 'HDFC ERGO', premium: 12000 },
  { id: 'p2', policyNumber: 'POL-002', clientName: 'Rajendra J Shukla', insurer: 'Star Health', premium: 6200 },
  { id: 'p3', policyNumber: 'POL-003', clientName: 'Meera Patel', insurer: 'Star Health', premium: 4000 },
]

describe('toNumber', () => {
  it.each([
    ['1,234.50', 1234.5],
    ['12.5%', 12.5],
    ['₹1,234', 1234],
    [5000, 5000],
    ['', 0],
    [null, 0],
    ['abc', 0],
    [NaN, 0],
  ])('parses %s to %s', (input, expected) => {
    expect(toNumber(input)).toBe(expected)
  })
})

describe('mapColumns', () => {
  it('matches headers regardless of spacing, case and punctuation', () => {
    const cols = mapColumns({ 'Policy No.': '', 'Insured Name': '', 'COMMISSION %': '', 'Brokerage Amount': '' })
    expect(cols.policyNumber).toBe('Policy No.')
    expect(cols.clientName).toBe('Insured Name')
    expect(cols.commissionPct).toBe('COMMISSION %')
    expect(cols.commissionAmount).toBe('Brokerage Amount')
  })

  it('omits fields the sheet does not have', () => {
    expect(mapColumns({ 'Policy No': '' })).not.toHaveProperty('premium')
  })
})

describe('normaliseStatement', () => {
  it('returns an empty list for no rows', () => {
    expect(normaliseStatement()).toEqual([])
    expect(normaliseStatement([])).toEqual([])
  })

  it('normalises a realistic statement row', () => {
    const [row] = normaliseStatement([{
      'Policy No': ' POL-001 ', 'Insured Name': 'Meera Patel',
      'Company': 'HDFC ERGO', 'Premium': '12,000',
      'Commission %': '12.5%', 'Brokerage': '₹1,500',
    }])
    expect(row).toMatchObject({
      policyNumber: 'POL-001', clientName: 'Meera Patel', insurer: 'HDFC ERGO',
      premium: 12000, commissionPct: 12.5, commissionAmount: 1500,
    })
  })

  it('numbers rows from 2 so they line up with the spreadsheet', () => {
    const rows = normaliseStatement([{ 'Policy No': 'A' }, { 'Policy No': 'B' }])
    expect(rows.map(r => r.sourceRow)).toEqual([2, 3])
  })

  it('drops blank rows', () => {
    expect(normaliseStatement([{ 'Policy No': 'A' }, { 'Policy No': '' }])).toHaveLength(1)
  })
})

describe('matchRow', () => {
  const row = over => ({
    policyNumber: 'POL-001', clientName: 'Meera Patel', insurer: 'HDFC ERGO',
    premium: 12000, commissionPct: 12.5, commissionAmount: 1500, payoutDate: '2026-07-01',
    ...over,
  })

  it('matches when number, name and insurer all agree', () => {
    const r = matchRow(row(), policies)
    expect(r.status).toBe('matched')
    expect(r.policy.id).toBe('p1')
  })

  it('tolerates a small spelling slip in the name', () => {
    expect(matchRow(row({ clientName: 'Meera Patell' }), policies).status).toBe('matched')
  })

  it('tolerates an insurer written as a prefix', () => {
    expect(matchRow(row({ insurer: 'HDFC' }), policies).status).toBe('matched')
  })

  // The verification protocol: a policy number alone must never auto-post.
  it('sends a wrong name to review even with the right policy number', () => {
    const r = matchRow(row({ clientName: 'Someone Else' }), policies)
    expect(r.status).toBe('review')
    expect(r.reason).toMatch(/name differs/)
  })

  it('sends a wrong insurer to review even with the right policy number', () => {
    const r = matchRow(row({ insurer: 'Bajaj Allianz' }), policies)
    expect(r.status).toBe('review')
    expect(r.reason).toMatch(/insurer differs/)
  })

  it('never auto-matches on name alone', () => {
    const r = matchRow(row({ policyNumber: '' }), policies)
    expect(r.status).toBe('review')
    expect(r.policy.id).toBe('p1')
  })

  it('flags an ambiguous name rather than guessing', () => {
    const r = matchRow(row({ policyNumber: '', insurer: '' }), policies)
    expect(r.status).toBe('review')
    expect(r.policy).toBeNull()
    expect(r.reason).toMatch(/possible clients/)
  })

  it('reports unmatched when nothing lines up', () => {
    const r = matchRow(row({ policyNumber: 'NOPE', clientName: 'Nobody At All' }), policies)
    expect(r.status).toBe('unmatched')
    expect(r.policy).toBeNull()
  })

  it('flags duplicate policy numbers instead of picking one', () => {
    const dupes = [...policies, { id: 'p4', policyNumber: 'POL-001', clientName: 'X', insurer: 'Y' }]
    const r = matchRow(row(), dupes)
    expect(r.status).toBe('review')
    expect(r.reason).toMatch(/share this number/)
  })

  it('ignores formatting differences in the policy number', () => {
    expect(matchRow(row({ policyNumber: 'pol 001' }), policies).status).toBe('matched')
  })

  it('matches when the statement omits name and insurer', () => {
    expect(matchRow(row({ clientName: '', insurer: '' }), policies).status).toBe('matched')
  })
})

describe('matchStatement', () => {
  it('matches every row', () => {
    const rows = [
      { policyNumber: 'POL-001', clientName: 'Meera Patel', insurer: 'HDFC ERGO', commissionAmount: 100 },
      { policyNumber: 'ZZZ', clientName: 'Nobody', insurer: '', commissionAmount: 50 },
    ]
    expect(matchStatement(rows, policies).map(r => r.status)).toEqual(['matched', 'unmatched'])
  })
})

describe('postingKey', () => {
  it('is stable for the same row', () => {
    const row = { policyNumber: 'POL-001', payoutDate: '2026-07-01', commissionAmount: 1500 }
    expect(postingKey(row)).toBe(postingKey({ ...row }))
  })

  it('differs across payout months', () => {
    const a = { policyNumber: 'POL-001', payoutDate: '2026-07-01', commissionAmount: 1500 }
    expect(postingKey(a)).not.toBe(postingKey({ ...a, payoutDate: '2026-08-01' }))
  })

  it('produces a Firestore-safe id', () => {
    const k = postingKey({ policyNumber: 'POL/001 A', payoutDate: '2026-07-01', commissionAmount: 1500 })
    expect(k).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('copes with a missing payout date', () => {
    expect(postingKey({ policyNumber: 'P1', commissionAmount: 10 })).toContain('nodate')
  })
})

describe('summarise', () => {
  it('counts each status and totals the money', () => {
    expect(summarise([
      { status: 'matched', commissionAmount: 100 },
      { status: 'review', commissionAmount: 50 },
      { status: 'unmatched', commissionAmount: 25 },
      { status: 'matched', commissionAmount: 100 },
    ])).toEqual({ total: 4, matched: 2, review: 1, unmatched: 1, amount: 275 })
  })

  it('handles an empty list', () => {
    expect(summarise()).toEqual({ total: 0, matched: 0, review: 0, unmatched: 0, amount: 0 })
  })
})
