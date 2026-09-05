import { describe, it, expect } from 'vitest'
import {
  toNumber, mapColumns, normaliseStatement, matchRow, matchStatement,
  postingKey, legacyPostingKey, summarise, toPayoutMonth, normaliseBusinessType,
  isMaskedPolicyNumber, last4,
} from './commissionImport'

// Real header row from an HDFC ERGO payout export. This insurer omits the
// insurer column entirely and prefixes policy numbers with an apostrophe.
const HDFC_ROW = {
  Month: 202606,
  Parent_Name: 'UMABA HARSHDIPSINH GOHIL',
  Customer_Name: 'ANKUSH KUMAR JAIN',
  Policy_Num: "'2800000041617000",
  Certificate_Num: "'2800000041617000000",
  Business_Type: 'New',
  GWP: 23413,
  Premium_For_Commission: 23413,
  Commission_perct: 21.186440677966086,
  TOTAL_COMM: 4960.3813559322,
  COMMISSION_OD_AMT: 4960.3813559322,
}

describe('HDFC ERGO export format', () => {
  it('reads every field the ledger needs', () => {
    const [row] = normaliseStatement([HDFC_ROW])
    expect(row.policyNumber).toBe('2800000041617000') // leading apostrophe gone
    expect(row.clientName).toBe('ANKUSH KUMAR JAIN')
    expect(row.premium).toBe(23413)
    expect(row.commissionPct).toBeCloseTo(21.186, 2)
    expect(row.commissionAmount).toBeCloseTo(4960.38, 2)
    expect(row.payoutMonth).toBe('2026-06')
  })

  it('prefers TOTAL_COMM over COMMISSION_OD_AMT', () => {
    const [row] = normaliseStatement([{ ...HDFC_ROW, TOTAL_COMM: 111, COMMISSION_OD_AMT: 999 }])
    expect(row.commissionAmount).toBe(111)
  })

  it('does not mistake Parent_Name for the customer', () => {
    expect(normaliseStatement([HDFC_ROW])[0].clientName).not.toBe(HDFC_ROW.Parent_Name)
  })

  it('matches once the user names the insurer', () => {
    const policies = [{ id: 'p9', policyNumber: '2800000041617000', clientName: 'ANKUSH KUMAR JAIN', insurer: 'HDFC ERGO' }]
    const [m] = matchStatement(normaliseStatement([HDFC_ROW]), policies, 'HDFC ERGO')
    expect(m.status).toBe('matched')
  })

  it('rejects the statement when the declared insurer is wrong', () => {
    const policies = [{ id: 'p9', policyNumber: '2800000041617000', clientName: 'ANKUSH KUMAR JAIN', insurer: 'HDFC ERGO' }]
    const [m] = matchStatement(normaliseStatement([HDFC_ROW]), policies, 'Star Health')
    expect(m.status).toBe('review')
    expect(m.reason).toMatch(/insurer differs/)
  })
})

describe('Niva Bupa detailed export', () => {
  const NIVA = {
    'Policy Number': '32482287202604',
    'Customer Name': 'VIKRAMSINH RANA',
    'GWP(Before Tax)': 27570,
    'Commission Structure': 3504,
    'Payout %': 12.71,
    'Net Payment': 3433.92,
  }

  // "Payout %" collapses to the same key as the old commissionAmount alias
  // "payout", which read 12.71 as the amount instead of 3504.
  it('reads Payout % as the rate, not the amount', () => {
    const [row] = normaliseStatement([NIVA])
    expect(row.commissionPct).toBe(12.71)
    expect(row.commissionAmount).toBe(3504)
  })

  it('reads GWP(Before Tax) as the premium', () => {
    expect(normaliseStatement([NIVA])[0].premium).toBe(27570)
  })

  it('drops the all-zero balance adjustment rows', () => {
    const adjustment = { 'Policy Number': '00000000000000', 'Customer Name': '', 'Commission Structure': -3 }
    expect(normaliseStatement([adjustment, NIVA])).toHaveLength(1)
  })

  it('keeps genuine negative clawbacks', () => {
    const clawback = { ...NIVA, 'Policy Number': '50900200202501', 'Commission Structure': -893 }
    expect(normaliseStatement([clawback])[0].commissionAmount).toBe(-893)
  })
})

