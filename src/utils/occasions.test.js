import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  daysUntilOccasion, isOccasionToday, listOccasions, birthdayGreeting, crossSellMessage,
} from './occasions.js'

const TODAY = new Date(2026, 6, 27, 12, 0, 0) // 27 Jul 2026

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('daysUntilOccasion', () => {
  it('is 0 on the birthday', () => {
    expect(isOccasionToday('1990-07-27')).toBe(true)
    expect(daysUntilOccasion('1990-07-27')).toBe(0)
  })

  it('rolls into next year after the date has passed', () => {
    expect(daysUntilOccasion('1990-07-20')).toBeGreaterThan(300)
  })
})

describe('listOccasions', () => {
  it('includes birthday and anniversary inside the window', () => {
    const rows = listOccasions([
      { id: '1', name: 'A', dob: '1990-07-27' },
      { id: '2', name: 'B', dob: '1990-01-01', anniversary: '2010-07-28' },
      { id: '3', name: 'C', dob: '1990-12-01' },
    ], { withinDays: 7 })
    expect(rows.map(r => `${r.client.id}:${r.kind}`)).toEqual(['1:birthday', '2:anniversary'])
  })
})

describe('messages', () => {
  it('names the client and does not invent tokens', () => {
    expect(birthdayGreeting({ name: 'Mehta' }, 2)).toContain('Mehta')
    expect(birthdayGreeting({ name: 'Mehta' }, 2)).toContain('2 active policies')
    expect(crossSellMessage({ name: 'Mehta' }, [{ label: 'No Health Cover' }])).toContain('Health')
  })
})
