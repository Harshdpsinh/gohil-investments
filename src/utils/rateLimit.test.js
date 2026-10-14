import { describe, expect, it } from 'vitest'
import { takeToken } from './rateLimit.js'

describe('takeToken', () => {
  it('allows up to the limit and then blocks inside the window', () => {
    const store = new Map()
    const opts = { limit: 2, windowMs: 1000, now: 5000 }
    expect(takeToken(store, 'a', opts).ok).toBe(true)
    expect(takeToken(store, 'a', opts).ok).toBe(true)
    expect(takeToken(store, 'a', opts).ok).toBe(false)
  })

  it('lets a new window through after the old hits expire', () => {
    const store = new Map()
    takeToken(store, 'a', { limit: 1, windowMs: 1000, now: 1000 })
    expect(takeToken(store, 'a', { limit: 1, windowMs: 1000, now: 2500 }).ok).toBe(true)
  })
})
