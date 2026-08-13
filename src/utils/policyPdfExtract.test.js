import { describe, it, expect } from 'vitest'
import {
  extractPolicyFields, matchExtractedPolicy, buildFieldReview,
  detectInsurer, detectPolicyType, matchExtractedClient, splitExtractedFields,
} from './policyPdfExtract'

// Page captures in the shape pdfStatement.extractLines returns. Each fixture
// uses a different layout convention on purpose, because that is the whole
// point of matching on labels instead of coordinates:
//   HEALTH — "Label: value" inside one text run
//   MOTOR  — label and value as separate runs on the same line
//   LIFE   — value stacked underneath its label, and a Period of Insurance range
const line = (y, cells) => ({ y, cells })
const at = (x, text) => ({ x, text })

const HEALTH = [[
  line(780, [at(40, 'Star Health and Allied Insurance Co Ltd')]),
  line(750, [at(40, 'HEALTH INSURANCE POLICY SCHEDULE')]),
  line(700, [at(40, 'Policy No: P/181117/01/2026/004521')]),
  line(680, [at(40, "Insured's Name: DESAI GATI TARAKBHAI")]),
  line(660, [at(40, 'Plan Name: Young Star Gold')]),
  line(640, [at(40, 'Sum Insured: Rs. 10,00,000')]),
  line(620, [at(40, 'Commencement Date: 02/08/2025')]),
  line(600, [at(40, 'Expiry Date: 01/08/2026')]),
  line(580, [at(40, 'Total Premium: Rs. 7,627.00')]),
  line(560, [at(40, 'Nominee Name: Tarakbhai Desai')]),
  line(400, [at(40, 'Room rent limit applies. Hospitalisation cover as per terms.')]),
]]

const MOTOR = [[
  line(790, [at(30, 'ICICI Lombard General Insurance Company Limited')]),
  line(740, [at(30, 'Policy No'), at(160, 'MOT/4128i/12345678/00')]),
  line(715, [at(30, 'Proposer Name'), at(160, 'RAJU PATEL')]),
  line(690, [at(30, 'Registration No'), at(160, 'GJ04AB1234')]),
  line(665, [at(30, 'IDV'), at(160, '4,50,000'), at(330, 'Chassis No'), at(430, 'MA3ABC123')]),
  line(640, [at(30, 'Start Date'), at(160, '15/06/2026'), at(330, 'Expiry Date'), at(430, '14/06/2027')]),
  line(615, [at(30, 'Total Premium'), at(160, '18,432.00')]),
]]

const LIFE = [[
  line(800, [at(50, 'Tata AIA Life Insurance Company Limited')]),
  line(770, [at(50, 'Policy Number')]),
  line(752, [at(50, 'U1234567')]),
  line(720, [at(50, 'Name of the Life Assured')]),
  line(702, [at(50, 'RAMESH PATEL')]),
  line(670, [at(50, 'Period of Insurance'), at(220, '01/04/2026'), at(300, 'to'), at(340, '31/03/2027')]),
  line(640, [at(50, 'Sum Assured'), at(220, '25,00,000')]),
  line(610, [at(50, 'Premium Amount'), at(220, '50,000')]),
  line(580, [at(50, 'Maturity Date'), at(220, '31/03/2046')]),
]]

describe('extractPolicyFields — "Label: value" in one run', () => {
  const r = extractPolicyFields(HEALTH)

  it('reads every core field off a health schedule', () => {
    expect(r.fields).toMatchObject({
      policyNumber: 'P/181117/01/2026/004521',
      clientName: 'DESAI GATI TARAKBHAI',
      planName: 'Young Star Gold',
      sumInsured: '1000000',
      startDate: '2025-08-02',
      expiryDate: '2026-08-01',
      premium: '7627',
      nominee: 'Tarakbhai Desai',
    })
  })

  it('identifies the carrier from the letterhead, not a label', () => {
    expect(r.fields.insurer).toBe('Star Health and Allied Insurance')
    expect(r.fields.policyType).toBe('Health')
  })

  it('reports the motor-only field as missing rather than guessing', () => {
    expect(r.missing).toContain('registrationNo')
    expect(r.fields.registrationNo).toBe('')
  })
})

