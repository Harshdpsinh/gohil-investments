import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseAnyDate, toInputDate, fmtDate, fmtDateTime, fmtCurrency, renewalStatus,
  normaliseFrequency, frequencyDays, frequencyMonths, addFrequencyInterval,
  coverageTermYears, isMultiYearPolicy, computeNextPremiumDue, getDueDate,
  daysUntilPolicyDue,
} from './dateUtils'

// Several helpers compare against "today". Freeze the clock at local noon so the
// results do not drift with the real date or shift across a timezone boundary.
const TODAY = new Date(2026, 6, 27, 12, 0, 0) // 27 July 2026

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('parseAnyDate', () => {
  it('reads a Firestore timestamp', () => {
    const seconds = Math.floor(Date.UTC(2026, 0, 15) / 1000)
    expect(parseAnyDate({ seconds }).getTime()).toBe(seconds * 1000)
  })

  it('passes a Date straight through', () => {
    const date = new Date(2026, 0, 15)
    expect(parseAnyDate(date)).toBe(date)
  })

  it.each([
    ['15/01/2026', 'dd/MM/yyyy — Indian day-first'],
    ['15-01-2026', 'dd-MM-yyyy'],
    ['2026-01-15', 'yyyy-MM-dd — storage format'],
    ['2026/01/15', 'yyyy/MM/dd'],
    ['15 Jan 2026', 'd MMM yyyy'],
    ['15 January 2026', 'full month name'],
    ['Jan 15, 2026', 'MMM d, yyyy'],
  ])('parses %s (%s)', input => {
    expect(toInputDate(input)).toBe('2026-01-15')
  })

  it('reads day-first, not month-first, for an ambiguous date', () => {
    // 03/04/2026 is 3 April in India, not 4 March.
    expect(toInputDate('03/04/2026')).toBe('2026-04-03')
  })

  it.each([null, undefined, '', '   ', 'not a date', '2026-13-45'])(
    'returns null for %s', input => {
      expect(parseAnyDate(input)).toBeNull()
    })
})

describe('display formatting', () => {
  it('formats a date for display', () => {
    expect(fmtDate('2026-01-15')).toBe('15/01/2026')
  })

  it('formats a date and time', () => {
    expect(fmtDateTime(new Date(2026, 0, 15, 14, 30))).toBe('15/01/2026 14:30')
  })

  it.each([fmtDate, fmtDateTime])('renders an em dash for an unparseable value', formatter => {
    expect(formatter('rubbish')).toBe('—')
  })
})

describe('fmtCurrency', () => {
  it.each([
    [15000000, '₹1.50 Cr'],
    [10000000, '₹1.00 Cr'],
    [250000, '₹2.50 L'],
    [100000, '₹1.00 L'],
    [1500, '₹1.5 K'],
    [999, '₹999'],
    [0, '₹0'],
  ])('formats %s as %s', (input, expected) => {
    expect(fmtCurrency(input)).toBe(expected)
  })

  it('falls back to zero for a non-numeric value', () => {
    expect(fmtCurrency('abc')).toBe('₹0')
  })
})

describe('renewalStatus', () => {
  it.each([
    ['2026-07-26', 'Expired', 'red'],
    ['2026-08-05', 'Critical', 'red'],
    ['2026-08-20', 'Due Soon', 'yellow'],
    ['2026-09-20', 'Upcoming', 'blue'],
    ['2026-12-31', 'Active', 'green'],
  ])('marks %s as %s', (date, label, color) => {
    expect(renewalStatus(date)).toEqual({ label, color })
  })

  it('reports Unknown when there is no date', () => {
    expect(renewalStatus(null)).toEqual({ label: 'Unknown', color: 'gray' })
  })
})

describe('normaliseFrequency', () => {
  it.each([
    ['Half-Yearly', 'Half-Yearly'], ['half yearly', 'Half-Yearly'],
    ['semiannual', 'Half-Yearly'], ['6 month', 'Half-Yearly'],
    ['quarterly', 'Quarterly'], ['qtr', 'Quarterly'], ['3 month', 'Quarterly'],
    ['monthly', 'Monthly'], ['mly', 'Monthly'], ['per month', 'Monthly'],
    ['yearly', 'Yearly'], ['annual', 'Yearly'], ['pa', 'Yearly'],
    ['yalry', 'Yearly'], ['yearley', 'Yearly'],
  ])('maps %s to %s', (input, expected) => {
    expect(normaliseFrequency(input)).toBe(expected)
  })

  it('treats a single premium as yearly', () => {
    expect(normaliseFrequency('Single Premium')).toBe('Yearly')
  })

  it.each([null, undefined, '', 'complete gibberish'])(
    'defaults %s to Yearly rather than throwing', input => {
      expect(normaliseFrequency(input)).toBe('Yearly')
    })
})

