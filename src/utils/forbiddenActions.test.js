import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_ACTIONS,
  attemptPayload,
  isForbiddenClickLabel,
  isPermissionDenied,
} from './forbiddenActions'

describe('FORBIDDEN_ACTIONS', () => {
  it('names the live-data writes the reader must not complete', () => {
    const ids = FORBIDDEN_ACTIONS.map(item => item.id)
    expect(ids).toContain('client-write')
    expect(ids).toContain('policy-write')
    expect(ids).toContain('commission-settle')
    expect(ids).toContain('insurer-rewrite')
    expect(ids).toContain('whatsapp-send')
    expect(ids).toContain('backup-restore')
    expect(ids).toContain('ship-to-main')
  })
})

describe('isForbiddenClickLabel', () => {
  it('flags write controls and ignores plain navigation', () => {
    expect(isForbiddenClickLabel('Save client')).toBe(true)
    expect(isForbiddenClickLabel('Merge 12 records now')).toBe(true)
    expect(isForbiddenClickLabel('Mark 40 existing policies as paid')).toBe(true)
    expect(isForbiddenClickLabel('Clients')).toBe(false)
    expect(isForbiddenClickLabel('Sign Out')).toBe(false)
  })
})

describe('isPermissionDenied', () => {
  it('recognises Firestore and Storage denials', () => {
    expect(isPermissionDenied({ code: 'permission-denied' })).toBe(true)
    expect(isPermissionDenied({ code: 'storage/unauthorized' })).toBe(true)
    expect(isPermissionDenied({ message: 'Missing or insufficient permissions.' })).toBe(true)
    expect(isPermissionDenied({ code: 'unavailable' })).toBe(false)
  })
})

describe('attemptPayload', () => {
  it('keeps the row small enough for rules', () => {
    const row = attemptPayload({
      op: 'update',
      path: 'clients/abc',
      outcome: 'denied',
      message: 'x'.repeat(500),
      email: 'reader@gmail.com',
      source: 'click',
    })
    expect(row.message).toHaveLength(300)
    expect(row.email).toBe('reader@gmail.com')
  })
})