describe('multi-company aggregator bill', () => {
  // WealthMaker / Probus style: the carrier varies per row.
  const AGG = [
    {
      'Policy No.': 'TAG/2026/001', 'Investor': 'RAKESH SHAH',
      'Company/AMC': 'TATA AIG GENERAL INSURANCE CO. LTD.', 'Plan/Scheme': 'Motor Package',
      'Fresh/Renewal': 'Fresh', 'Amount': 24000, 'Expense': 2400,
    },
    {
      'Policy No.': 'HDF/2026/002', 'Investor': 'MEERA PATEL',
      'Company/AMC': 'HDFC ERGO', 'Plan/Scheme': 'Optima Secure',
      'Fresh/Renewal': 'Renewal', 'Amount': 18000, 'Expense': 1800,
    },
  ]

  it('reads a different carrier from each row', () => {
    const rows = normaliseStatement(AGG)
    expect(rows[0].insurer).toBe('TATA AIG GENERAL INSURANCE CO. LTD.')
    expect(rows[1].insurer).toBe('HDFC ERGO')
  })

  it('maps Investor to the client and Expense to the commission', () => {
    const [row] = normaliseStatement(AGG)
    expect(row.clientName).toBe('RAKESH SHAH')
    expect(row.commissionAmount).toBe(2400)
    expect(row.premium).toBe(24000)
  })

  it('captures plan and business type', () => {
    const rows = normaliseStatement(AGG)
    expect(rows[0].planName).toBe('Motor Package')
    expect(rows[0].businessType).toBe('Fresh')
    expect(rows[1].businessType).toBe('Renewal')
  })

  it('does not let a declared insurer override a per-row carrier', () => {
    const matched = matchStatement(normaliseStatement(AGG), [], 'Star Health')
    expect(matched[0].insurer).toBe('TATA AIG GENERAL INSURANCE CO. LTD.')
  })
})

describe('percent-header disambiguation', () => {
  // "Payout %" and "Payout" both reduce to "payout". Without the % rule the
  // rate is read as the amount — 12.71 posted instead of 3504.
  it('treats a % header as the rate even when the alias says amount', () => {
    const [row] = normaliseStatement([{
      'Policy Number': 'P1', 'Customer Name': 'A', 'Payout %': 12.71, 'Commission Structure': 3504,
    }])
    expect(row.commissionPct).toBe(12.71)
    expect(row.commissionAmount).toBe(3504)
  })

  it('treats a bare Payout column as the amount', () => {
    const [row] = normaliseStatement([{ 'Policy No.': 'P1', 'Investor': 'A', 'Payout': 2400 }])
    expect(row.commissionAmount).toBe(2400)
  })
})

describe('normaliseBusinessType', () => {
  it.each([
    ['Fresh', 'Fresh'], ['New', 'Fresh'], ['New Business', 'Fresh'],
    ['Renewal', 'Renewal'], ['Renewed Policy', 'Renewal'], ['RENEW', 'Renewal'],
    ['', ''], [null, ''], ['something else', ''],
  ])('maps %s to %s', (input, expected) => {
    expect(normaliseBusinessType(input)).toBe(expected)
  })
})

describe('toPayoutMonth', () => {
  it.each([
    [202606, '2026-06'],
    ['202606', '2026-06'],
    ['2026-06', '2026-06'],
    ['', ''],
    [null, ''],
    ['June 2026', ''],
  ])('maps %s to %s', (input, expected) => {
    expect(toPayoutMonth(input)).toBe(expected)
  })
})

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

