import { describe, it, expect } from 'vitest'
import {
  WINDOW_MS,
  buildConversations,
  formatWindow,
  matchConversationClient,
  parseWebhookPayload,
  windowState,
} from './whatsappInbox'

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0)
const secs = ms => String(Math.floor(ms / 1000))

const payload = value => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value }] }],
})

describe('parseWebhookPayload', () => {
  it('reads an inbound text with the sender profile name', () => {
    const { messages } = parseWebhookPayload(payload({
      contacts: [{ wa_id: '919825012345', profile: { name: 'Mehul Shah' } }],
      messages: [{ from: '919825012345', id: 'wamid.A', timestamp: secs(NOW), type: 'text', text: { body: 'Is my policy renewed?' } }],
    }))
    expect(messages).toEqual([expect.objectContaining({
      messageId: 'wamid.A',
      waId: '919825012345',
      profileName: 'Mehul Shah',
      direction: 'in',
      type: 'text',
      text: 'Is my policy renewed?',
      timestamp: NOW,
    })])
  })

  // A delivery receipt for an old reminder routinely arrives in the same POST
  // as a new message; treating the body as one kind loses the other.
  it('separates delivery receipts from messages in one payload', () => {
    const { messages, statuses } = parseWebhookPayload(payload({
      messages: [{ from: '919825012345', id: 'wamid.A', timestamp: secs(NOW), type: 'text', text: { body: 'hi' } }],
      statuses: [{ id: 'wamid.OLD', recipient_id: '919000011111', status: 'read', timestamp: secs(NOW) }],
    }))
    expect(messages).toHaveLength(1)
    expect(statuses).toEqual([expect.objectContaining({ messageId: 'wamid.OLD', status: 'read', waId: '919000011111' })])
  })

  it('carries a failure reason through so a dead send is not silent', () => {
    const { statuses } = parseWebhookPayload(payload({
      statuses: [{ id: 'wamid.X', recipient_id: '919825012345', status: 'failed', timestamp: secs(NOW), errors: [{ title: 'Re-engagement message' }] }],
    }))
    expect(statuses[0]).toMatchObject({ status: 'failed', error: 'Re-engagement message' })
  })

  it.each([
    ['image with a caption', { type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'my policy card' } }, 'my policy card'],
    ['document without one', { type: 'document', document: { id: 'm2', mime_type: 'application/pdf', filename: 'policy.pdf' } }, 'Sent a document'],
    ['a location', { type: 'location', location: { latitude: 21, longitude: 72 } }, 'Shared a location'],
    ['a quick-reply button', { type: 'button', button: { text: 'Renew now' } }, 'Renew now'],
  ])('gives %s something readable in the list', (_label, extra, expected) => {
    const { messages } = parseWebhookPayload(payload({
      messages: [{ from: '919825012345', id: 'wamid.B', timestamp: secs(NOW), ...extra }],
    }))
    expect(messages[0].text).toBe(expected)
  })

  it('keeps the media id so the file can be fetched later', () => {
    const { messages } = parseWebhookPayload(payload({
      messages: [{ from: '919825012345', id: 'x', timestamp: secs(NOW), type: 'document', document: { id: 'MEDIA_1', mime_type: 'application/pdf', filename: 'p.pdf' } }],
    }))
    expect(messages[0]).toMatchObject({ mediaId: 'MEDIA_1', mimeType: 'application/pdf', filename: 'p.pdf' })
  })

  it.each([{}, { entry: [] }, { entry: [{ changes: [] }] }, { entry: [{ changes: [{ value: {} }] }] }])(
    'returns empty lists rather than throwing for %o',
    body => expect(parseWebhookPayload(body)).toEqual({ messages: [], statuses: [] })
  )
})

describe('windowState', () => {
  it('is open inside 24 hours', () => {
    const state = windowState(NOW - 3600000, NOW)
    expect(state.open).toBe(true)
    expect(state.remainingMs).toBe(WINDOW_MS - 3600000)
  })

  // The boundary matters: one second past and Meta rejects free text.
  it('is closed exactly at the boundary', () => {
    expect(windowState(NOW - WINDOW_MS, NOW).open).toBe(false)
    expect(windowState(NOW - WINDOW_MS + 1000, NOW).open).toBe(true)
  })

  it('is closed when the client has never written', () => {
    expect(windowState(0, NOW)).toEqual({ open: false, remainingMs: 0, expiresAt: null })
  })
})

describe('formatWindow', () => {
  it.each([
    [0, 'Closed'],
    [-5000, 'Closed'],
    [90 * 60000, '1h 30m left'],
    [45 * 60000, '45m left'],
  ])('%i ms reads as %s', (ms, expected) => expect(formatWindow(ms)).toBe(expected))
})

describe('buildConversations', () => {
  const msg = over => ({ waId: '919825012345', direction: 'in', text: '', timestamp: NOW, ...over })

  it('groups by number, newest conversation first', () => {
    const convos = buildConversations([
      msg({ waId: '919000000001', timestamp: NOW - 60000, text: 'older' }),
      msg({ waId: '919000000002', timestamp: NOW, text: 'newer' }),
    ], NOW)
    expect(convos.map(c => c.waId)).toEqual(['919000000002', '919000000001'])
  })

  it('orders a thread oldest first, so it reads like a chat', () => {
    const convos = buildConversations([
      msg({ text: 'second', timestamp: NOW }),
      msg({ text: 'first', timestamp: NOW - 60000 }),
    ], NOW)
    expect(convos[0].messages.map(m => m.text)).toEqual(['first', 'second'])
  })

  // The window is driven by the client's messages only; our own replies do not
  // extend it, which is the single most common misunderstanding of this API.
  it('takes the window from inbound messages only', () => {
    const convos = buildConversations([
      msg({ direction: 'in', timestamp: NOW - WINDOW_MS - 60000 }),
      msg({ direction: 'out', timestamp: NOW }),
    ], NOW)
    expect(convos[0].window.open).toBe(false)
  })

  it('counts unread inbound messages and ignores our own', () => {
    const convos = buildConversations([
      msg({ direction: 'in', read: false }),
      msg({ direction: 'in', read: true }),
      msg({ direction: 'out' }),
    ], NOW)
    expect(convos[0].unread).toBe(1)
  })

  it('previews the most recent message either way', () => {
    const convos = buildConversations([
      msg({ text: 'client asked', timestamp: NOW - 60000 }),
      msg({ text: 'we replied', direction: 'out', timestamp: NOW }),
    ], NOW)
    expect(convos[0].preview).toBe('we replied')
  })

  it('drops rows with no number rather than making a blank thread', () => {
    expect(buildConversations([msg({ waId: '' })], NOW)).toEqual([])
  })
})

describe('matchConversationClient', () => {
  const clients = [{ id: 'c1', name: 'Mehul', mobile: '9825012345' }]

  // The book stores ten digits; WhatsApp reports full E.164.
  it('matches across the country code', () => {
    expect(matchConversationClient('919825012345', clients).id).toBe('c1')
  })

  it('returns null for an unknown or unusable number', () => {
    expect(matchConversationClient('919999999999', clients)).toBeNull()
    expect(matchConversationClient('123', clients)).toBeNull()
    expect(matchConversationClient('', clients)).toBeNull()
  })
})
