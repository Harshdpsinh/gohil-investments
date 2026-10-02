import { describe, expect, it } from 'vitest'
import { canClaimReminder } from './reminderClaim'

describe('canClaimReminder', () => {
  const now = 1_000_000

  it('claims when nothing was sent yet', () => {
    expect(canClaimReminder(undefined, 0, now)).toBe(true)
    expect(canClaimReminder('failed', now - 1000, now)).toBe(true)
  })

  it('does not repeat a message that already went', () => {
    expect(canClaimReminder('sent', now, now)).toBe(false)
  })

  it('waits while another send is still in progress', () => {
    expect(canClaimReminder('sending', now - 60_000, now)).toBe(false)
    expect(canClaimReminder('sending', now - 11 * 60 * 1000, now)).toBe(true)
  })
})
