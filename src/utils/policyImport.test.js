import { describe, it, expect } from 'vitest'
import {
  levenshtein, fuzzyMatch, isLifePolicyType, policyDocumentYear,
  buildImportClientReview, proposalToPolicyInitial, leadToPolicyInitial,
  TYPES, FREQS, STATUS,
} from './policyImport'
import { POLICY_TYPES, POLICY_FREQUENCIES, POLICY_STATUSES } from './validation'

describe('shared constants', () => {
  it('reuses the validation lists rather than keeping a second copy', () => {
    expect(TYPES).toBe(POLICY_TYPES)
    expect(FREQS).toBe(POLICY_FREQUENCIES)
    expect(STATUS).toBe(POLICY_STATUSES)
  })
})

describe('levenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['abc', 'abd', 1],
    ['kitten', 'sitting', 3],
    ['', 'abc', 3],
  ])('distance between %s and %s is %s', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected)
  })
})

describe('fuzzyMatch', () => {
  const clients = [
    { id: '1', name: 'Harshdipsinh Gohil' },
    { id: '2', name: 'Harshdipsinh Gohel' },
    { id: '3', name: 'Pradipsinh Gohil' },
    { id: '4', name: 'Meera Patel' },
  ]

  it('finds a near-identical name despite a spelling slip', () => {
    const result = fuzzyMatch('Harshdipsinh Gohel', clients)
    expect(result[0].id).toBe('2')
    expect(result[0].similarity).toBe(1)
  })

  it('ranks the closest candidate first', () => {
    const [best] = fuzzyMatch('Harshdipsinh Gohil', clients)
    expect(best.id).toBe('1')
  })

  it('returns nothing when no candidate is close enough', () => {
    expect(fuzzyMatch('Completely Different', clients)).toEqual([])
  })

  it('returns at most three suggestions', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: 'Aarav Shah' }))
    expect(fuzzyMatch('Aarav Shah', many)).toHaveLength(3)
  })

  it('skips candidates with no name instead of dividing by zero', () => {
    expect(fuzzyMatch('', [{ id: '1', name: '' }])).toEqual([])
  })

  it('is case and whitespace insensitive', () => {
    const result = fuzzyMatch('  MEERA PATEL  ', clients)
    expect(result[0].id).toBe('4')
  })
})

describe('isLifePolicyType', () => {
  it.each(['Life', 'life', '  LIFE  '])('recognises %s', value => {
    expect(isLifePolicyType(value)).toBe(true)
  })

  it.each(['Health', 'Motor', '', undefined])('rejects %s', value => {
    expect(isLifePolicyType(value)).toBe(false)
  })
})

describe('policyDocumentYear', () => {
  it('prefers an explicit PDF year', () => {
    expect(policyDocumentYear({ policyPdfYear: '2023', policyYear: 2, expiryDate: '2027-01-01' }))
      .toBe('2023')
  })

  it('falls back to the policy year', () => {
    expect(policyDocumentYear({ policyYear: 3, expiryDate: '2027-01-01' })).toBe(3)
  })

  it('derives the year from the expiry date', () => {
    expect(policyDocumentYear({ expiryDate: '2027-04-01' })).toBe('2027')
  })

  it('falls back through to the start date', () => {
    expect(policyDocumentYear({ startDate: '2021-06-30' })).toBe('2021')
  })

  it('uses the current year when the policy has no dates', () => {
    expect(policyDocumentYear({})).toBe(String(new Date().getFullYear()))
  })
})

describe('buildImportClientReview', () => {
  const matched = { id: 'c1', name: 'Meera Patel', mobile: '9876543210', email: 'meera@example.com' }

  it('returns null when there is no matched client', () => {
    expect(buildImportClientReview({ clientName: 'Anyone' }, null)).toBeNull()
  })

  it('returns null when everything agrees', () => {
    expect(buildImportClientReview({
      clientName: 'Meera Patel', clientMobile: '9876543210', clientEmail: 'meera@example.com',
    }, matched)).toBeNull()
  })

  it('ignores case differences in the name', () => {
    expect(buildImportClientReview({ clientName: 'MEERA PATEL' }, matched)).toBeNull()
  })

  it('ignores a country code on the mobile', () => {
    expect(buildImportClientReview({ clientMobile: '+91 98765 43210' }, matched)).toBeNull()
  })

  it('flags a differing name', () => {
    const review = buildImportClientReview({ clientName: 'Meera Shah' }, matched)
    expect(review.clientReviewRequired).toBe(true)
    expect(review.clientReviewReason).toMatch(/Name differs/)
    expect(review.importMatchedClientId).toBe('c1')
  })

  it('flags a differing mobile', () => {
    const review = buildImportClientReview({ clientMobile: '9999999999' }, matched)
    expect(review.clientReviewReason).toMatch(/Mobile differs/)
  })

  it('collects several problems into one reason', () => {
    const review = buildImportClientReview({
      clientName: 'Meera Shah', clientMobile: '9999999999', clientEmail: 'other@example.com',
    }, matched)
    expect(review.clientReviewReason.split(';')).toHaveLength(3)
  })

  it('does not flag a field the import left blank', () => {
    expect(buildImportClientReview({ clientName: '' }, matched)).toBeNull()
  })
})

