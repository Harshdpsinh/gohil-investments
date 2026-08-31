import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOrLookupAuthUser,
  identityToolkitErrorCode,
  identityToolkitUserMessage,
} from './identityToolkitClient.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('identityToolkitErrorCode', () => {
  it('maps EMAIL_EXISTS and wrong-password codes', () => {
    expect(identityToolkitErrorCode('EMAIL_EXISTS')).toBe('EMAIL_EXISTS')
    expect(identityToolkitErrorCode('INVALID_LOGIN_CREDENTIALS')).toBe('INVALID_PASSWORD')
    expect(identityToolkitErrorCode('INVALID_PASSWORD')).toBe('INVALID_PASSWORD')
  })
})

describe('createOrLookupAuthUser', () => {
  it('creates a new login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ localId: 'new-uid' }),
    })))
    await expect(createOrLookupAuthUser({
      apiKey: 'k',
      email: 'reader@gmail.com',
      password: 'password1',
    })).resolves.toEqual({ uid: 'new-uid', created: true })
  })

  it('attaches an existing login instead of failing EMAIL_EXISTS', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'EMAIL_EXISTS' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ localId: 'old-uid' }),
      })
    vi.stubGlobal('fetch', fetchMock)
    await expect(createOrLookupAuthUser({
      apiKey: 'k',
      email: 'reader@gmail.com',
      password: 'password1',
    })).resolves.toEqual({ uid: 'old-uid', created: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('asks for the existing password when attaching', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'EMAIL_EXISTS' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    await expect(createOrLookupAuthUser({
      apiKey: 'k',
      email: 'reader@gmail.com',
      password: 'wrongpass',
    })).rejects.toThrow(identityToolkitUserMessage('INVALID_PASSWORD'))
  })
})
