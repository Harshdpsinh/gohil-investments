import { describe, it, expect } from 'vitest'
import {
  KNOWN_INSURERS,
  canonicalInsurer,
  duplicateInsurers,
  insurerFieldPatch,
  insurerKey,
  insurerOptions,
  sameInsurer,
  unrecognisedInsurers,
} from './insurers'

describe('KNOWN_INSURERS', () => {
  it('holds no two entries that mean the same company', () => {
    const keys = KNOWN_INSURERS.map(insurerKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has no blank keys, which would collapse unrelated names together', () => {
    expect(KNOWN_INSURERS.filter(name => !insurerKey(name))).toEqual([])
  })
})

describe('insurerKey', () => {
  it.each([
    ['HDFC ERGO', 'HDFC ERGO General Insurance'],
    ['HDFC ERGO', 'HDFC ERGO Motor'],
    ['Star Health & Allied Insurance', 'Star Health and Allied Insurance'],
    ['Tata AIG', 'Tata AIG General Insurance'],
    ['ICICI Lombard', 'ICICI Lombard General Insurance'],
    ['New India Assurance', 'NEW INDIA ASSURANCE CO. LTD.'],
    ['Bajaj Allianz General Insurance', 'Bajaj Allianz General Insurance Company Limited'],
  ])('treats %s and %s as one company', (a, b) => {
    expect(insurerKey(a)).toBe(insurerKey(b))
    expect(sameInsurer(a, b)).toBe(true)
  })

  it.each([
    ['Aditya Birla Health Insurance', 'Aditya Birla Sun Life Insurance'],
    ['HDFC ERGO General Insurance', 'HDFC Life Insurance'],
    ['ICICI Lombard General Insurance', 'ICICI Prudential Life Insurance'],
    ['SBI General Insurance', 'SBI Life Insurance'],
    ['Bajaj Allianz General Insurance', 'Bajaj Allianz Life Insurance'],
    ['Tata AIG General Insurance', 'Tata AIA Life Insurance'],
    ['Future Generali India Insurance', 'Future Generali India Life Insurance'],
  ])('keeps %s separate from %s', (a, b) => {
    expect(insurerKey(a)).not.toBe(insurerKey(b))
    expect(sameInsurer(a, b)).toBe(false)
  })

  it('returns empty for nothing, so blanks never match each other', () => {
    expect(insurerKey('')).toBe('')
    expect(sameInsurer('', '')).toBe(false)
    expect(sameInsurer(null, undefined)).toBe(false)
  })
})

describe('canonicalInsurer', () => {
  it.each([
    ['star health', 'Star Health and Allied Insurance'],
    ['STAR HEALTH & ALLIED INSURANCE', 'Star Health and Allied Insurance'],
    ['Max Bupa', 'Niva Bupa Health Insurance'],
    ['Niva Bupa (Max Bupa)', 'Niva Bupa Health Insurance'],
    ['Religare', 'Care Health Insurance'],
    ['hdfc ergo motor', 'HDFC ERGO General Insurance'],
    ['LIC', 'LIC of India'],
    ['Digit', 'Go Digit General Insurance'],
    ['Aegon Life', 'Bandhan Life Insurance'],
    ['Magma HDI', 'Magma General Insurance'],
    ['ICIC', 'ICICI Lombard General Insurance'],
    ['ICICI', 'ICICI Lombard General Insurance'],
    ['icici lombard', 'ICICI Lombard General Insurance'],
  ])('resolves %s to %s', (input, expected) => {
    expect(canonicalInsurer(input)).toBe(expected)
  })

  it('reads a bare Aditya Birla as the health arm, not the life arm', () => {
    expect(canonicalInsurer('Aditya Birla')).toBe('Aditya Birla Health Insurance')
    expect(canonicalInsurer('Aditya Birla Sun Life')).toBe('Aditya Birla Sun Life Insurance')
  })

  it.each([
    ['Star Heal', 'Star Health and Allied Insurance'],
    ['Niva Bup', 'Niva Bupa Health Insurance'],
    ['Cholamandal', 'Cholamandalam MS General Insurance'],
  ])('resolves the truncation %s to %s', (input, expected) => {
    expect(canonicalInsurer(input)).toBe(expected)
  })

  it('reads a bare ICICI as Lombard, and keeps Prudential Life apart', () => {
    expect(canonicalInsurer('ICIC')).toBe('ICICI Lombard General Insurance')
    expect(canonicalInsurer('ICICI')).toBe('ICICI Lombard General Insurance')
    expect(canonicalInsurer('ICICI Prudential')).toBe('ICICI Prudential Life Insurance')
    expect(canonicalInsurer('ICICI Prudential Life Insurance')).toBe('ICICI Prudential Life Insurance')
    expect(sameInsurer('ICICI', 'ICICI Prudential')).toBe(false)
  })

  it.each(['HDF', 'Tat', 'Nat'])('does not prefix-match the short fragment %s', value => {
    expect(canonicalInsurer(value)).toBe(value)
  })

  it('reads a bare SBI as the general insurer, and keeps SBI Life apart', () => {
    expect(canonicalInsurer('SBI')).toBe('SBI General Insurance')
    expect(canonicalInsurer('SBI Life')).toBe('SBI Life Insurance')
  })

  it('keeps an unknown company exactly as typed', () => {
    expect(canonicalInsurer('Saurashtra Mutual Insurance')).toBe('Saurashtra Mutual Insurance')
    expect(canonicalInsurer('  Trimmed Co  ')).toBe('Trimmed Co')
  })

  it.each([null, undefined, '', '   '])('returns empty for %s', value => {
    expect(canonicalInsurer(value)).toBe('')
  })
})

describe('insurerOptions', () => {
  it('offers the known list when the book is empty', () => {
    expect(insurerOptions()).toHaveLength(KNOWN_INSURERS.length)
  })

  it('shows one entry per company, not one per spelling', () => {
    const options = insurerOptions(['HDFC ERGO', 'HDFC ERGO General Insurance', 'HDFC ERGO Motor'])
    expect(options.filter(name => insurerKey(name) === insurerKey('HDFC ERGO'))).toHaveLength(1)
  })

  it('shows the master spelling so a short name in the book does not stay a duplicate', () => {
    expect(insurerOptions(['HDFC ERGO'])).toContain('HDFC ERGO General Insurance')
    expect(insurerOptions(['HDFC ERGO'])).not.toContain('HDFC ERGO')
  })

  it('adds a company the list has never heard of', () => {
    const options = insurerOptions(['Saurashtra Mutual Insurance'])
    expect(options).toContain('Saurashtra Mutual Insurance')
    expect(options).toHaveLength(KNOWN_INSURERS.length + 1)
  })

  it('ignores blanks in the book', () => {
    expect(insurerOptions(['', '   ', null, undefined])).toHaveLength(KNOWN_INSURERS.length)
  })

  it('comes back sorted', () => {
    const options = insurerOptions(['Zzz Insurance', 'Aaa Insurance'])
    expect([...options].sort((a, b) => a.localeCompare(b))).toEqual(options)
  })
})

describe('duplicateInsurers', () => {
  it('reports the spellings that mean one company', () => {
    const dupes = duplicateInsurers([
      'HDFC ERGO', 'HDFC ERGO General Insurance',
      'Star Health', 'Star Health and Allied Insurance', 'STAR HEALTH',
      'New India Assurance',
    ])
    expect(dupes).toHaveLength(2)
    const hdfc = dupes.find(d => d.canonical.startsWith('HDFC ERGO'))
    expect(hdfc.variants).toEqual(['HDFC ERGO', 'HDFC ERGO General Insurance'])
    const star = dupes.find(d => d.canonical.startsWith('Star Health'))
    expect(star.variants).toEqual(['STAR HEALTH', 'Star Health', 'Star Health and Allied Insurance'])
  })

  it('says nothing when every company is spelled one way', () => {
    expect(duplicateInsurers(['New India Assurance', 'LIC of India'])).toEqual([])
  })

  it('does not report the two Aditya Birla companies as duplicates', () => {
    expect(duplicateInsurers(['Aditya Birla Health Insurance', 'Aditya Birla Sun Life Insurance'])).toEqual([])
  })
})

describe('unrecognisedInsurers', () => {
  it('does not flag ICIC once it is mapped to Lombard', () => {
    expect(unrecognisedInsurers(['ICIC', 'ICICI', 'ICICI Lombard General Insurance'])).toEqual([])
  })

  it('says nothing about names it resolved', () => {
    expect(unrecognisedInsurers([
      'HDFC ERGO', 'Star Heal', 'Max Bupa', 'LIC', 'New India Assurance',
    ])).toEqual([])
  })

  it('lists a genuinely unknown company once, however often it appears', () => {
    expect(unrecognisedInsurers(['Saurashtra Mutual', 'saurashtra  mutual', 'Saurashtra Mutual']))
      .toEqual(['Saurashtra Mutual'])
  })

  it('ignores blanks', () => {
    expect(unrecognisedInsurers(['', '   ', null, undefined])).toEqual([])
  })

  it('comes back sorted', () => {
    expect(unrecognisedInsurers(['Zzz Co', 'Aaa Co'])).toEqual(['Aaa Co', 'Zzz Co'])
  })
})

describe('insurerFieldPatch', () => {
  it('rewrites only the company-name fields that differ from the master spelling', () => {
    expect(insurerFieldPatch({
      insurer: 'HDFC ERGO',
      prevInsurer: 'Max Bupa',
      premium: 12000,
      policyNumber: 'P-1',
    })).toEqual({
      insurer: 'HDFC ERGO General Insurance',
      prevInsurer: 'Niva Bupa Health Insurance',
    })
  })

  it('rewrites a bare ICICI onto Lombard', () => {
    expect(insurerFieldPatch({ insurer: 'ICIC' })).toEqual({
      insurer: 'ICICI Lombard General Insurance',
    })
    expect(insurerFieldPatch({ insurer: 'ICICI' })).toEqual({
      insurer: 'ICICI Lombard General Insurance',
    })
  })

  it('does not invent a patch when the name is already canonical or unknown', () => {
    expect(insurerFieldPatch({
      insurer: 'HDFC ERGO General Insurance',
      latestPolicyInsurer: 'Saurashtra Mutual',
    })).toEqual({})
  })

  it('leaves life and general arms of the same brand untouched as separate names', () => {
    expect(insurerFieldPatch({ insurer: 'HDFC Life Insurance' })).toEqual({})
    expect(insurerFieldPatch({ insurer: 'Aditya Birla Sun Life Insurance' })).toEqual({})
    expect(insurerFieldPatch({ insurer: 'ICICI Prudential Life Insurance' })).toEqual({})
  })
})