describe('proposalToPolicyInitial', () => {
  it('returns null without a proposal', () => {
    expect(proposalToPolicyInitial(null)).toBeNull()
  })

  it('carries the core proposal fields across', () => {
    const result = proposalToPolicyInitial({
      id: 'p1', clientId: 'c1', clientName: 'Meera Patel', policyType: 'Life',
      insurer: 'HDFC Life', premium: '25000', frequency: 'half yearly',
    })
    expect(result.policyType).toBe('Life')
    expect(result.insurer).toBe('HDFC Life')
    expect(result.premium).toBe('25000')
    expect(result.proposalId).toBe('p1')
    expect(result.source).toBe('proposal')
  })

  it('normalises a loosely typed frequency', () => {
    const result = proposalToPolicyInitial({ frequency: 'qtly' })
    expect(result.frequency).toBe('Quarterly')
  })

  it('falls back to Health for an unrecognised policy type', () => {
    expect(proposalToPolicyInitial({ policyType: 'Spaceship' }).policyType).toBe('Health')
  })

  it('backfills contact details from the linked client', () => {
    const result = proposalToPolicyInitial(
      { clientId: 'c1' },
      [{ id: 'c1', name: 'Meera Patel', mobile: '9876543210', email: 'meera@example.com' }]
    )
    expect(result.clientName).toBe('Meera Patel')
    expect(result.clientMobile).toBe('9876543210')
    expect(result.clientEmail).toBe('meera@example.com')
  })

  it('prefers the proposal contact over the client record', () => {
    const result = proposalToPolicyInitial(
      { clientId: 'c1', mobile: '9000000000' },
      [{ id: 'c1', mobile: '9876543210' }]
    )
    expect(result.clientMobile).toBe('9000000000')
  })

  it('records where the policy came from in the notes', () => {
    expect(proposalToPolicyInitial({}).notes).toBe('Converted from proposal')
    expect(proposalToPolicyInitial({ notes: 'urgent' }).notes)
      .toBe('Converted from proposal: urgent')
  })
})

describe('leadToPolicyInitial', () => {
  it('returns null without a lead', () => {
    expect(leadToPolicyInitial(null)).toBeNull()
  })

  it.each([
    ['term plan', 'Life'],
    ['life cover', 'Life'],
    ['car insurance', 'Motor'],
    ['vehicle', 'Motor'],
    ['home cover', 'Home'],
    ['travel abroad', 'Travel'],
    ['mediclaim', 'Health'],
    ['', 'Health'],
  ])('infers %s as a %s policy', (need, expected) => {
    expect(leadToPolicyInitial({ insuranceNeed: need }).policyType).toBe(expected)
  })

  it('reads the type from leadType when insuranceNeed is empty', () => {
    expect(leadToPolicyInitial({ leadType: 'Motor renewal' }).policyType).toBe('Motor')
  })

  it('carries the lead value across as the premium', () => {
    const result = leadToPolicyInitial({ id: 'l1', leadValue: '12000' })
    expect(result.premium).toBe('12000')
    expect(result.leadId).toBe('l1')
    expect(result.source).toBe('lead')
  })

  it('builds a note naming the source and remarks', () => {
    expect(leadToPolicyInitial({ source: 'Referral', remarks: 'call after 6pm' }).notes)
      .toBe('Converted from lead (Referral): call after 6pm')
  })

  it('builds a bare note when there is no source or remarks', () => {
    expect(leadToPolicyInitial({}).notes).toBe('Converted from lead')
  })
})