describe('extractPolicyFields — label and value in separate runs', () => {
  const r = extractPolicyFields(MOTOR)

  it('takes the value from the cell beside the label', () => {
    expect(r.fields).toMatchObject({
      policyNumber: 'MOT/4128i/12345678/00',
      clientName: 'RAJU PATEL',
      registrationNo: 'GJ04AB1234',
      premium: '18432',
      startDate: '2026-06-15',
      expiryDate: '2027-06-14',
      policyType: 'Motor',
    })
  })

  // Two fields share line y=665 and y=640. Without the stop-at-next-label rule
  // the start date swallows "Expiry Date 14/06/2027" too.
  it('does not bleed the neighbouring column into a value', () => {
    expect(r.fields.startDate).toBe('2026-06-15')
    expect(r.fields.expiryDate).toBe('2027-06-14')
  })
})

describe('extractPolicyFields — stacked values and date ranges', () => {
  const r = extractPolicyFields(LIFE)

  it('finds a value sitting under its label', () => {
    expect(r.fields.policyNumber).toBe('U1234567')
    expect(r.fields.clientName).toBe('RAMESH PATEL')
  })

  it('splits a Period of Insurance range into start and expiry', () => {
    expect(r.fields.startDate).toBe('2026-04-01')
    expect(r.fields.expiryDate).toBe('2027-03-31')
  })

  it('reads sum assured and premium', () => {
    expect(r.fields.sumInsured).toBe('2500000')
    expect(r.fields.premium).toBe('50000')
    expect(r.fields.policyType).toBe('Life')
  })
})

describe('confidence tagging', () => {
  it('flags an unusable value as uncertain, never as found', () => {
    const r = extractPolicyFields([[
      line(700, [at(40, 'Policy No: N/A')]),
      line(680, [at(40, 'Total Premium: to be advised')]),
      line(660, [at(40, 'Start Date: pending')]),
    ]])
    expect(r.status.policyNumber).toBe('uncertain')
    expect(r.status.premium).toBe('uncertain')
    expect(r.status.startDate).toBe('uncertain')
    expect(r.found).not.toContain('premium')
  })

  it('marks a field with no label anywhere as missing', () => {
    const r = extractPolicyFields([[line(700, [at(40, 'Nothing useful here')])]])
    expect(r.missing).toEqual(expect.arrayContaining(['policyNumber', 'premium', 'clientName']))
    expect(r.found).toEqual([])
  })

  it('survives an empty document', () => {
    const r = extractPolicyFields([])
    expect(r.found).toEqual([])
    expect(r.fields.policyNumber).toBe('')
  })
})

describe('detectInsurer / detectPolicyType', () => {
  it('prefers the longest matching insurer name', () => {
    expect(detectInsurer('issued by Star Health and Allied Insurance for you'))
      .toBe('Star Health and Allied Insurance')
  })

  it('returns empty rather than guessing an unknown carrier', () => {
    expect(detectInsurer('Some Unlisted Insurer Ltd')).toBe('')
    expect(detectPolicyType('nothing identifying here')).toBe('')
  })

  it('reads motor from vehicle vocabulary even without the word motor', () => {
    expect(detectPolicyType('Chassis No MA3 Engine No 44 IDV 400000')).toBe('Motor')
  })
})

describe('matchExtractedPolicy', () => {
  const policies = [
    { id: 'p1', policyNumber: 'POL-001', clientName: 'RAJU PATEL', insurer: 'HDFC ERGO' },
    { id: 'p2', policyNumber: 'POL-002', clientName: 'SITA DEVI', insurer: 'Niva Bupa' },
  ]

  it('updates on an exact policy number', () => {
    const r = matchExtractedPolicy({ policyNumber: 'pol 001' }, policies)
    expect(r.action).toBe('update')
    expect(r.policy.id).toBe('p1')
  })

  it('creates when nothing resembles it', () => {
    expect(matchExtractedPolicy({ policyNumber: 'ZZZ-999', clientName: 'NOBODY' }, policies).action)
      .toBe('create')
  })

  // A name match must never resolve on its own — family members hold near
  // identical policies and a fuzzy hit is not proof.
  it('sends a name-only hit to review, never straight to update', () => {
    const r = matchExtractedPolicy({ policyNumber: 'NEW-123', clientName: 'RAJU PATEL' }, policies)
    expect(r.action).toBe('review')
    expect(r.policy.id).toBe('p1')
  })

  it('refuses to choose between duplicate policy numbers', () => {
    const dupes = [...policies, { id: 'p3', policyNumber: 'POL-001', clientName: 'OTHER' }]
    const r = matchExtractedPolicy({ policyNumber: 'POL-001' }, dupes)
    expect(r.action).toBe('review')
    expect(r.policy).toBeNull()
  })
})

