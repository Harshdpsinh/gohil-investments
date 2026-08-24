import { describe, it, expect } from 'vitest'
import {
  DEFAULT_AUTO_REPLY,
  QUICK_REPLIES,
  fillReply,
  isStorableMedia,
  isWithinBusinessHours,
  mediaFilename,
  quickRepliesFor,
  shouldAutoReply,
} from './whatsappFeatures'

// 12:00 UTC is 17:30 IST — inside office hours. Wednesday.
const IN_HOURS = Date.UTC(2026, 7, 19, 12, 0, 0)
// 18:00 UTC is 23:30 IST — closed.
const AFTER_HOURS = Date.UTC(2026, 7, 19, 18, 0, 0)
// Sunday 12:00 UTC — 17:30 IST but the office is shut all day.
const SUNDAY = Date.UTC(2026, 7, 23, 12, 0, 0)

describe('fillReply', () => {
  it('substitutes the same tokens the reminder uses', () => {
    expect(fillReply('Dear {clientName}, policy {policyNumber} is due {dueDate}.', {
      clientName: 'Mehul Shah', policyNumber: 'NB/778899', dueDate: '16 Aug 2026',
    })).toBe('Dear Mehul Shah, policy NB/778899 is due 16 Aug 2026.')
  })

  // Sending a client a literal "{premium}" is worse than a terser sentence.
  it('drops an unknown token instead of printing the placeholder', () => {
    expect(fillReply('Hello {clientName}, premium {premium}.', { clientName: 'Asha' }))
      .toBe('Hello Asha, premium.')
  })

  it('tidies the spacing a removed token leaves behind', () => {
    expect(fillReply('Your {policyType} policy is ready.', {})).toBe('Your policy is ready.')
  })

  it.each([null, undefined, ''])('returns empty for %s', value => {
    expect(fillReply(value, { clientName: 'X' })).toBe('')
  })
})

describe('quickRepliesFor', () => {
  const filled = quickRepliesFor({
    clientName: 'Mehul', policyType: 'Health', policyNumber: 'NB/1', dueDate: '1 Sep 2026', premium: '₹24,500',
  })

  it('fills every canned reply for the conversation', () => {
    expect(filled).toHaveLength(QUICK_REPLIES.length)
    expect(filled.find(r => r.id === 'renewal-due').filled)
      .toBe('Your Health policy NB/1 is due for renewal on 1 Sep 2026. Premium is ₹24,500. Shall I proceed with the renewal?')
  })

  it('never leaves an unfilled token in any reply', () => {
    filled.forEach(reply => expect(reply.filled).not.toMatch(/\{\w+\}/))
  })

  it('still produces sendable text with no context at all', () => {
    quickRepliesFor({}).forEach(reply => {
      expect(reply.filled.length).toBeGreaterThan(0)
      expect(reply.filled).not.toMatch(/\{\w+\}/)
    })
  })
})

describe('isWithinBusinessHours', () => {
  // The office runs on IST; judging by UTC would call 23:30 local "midday".
  it('reads the hour in the office timezone, not UTC', () => {
    expect(isWithinBusinessHours(IN_HOURS)).toBe(true)
    expect(isWithinBusinessHours(AFTER_HOURS)).toBe(false)
  })

  it('treats Sunday as closed all day', () => {
    expect(isWithinBusinessHours(SUNDAY)).toBe(false)
  })

  it('is exclusive at the closing hour', () => {
    const settings = { ...DEFAULT_AUTO_REPLY, startHour: 10, endHour: 19 }
    // 13:29 UTC = 18:59 IST, still open. 13:30 UTC = 19:00 IST, closed.
    expect(isWithinBusinessHours(Date.UTC(2026, 7, 19, 13, 29), settings)).toBe(true)
    expect(isWithinBusinessHours(Date.UTC(2026, 7, 19, 13, 30), settings)).toBe(false)
  })
})

describe('shouldAutoReply', () => {
  const on = { ...DEFAULT_AUTO_REPLY, enabled: true }

  // Off by default: an auto-responder nobody asked for is a way to get reported.
  it('does nothing unless switched on', () => {
    expect(shouldAutoReply({ at: AFTER_HOURS, settings: DEFAULT_AUTO_REPLY })).toBe(false)
  })

  it('replies out of hours when enabled', () => {
    expect(shouldAutoReply({ at: AFTER_HOURS, settings: on })).toBe(true)
  })

  it('stays quiet during business hours — a person will answer', () => {
    expect(shouldAutoReply({ at: IN_HOURS, settings: on })).toBe(false)
  })

  // Firing on every message in a back-and-forth is the classic failure.
  it('respects the cooldown', () => {
    expect(shouldAutoReply({ at: AFTER_HOURS, lastAutoReplyAt: AFTER_HOURS - 3600000, settings: on })).toBe(false)
    expect(shouldAutoReply({ at: AFTER_HOURS, lastAutoReplyAt: AFTER_HOURS - 13 * 3600000, settings: on })).toBe(true)
  })

  it('replies on a Sunday, when nobody is in', () => {
    expect(shouldAutoReply({ at: SUNDAY, settings: on })).toBe(true)
  })
})

describe('mediaFilename', () => {
  const at = Date.UTC(2026, 7, 19, 12, 30, 0)

  it('keeps the name WhatsApp supplied for a document', () => {
    expect(mediaFilename({ filename: 'Policy Schedule.pdf', type: 'document' })).toBe('Policy Schedule.pdf')
  })

  it('strips characters that would break a storage path', () => {
    expect(mediaFilename({ filename: 'policy/../secret;rm.pdf' })).toBe('policy_.._secret_rm.pdf')
  })

  // A photo of an RC book arrives with no name at all.
  it('invents a dated name from the mime type when none is given', () => {
    expect(mediaFilename({ type: 'image', mimeType: 'image/jpeg', timestamp: at }))
      .toBe('image-2026-08-19-12-30-00.jpg')
  })

  it('falls back to the mime subtype, then to bin', () => {
    expect(mediaFilename({ type: 'document', mimeType: 'application/vnd.ms-excel', timestamp: at }))
      .toMatch(/\.vnd\.ms-excel$/)
    expect(mediaFilename({ type: 'document', timestamp: at })).toMatch(/\.bin$/)
  })
})

describe('isStorableMedia', () => {
  it.each(['image', 'document', 'video', 'audio'])('stores an inbound %s', type => {
    expect(isStorableMedia({ type, mediaId: 'm1' })).toBe(true)
  })

  it.each([
    ['text', { type: 'text', mediaId: '' }],
    ['a sticker', { type: 'sticker', mediaId: 'm1' }],
    ['media with no id', { type: 'image', mediaId: '' }],
  ])('does not store %s', (_label, message) => {
    expect(isStorableMedia(message)).toBe(false)
  })
})
