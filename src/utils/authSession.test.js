// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH_SESSION_KEY, clearAuthSession, readAuthSession, writeAuthSession } from './authSession'

describe('authSession', () => {
  afterEach(() => window.localStorage.removeItem(AUTH_SESSION_KEY))

  it('returns null when empty or uid mismatches', () => {
    expect(readAuthSession('u1')).toBeNull()
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: 'admin' })
    expect(readAuthSession('u2')).toBeNull()
  })

  it('round-trips a matching staff session', () => {
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: 'staff' })
    expect(readAuthSession('u1')).toEqual({ uid: 'u1', email: 'a@b.c', role: 'staff' })
  })

  it('ignores writes without a role and clears the cache', () => {
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: '' })
    expect(readAuthSession('u1')).toBeNull()
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: 'admin' })
    clearAuthSession()
    expect(readAuthSession('u1')).toBeNull()
  })
})
