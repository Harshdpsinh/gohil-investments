import { describe, expect, it } from 'vitest'
import { providedWebhookSecret, webhookAuthorized } from './webhookAuth.js'

describe('webhook auth', () => {
  it('rejects when the server secret is missing', () => {
    expect(webhookAuthorized('anything', '')).toBe(false)
  })

  it('rejects a wrong secret and accepts the exact one', () => {
    expect(webhookAuthorized('nope', 'office-secret')).toBe(false)
    expect(webhookAuthorized('office-secret', 'office-secret')).toBe(true)
  })

  it('reads the query secret before the header', () => {
    expect(providedWebhookSecret('from-url', 'from-header')).toBe('from-url')
    expect(providedWebhookSecret('', 'from-header')).toBe('from-header')
  })
})
