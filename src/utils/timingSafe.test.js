import { describe, expect, it } from 'vitest'
import { bearerMatches, timingSafeEqualString } from './timingSafe'

describe('timingSafeEqualString', () => {
  it('matches identical strings and rejects a one-character miss', () => {
    expect(timingSafeEqualString('Bearer secret', 'Bearer secret')).toBe(true)
    expect(timingSafeEqualString('Bearer secret', 'Bearer secreX')).toBe(false)
    expect(timingSafeEqualString('short', 'longer-value')).toBe(false)
  })
})

describe('bearerMatches', () => {
  it('accepts the exact Authorization header and rejects a missing secret', () => {
    expect(bearerMatches('Bearer cron-secret', 'cron-secret')).toBe(true)
    expect(bearerMatches('Bearer cron-secret', 'other')).toBe(false)
    expect(bearerMatches('Bearer cron-secret', '')).toBe(false)
    expect(bearerMatches(undefined, 'cron-secret')).toBe(false)
  })
})
