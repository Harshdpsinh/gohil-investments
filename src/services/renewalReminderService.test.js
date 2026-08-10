import { describe, it, expect, vi } from 'vitest'

// This module reaches Firestore and WhatsApp at import time. Both are replaced
// so the tests exercise pure settings logic only.
vi.mock('../firebase/firestore', () => ({
  addManualRenewalReminderLog: vi.fn(),
  claimRenewalReminder: vi.fn(),
  finishRenewalReminderLog: vi.fn(),
  getAllClients: vi.fn(),
  getAllPolicies: vi.fn(),
  getRenewalReminderSettings: vi.fn(),
}))
vi.mock('../utils/whatsappSender', () => ({
  sendWhatsApp: vi.fn(),
}))

const {
  normaliseReminderSettings,
  defaultRenewalReminderSettings,
  DEFAULT_RENEWAL_REMINDER_INTERVALS,
} = await import('./renewalReminderService')

describe('normaliseReminderSettings', () => {
  // Regression: getRenewalReminderSettings() returns null when the settings
  // document has never been saved. A `= {}` parameter default does not apply to
  // an explicit null, so this threw "Cannot read properties of null (reading
  // 'intervals')" on every renewal sweep of a fresh install.
  it.each([null, undefined])('falls back to defaults for %s', value => {
    const result = normaliseReminderSettings(value)
    expect(result.enabled).toBe(true)
    expect(result.intervals).toHaveLength(DEFAULT_RENEWAL_REMINDER_INTERVALS.length)
    expect(result.prompt).toBe(defaultRenewalReminderSettings().prompt)
  })

  it('falls back to defaults for an empty object', () => {
    expect(normaliseReminderSettings({}).intervals)
      .toHaveLength(DEFAULT_RENEWAL_REMINDER_INTERVALS.length)
  })

  it('uses the default intervals when the stored list is empty', () => {
    expect(normaliseReminderSettings({ intervals: [] }).intervals)
      .toHaveLength(DEFAULT_RENEWAL_REMINDER_INTERVALS.length)
  })

  it('keeps a stored interval list', () => {
    const result = normaliseReminderSettings({ intervals: [{ days: 10 }, { days: 3 }] })
    expect(result.intervals.map(i => i.days)).toEqual([10, 3])
  })

  it('sorts intervals furthest-out first', () => {
    const result = normaliseReminderSettings({ intervals: [{ days: 1 }, { days: 30 }, { days: 7 }] })
    expect(result.intervals.map(i => i.days)).toEqual([30, 7, 1])
  })

  it('drops duplicate day values', () => {
    const result = normaliseReminderSettings({ intervals: [{ days: 7 }, { days: 7 }, { days: 1 }] })
    expect(result.intervals.map(i => i.days)).toEqual([7, 1])
  })

  it('clamps a negative day count to zero', () => {
    expect(normaliseReminderSettings({ intervals: [{ days: -5 }] }).intervals[0].days).toBe(0)
  })

  it('treats a missing enabled flag as enabled', () => {
    expect(normaliseReminderSettings({ intervals: [{ days: 7 }] }).intervals[0].enabled).toBe(true)
  })

  it('respects an explicit disabled interval', () => {
    expect(normaliseReminderSettings({ intervals: [{ days: 7, enabled: false }] }).intervals[0].enabled)
      .toBe(false)
  })

  it('only treats enabled:false as disabled at the top level', () => {
    expect(normaliseReminderSettings({ enabled: false }).enabled).toBe(false)
    expect(normaliseReminderSettings({ enabled: undefined }).enabled).toBe(true)
  })

  it('trims a custom prompt', () => {
    expect(normaliseReminderSettings({ prompt: '  Renew soon  ' }).prompt).toBe('Renew soon')
  })

  it('falls back to the default prompt when blank', () => {
    expect(normaliseReminderSettings({ prompt: '   ' }).prompt)
      .toBe(defaultRenewalReminderSettings().prompt)
  })
})
