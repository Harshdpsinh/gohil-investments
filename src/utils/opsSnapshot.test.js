import { describe, it, expect } from 'vitest'
import {
  bookSnapshot,
  calendarMonth,
  displayPremiums,
  fyMonthTiles,
  isAutoWaOnPdfEnabled,
} from './opsSnapshot'

const asOf = new Date(2026, 8, 4) // 4 Sep 2026

const policy = (over = {}) => ({
  id: 'p1',
  clientName: 'Asha',
  insurer: 'Star Health',
  policyType: 'Health',
  premium: 10000,
  policyYear: 1,
  status: 'Active',
  startDate: '2026-05-01',
  expiryDate: '2027-04-30',
  ...over,
})

describe('bookSnapshot', () => {
  it('counts this FY and this month from startDate, not createdAt', () => {
    const snap = bookSnapshot([
      policy({ id: 'a', startDate: '2026-05-01', premium: 10000 }),
      policy({ id: 'b', startDate: '2026-09-02', premium: 5000, policyYear: 2 }),
      policy({ id: 'c', startDate: '2025-09-02', premium: 999 }), // last FY
    ], asOf)
    expect(snap.yearlyCount).toBe(2)
    expect(snap.yearlyPremium).toBe(15000)
    expect(snap.monthCount).toBe(1)
    expect(snap.monthPremium).toBe(5000)
    expect(snap.monthRenewalCount).toBe(1)
    expect(snap.monthRenewalPremium).toBe(5000)
  })
})

describe('fyMonthTiles', () => {
  it('returns 12 Apr–Mar tiles and puts May in the second slot', () => {
    const { tiles, range } = fyMonthTiles([
      policy({ startDate: '2026-05-10', premium: 12000 }),
    ], asOf)
    expect(tiles).toHaveLength(12)
    expect(tiles[0].label).toBe('Apr')
    expect(tiles[1].label).toBe('May')
    expect(tiles[1].premium).toBe(12000)
    expect(tiles[1].count).toBe(1)
    expect(range.from).toBe('2026-04-01')
  })
})

describe('displayPremiums', () => {
  it('keeps a single premium when gross is blank — old rows look the same', () => {
    expect(displayPremiums(policy())).toMatchObject({ net: 10000, gross: 10000, hasGross: false })
  })

  it('surfaces gross only when the optional field is filled', () => {
    expect(displayPremiums(policy({ grossPremium: 12500 }))).toMatchObject({
      net: 10000, gross: 12500, hasGross: true,
    })
  })

  it('hides NCB and discount when they are blank or zero', () => {
    expect(displayPremiums(policy({ ncbPct: '0', discountPct: '' }))).toMatchObject({
      hasNcb: false, hasDiscount: false,
    })
  })
})

describe('auto WhatsApp on PDF', () => {
  it('is off unless localStorage is explicitly set to 1', () => {
    expect(isAutoWaOnPdfEnabled()).toBe(false)
  })
})

describe('calendarMonth', () => {
  it('splits booked start dates from due dates', () => {
    const cal = calendarMonth([
      policy({ startDate: '2026-09-04', expiryDate: '2027-09-03', premium: 8000 }),
      policy({ id: 'due', startDate: '2025-09-10', expiryDate: '2026-09-10', premium: 3000 }),
    ], 2026, 8)
    expect(cal.days[4].booked).toBe(8000)
    expect(cal.days[10].due).toBe(3000)
    expect(cal.totals.booked).toBe(8000)
  })
})