describe('Star Health masked last-4 matching', () => {
  const book = [
    {
      id: 's1', policyNumber: 'P/2026/0002955', clientName: 'Ashvinbhai Jitendrabhai Bhatt',
      insurer: 'Star Health and Allied Insurance', premium: 750, startDate: '2026-07-30',
    },
    {
      id: 's2', policyNumber: 'P/2026/0003608', clientName: 'Bhavesh B Sharma',
      insurer: 'Star Health and Allied Insurance', premium: 24257, startDate: '2026-07-03',
    },
    {
      id: 's3', policyNumber: 'P/2025/0002955', clientName: 'Someone Else Entirely',
      insurer: 'HDFC ERGO', premium: 750, startDate: '2026-07-30',
    },
    {
      id: 's4', policyNumber: 'P/2024/0001519', clientName: 'Luckyrajsinh Y Jadeja',
      insurer: 'Star Health and Allied Insurance', premium: 9000, startDate: '2025-07-10',
      status: 'Renewed-Out',
    },
    {
      id: 's5', policyNumber: 'P/2026/0001519', clientName: 'Luckyrajsinh Y Jadeja',
      insurer: 'Star Health and Allied Insurance', premium: 10396, startDate: '2026-07-10',
    },
  ]

  const star = over => ({
    policyNumber: '************2955',
    clientName: 'ASHVINBHAI JITENDRABHAI BHATT',
    insurer: 'Star Health & Allied Insurance',
    premium: 750,
    commissionAmount: 127.12,
    startDate: '30/07/2026',
    ...over,
  })

  it('treats ************2955 as masked, not as policy 2955', () => {
    expect(isMaskedPolicyNumber('************2955')).toBe(true)
    expect(isMaskedPolicyNumber('P/2026/0002955')).toBe(false)
    expect(last4('************2955')).toBe('2955')
    expect(last4('P/2026/0002955')).toBe('2955')
  })

  it('does not exact-match a four-digit policy number of 2955', () => {
    const tiny = [{ id: 't', policyNumber: '2955', clientName: 'Unrelated', insurer: 'Star Health and Allied Insurance', premium: 1 }]
    const r = matchRow(star({ clientName: 'Nobody At All', premium: 9, startDate: '' }), tiny)
    expect(r.status).toBe('unmatched')
    expect(r.policy).toBeNull()
  })

  it('matches when last-4, name and premium all agree on a unique Star policy', () => {
    const r = matchRow(star(), book)
    expect(r.status).toBe('matched')
    expect(r.policy.id).toBe('s1')
  })

  it('matches when last-4, name and start date agree even if premium is off', () => {
    const r = matchRow(star({ premium: 999 }), book)
    expect(r.status).toBe('matched')
    expect(r.policy.id).toBe('s1')
  })

  it('stays in review when last-4 and name agree but premium and date do not', () => {
    const r = matchRow(star({ premium: 999, startDate: '01/01/2020' }), book)
    expect(r.status).toBe('review')
    expect(r.policy.id).toBe('s1')
    expect(r.reason).toMatch(/confirm premium/)
  })

  it('stays in review when last-4 hits but the name is someone else', () => {
    const r = matchRow(star({ clientName: 'Totally Different Person' }), book)
    expect(r.status).toBe('review')
    expect(r.reason).toMatch(/name differs/)
  })

  it('does not issue against the HDFC policy that happens to share last-4', () => {
    const r = matchRow(star(), book)
    expect(r.policy.id).toBe('s1')
    expect(r.policy.insurer).toMatch(/Star Health/)
  })

  it('picks the live term when last-4 is shared with a Renewed-Out row', () => {
    const r = matchRow(star({
      policyNumber: '************1519',
      clientName: 'LUCKYRAJSINH Y JADEJA',
      premium: 10396,
      startDate: '10/07/2026',
    }), book)
    expect(r.status).toBe('matched')
    expect(r.policy.id).toBe('s5')
  })

  it('refuses to pick when two live Star policies share last-4', () => {
    const clash = [
      ...book,
      {
        id: 's6', policyNumber: 'P/2026/1112955', clientName: 'Ashvinbhai Jitendrabhai Bhatt',
        insurer: 'Star Health and Allied Insurance', premium: 750, startDate: '2026-07-30',
      },
    ]
    const r = matchRow(star(), clash)
    expect(r.status).toBe('review')
    expect(r.policy).toBeNull()
    expect(r.reason).toMatch(/share last-4/)
  })

  it('reads MRS-glued Star names against the book', () => {
    const r = matchRow(star({
      policyNumber: '************3608',
      clientName: 'MRBHAVESH B SHARMA',
      premium: 24257,
      startDate: '03/07/2026',
    }), book)
    expect(r.status).toBe('matched')
    expect(r.policy.id).toBe('s2')
  })

  it('keeps June vs July posting keys apart even on the same last-4', () => {
    const july = { policyNumber: '************2955', payoutMonth: '2026-07', commissionAmount: 127.12, sourceRow: 1 }
    const june = { policyNumber: '63051627000082', payoutMonth: '2026-06', commissionAmount: 112.5, sourceRow: 1 }
    expect(postingKey(july)).not.toBe(postingKey(june))
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

  // Aditya Birla posts a Booster line and a Retail New Business line for the
  // same policy in the same month. Identical amounts must not collide.
  it('separates two rows that share policy, month and amount', () => {
    const row = { policyNumber: 'P1', payoutMonth: '2026-07', commissionAmount: 500 }
    expect(postingKey({ ...row, sourceRow: 4 })).not.toBe(postingKey({ ...row, sourceRow: 9 }))
  })

  it('is unchanged for the same row of the same file', () => {
    const row = { policyNumber: 'P1', payoutMonth: '2026-07', commissionAmount: 500, sourceRow: 4 }
    expect(postingKey(row)).toBe(postingKey({ ...row }))
  })
})

describe('legacyPostingKey', () => {
  it('keeps the pre-sourceRow shape', () => {
    const row = { policyNumber: 'P1', payoutMonth: '2026-07', commissionAmount: 500, sourceRow: 4 }
    expect(legacyPostingKey(row)).toBe('P1_2026-07_500')
    expect(postingKey(row)).toBe('P1_2026-07_500_r4')
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