describe('buildFieldReview', () => {
  const extracted = extractPolicyFields(HEALTH)

  it('marks a blank database field as a fill', () => {
    const rows = buildFieldReview(extracted, { policyNumber: 'P/181117/01/2026/004521', premium: '' })
    expect(rows.find(r => r.field === 'premium').state).toBe('fill')
  })

  it('marks matching values as agreeing', () => {
    const rows = buildFieldReview(extracted, { policyNumber: 'P/181117/01/2026/004521' })
    expect(rows.find(r => r.field === 'policyNumber').state).toBe('agree')
  })

  it('flags a genuine disagreement as a conflict', () => {
    const rows = buildFieldReview(extracted, { premium: '9999' })
    expect(rows.find(r => r.field === 'premium').state).toBe('conflict')
  })

  // The schedule says "Star Health and Allied Insurance", the record says
  // "Star Health". That is the same carrier, not a discrepancy to chase.
  it('accepts a longer legal insurer name as the same carrier', () => {
    const rows = buildFieldReview(extracted, { insurer: 'Star Health' })
    expect(rows.find(r => r.field === 'insurer').state).toBe('agree')
  })

  it('still flags a genuinely different insurer', () => {
    const rows = buildFieldReview(extracted, { insurer: 'HDFC ERGO' })
    expect(rows.find(r => r.field === 'insurer').state).toBe('conflict')
  })

  it('keeps missing and uncertain states through to the review', () => {
    const rows = buildFieldReview(extracted, null)
    expect(rows.find(r => r.field === 'registrationNo').state).toBe('missing')
  })

  it('treats every field as a fill when creating a new policy', () => {
    const rows = buildFieldReview(extracted, null)
    expect(rows.find(r => r.field === 'policyNumber').state).toBe('fill')
  })
})

// ── Client extraction and matching ──────────────────────────────────────────
// A schedule carries the person's details alongside the policy's. These feed
// the client record, so that a policy read from a PDF can be filed against the
// right person instead of creating a duplicate.
const WITH_CLIENT = [[
  line(780, [at(40, 'Niva Bupa Health Insurance')]),
  line(700, [at(40, 'Policy No: NB/2026/778899')]),
  line(680, [at(40, "Insured's Name: MEHUL SHAH")]),
  line(660, [at(40, 'Mobile No: +91 98250 12345')]),
  line(640, [at(40, 'Email ID: Mehul.Shah@Example.COM')]),
  line(620, [at(40, 'Date of Birth: 12/07/1984')]),
  line(600, [at(40, 'PAN No: abcde1234f')]),
  line(580, [at(40, 'Communication Address: 12 Kalubha Road, Bhavnagar 364001')]),
  line(560, [at(40, 'Total Premium: Rs. 24,500')]),
]]