describe('frequency intervals', () => {
  it.each([
    ['Monthly', 30, 1], ['Quarterly', 90, 3],
    ['Half-Yearly', 180, 6], ['Yearly', 365, 12],
  ])('%s is %s days / %s months', (frequency, days, months) => {
    expect(frequencyDays(frequency)).toBe(days)
    expect(frequencyMonths(frequency)).toBe(months)
  })

  it('advances a date by one interval', () => {
    expect(toInputDate(addFrequencyInterval('2026-01-15', 'Quarterly'))).toBe('2026-04-15')
  })

  it('clamps to the last day when the target month is shorter', () => {
    expect(toInputDate(addFrequencyInterval('2026-01-31', 'Monthly'))).toBe('2026-02-28')
  })

  it('returns null for an unparseable date', () => {
    expect(addFrequencyInterval('rubbish', 'Yearly')).toBeNull()
  })
})

describe('coverageTermYears', () => {
  it.each([
    [{ coverageTermYears: 3 }, 3],
    [{ coverageTermYears: 0 }, 1],
    [{ coverageTermYears: 9 }, 5],
    [{ coverageTermYears: 2.6 }, 3],
    [{ coverageTermYears: 'abc' }, 1],
    [{}, 1],
  ])('resolves %o to %s', (policy, expected) => {
    expect(coverageTermYears(policy)).toBe(expected)
  })
})

describe('isMultiYearPolicy', () => {
  it('is true for a flagged multi-year general policy', () => {
    expect(isMultiYearPolicy({
      policyType: 'Motor', isMultiYearPolicy: true, coverageTermYears: 3,
    })).toBe(true)
  })

  it('is always false for Life, which uses premium frequency instead', () => {
    expect(isMultiYearPolicy({
      policyType: 'Life', isMultiYearPolicy: true, coverageTermYears: 3,
    })).toBe(false)
  })

  it('is false for a one year term even when flagged', () => {
    expect(isMultiYearPolicy({
      policyType: 'Motor', isMultiYearPolicy: true, coverageTermYears: 1,
    })).toBe(false)
  })

  it('is false when there is no policy', () => {
    expect(isMultiYearPolicy(null)).toBe(false)
  })
})

describe('computeNextPremiumDue', () => {
  it('rolls a long-running yearly policy forward to the next unpaid date', () => {
    expect(toInputDate(computeNextPremiumDue('2020-01-15', 'Yearly'))).toBe('2027-01-15')
  })

  it('finds the next monthly instalment', () => {
    expect(toInputDate(computeNextPremiumDue('2026-07-01', 'Monthly'))).toBe('2026-08-01')
  })

  it('returns a future start date unchanged', () => {
    expect(toInputDate(computeNextPremiumDue('2027-05-01', 'Yearly'))).toBe('2027-05-01')
  })

  it('returns null for an unparseable start date', () => {
    expect(computeNextPremiumDue('rubbish', 'Yearly')).toBeNull()
  })
})

describe('getDueDate', () => {
  it('uses the expiry date for a general policy', () => {
    expect(getDueDate({ policyType: 'Motor', expiryDate: '2027-03-15' })).toBe('2027-03-15')
  })

  it('prefers expiry over a stored premium due date for a general policy', () => {
    // Documented behaviour: for non-Life the expiry short-circuits everything else,
    // so a general policy can never report a due date beyond its own expiry.
    expect(getDueDate({
      policyType: 'Motor', expiryDate: '2026-12-01', nextPremiumDue: '2027-05-01',
    })).toBe('2026-12-01')
  })

  it('uses the stored premium due date for a Life policy', () => {
    expect(getDueDate({
      policyType: 'Life', expiryDate: '2040-01-01', nextPremiumDue: '2026-09-01',
    })).toBe('2026-09-01')
  })

  it('computes the next premium date for a Life policy that has none stored', () => {
    expect(getDueDate({
      policyType: 'Life', startDate: '2020-03-10', frequency: 'Yearly',
    })).toBe('2027-03-10')
  })

  it.each([null, undefined, {}])('returns an empty string for %s', policy => {
    expect(getDueDate(policy)).toBe('')
  })

  // Legacy rows store DD/MM/YYYY. Both renewal automations used to parse these
  // with a bare `new Date(str)`, which reads them as MM/DD/YYYY whenever the day
  // is 12 or lower — 01/12/2026 became 12 January, eleven months early, and the
  // reminder went out on the wrong day. Days above 12 happened to parse
  // correctly, which is why it went unnoticed. Both now call getDueDate.
  it.each([
    ['01/12/2026', '2026-12-01'],
    ['05/08/2026', '2026-08-05'],
    ['12/01/2027', '2027-01-12'],
    ['13/08/2026', '2026-08-13'],
    ['31/03/2027', '2027-03-31'],
  ])('reads the legacy date %s as day-first', (stored, expected) => {
    expect(getDueDate({ policyType: 'Health', expiryDate: stored })).toBe(expected)
  })
})

describe('daysUntilPolicyDue', () => {
  it('counts the days to a general policy expiry', () => {
    expect(daysUntilPolicyDue({ policyType: 'Motor', expiryDate: '2026-08-06' })).toBe(10)
  })

  it('returns a negative count for an expired policy', () => {
    expect(daysUntilPolicyDue({ policyType: 'Motor', expiryDate: '2026-07-20' })).toBe(-7)
  })

  it('returns null when there is no usable date', () => {
    expect(daysUntilPolicyDue({})).toBeNull()
  })
})
