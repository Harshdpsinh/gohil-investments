// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH_SESSION_KEY, AUTH_SESSION_TTL_MS, clearAuthSession, readAuthSession, writeAuthSession } from './authSession'

describe('authSession', () => {
  afterEach(() => window.localStorage.removeItem(AUTH_SESSION_KEY))

  it('returns null when empty or uid mismatches', () => {
    expect(readAuthSession('u1')).toBeNull()
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: 'admin' })
    expect(readAuthSession('u2')).toBeNull()
  })

  it('round-trips a matching staff session', () => {
    const now = 1_700_000_000_000
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: 'staff' }, now)
    expect(readAuthSession('u1', now)).toEqual({ uid: 'u1', email: 'a@b.c', role: 'staff' })
  })

  it('ignores writes without a role and clears the cache', () => {
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: '' })
    expect(readAuthSession('u1')).toBeNull()
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: 'admin' })
    clearAuthSession()
    expect(readAuthSession('u1')).toBeNull()
  })

  it('expires a cached role after the TTL so a demotion is not sticky', () => {
    const now = 1_700_000_000_000
    writeAuthSession({ uid: 'u1', email: 'a@b.c', role: 'admin' }, now)
    expect(readAuthSession('u1', now + AUTH_SESSION_TTL_MS + 1)).toBeNull()
    expect(readAuthSession('u1', now + AUTH_SESSION_TTL_MS - 1)?.role).toBe('admin')
  })

  it('ignores a session written before cachedAt existed', () => {
    window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      uid: 'u1', email: 'a@b.c', role: 'admin',
    }))
    expect(readAuthSession('u1')).toBeNull()
  })
})