describe('extractPolicyFields — client details', () => {
  const r = extractPolicyFields(WITH_CLIENT)

  // Schedules print +91 and spaces; the client record stores ten digits.
  it('normalises an Indian mobile to ten digits', () => {
    expect(r.fields.mobile).toBe('9825012345')
  })

  it('lowercases the email', () => {
    expect(r.fields.email).toBe('mehul.shah@example.com')
  })

  it('reads date of birth as an input date', () => {
    expect(r.fields.dob).toBe('1984-07-12')
  })

  it('uppercases PAN', () => {
    expect(r.fields.pan).toBe('ABCDE1234F')
  })

  it('keeps the address', () => {
    expect(r.fields.address).toContain('Kalubha Road')
  })

  // Firestore rejects a malformed PAN outright, so a half-read one must be
  // flagged for the user rather than sent to the save.
  it('marks an unusable PAN uncertain instead of passing it through', () => {
    const bad = extractPolicyFields([[line(700, [at(40, 'PAN No: ABCDE12')])]])
    expect(bad.status.pan).toBe('uncertain')
  })

  it('marks a landline as uncertain rather than storing it as a mobile', () => {
    const bad = extractPolicyFields([[line(700, [at(40, 'Contact No: 0278-2422222')])]])
    expect(bad.status.mobile).toBe('uncertain')
  })
})

describe('splitExtractedFields', () => {
  const { client, policy } = splitExtractedFields(extractPolicyFields(WITH_CLIENT).fields)

  // normalisePolicyPayload does NOT allow-list, so a stray mobile would be
  // written onto the policy document itself.
  it('keeps personal details off the policy record', () => {
    expect(policy.mobile).toBeUndefined()
    expect(policy.email).toBeUndefined()
    expect(policy.pan).toBeUndefined()
    expect(policy.dob).toBeUndefined()
    expect(policy.address).toBeUndefined()
  })

  it('renames clientName to name for the client record', () => {
    expect(client.name).toBe('MEHUL SHAH')
    expect(client.clientName).toBeUndefined()
  })

  // The policy denormalises the client's name and relies on it.
  it('keeps clientName on the policy as well', () => {
    expect(policy.clientName).toBe('MEHUL SHAH')
  })

  it('drops blanks from both sides', () => {
    const { client: c, policy: p } = splitExtractedFields({ clientName: 'A B', mobile: '', premium: '  ' })
    expect(c).toEqual({ name: 'A B' })
    expect(p).toEqual({ clientName: 'A B' })
  })
})

describe('matchExtractedClient', () => {
  const clients = [
    { id: 'c1', name: 'MEHUL SHAH', mobile: '9825012345', pan: 'ABCDE1234F' },
    { id: 'c2', name: 'MEHUL SHAHA', mobile: '9825099999' },
    { id: 'c3', name: 'RAJU PATEL', mobile: '9099099099' },
  ]

  it('links on an exact mobile match without asking', () => {
    const r = matchExtractedClient({ mobile: '+91 98250 12345', clientName: 'Anything' }, clients)
    expect(r.action).toBe('link')
    expect(r.client.id).toBe('c1')
  })

  it('links on PAN when no mobile was read', () => {
    const r = matchExtractedClient({ pan: 'abcde1234f' }, clients)
    expect(r.action).toBe('link')
    expect(r.client.id).toBe('c1')
  })

  // Two brothers routinely share a surname. Filing a policy under the wrong
  // sibling is worse than asking one extra question.
  it('only asks for confirmation on a name match', () => {
    const r = matchExtractedClient({ clientName: 'RAJU PATEL' }, clients)
    expect(r.action).toBe('confirm')
    expect(r.client.id).toBe('c3')
  })

  it('makes the user choose when several names are close', () => {
    const r = matchExtractedClient({ clientName: 'MEHUL SHAH' }, [clients[0], clients[1]])
    expect(r.action).toBe('choose')
    expect(r.candidates).toHaveLength(2)
  })

  it('offers to create when nobody resembles the name', () => {
    expect(matchExtractedClient({ clientName: 'BRAND NEW PERSON' }, clients).action).toBe('create')
  })

  it('offers to create when the PDF had no name at all', () => {
    expect(matchExtractedClient({}, clients).action).toBe('create')
  })

  it('makes the user choose when one mobile is on two records', () => {
    const dupes = [{ id: 'a', name: 'A', mobile: '9825012345' }, { id: 'b', name: 'B', mobile: '9825012345' }]
    expect(matchExtractedClient({ mobile: '9825012345' }, dupes).action).toBe('choose')
  })

  it('creates rather than crashing against an empty book', () => {
    expect(matchExtractedClient({ clientName: 'ANY' }, []).action).toBe('create')
  })
})
