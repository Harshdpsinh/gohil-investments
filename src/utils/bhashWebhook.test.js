import { describe, expect, it } from 'vitest'
import { parseBhashWebhook } from './bhashWebhook.js'

describe('parseBhashWebhook', () => {
  it('reads a Meta-shaped incoming message', () => {
    const { messages } = parseBhashWebhook({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { messages: [{ from: '917698997894', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: 'Hi' } }] } }] }],
    })
    expect(messages[0]).toMatchObject({ waId: '917698997894', direction: 'in', text: 'Hi' })
  })

  it('reads a nested reply and ignores the office number', () => {
    const { messages } = parseBhashWebhook({
      contact: { name: 'Harshdeepsinh Gohil', mobile: '917698997894' },
      message: { text: 'Kevi rite bharu?' },
      businessNumber: '917600928585',
    })
    expect(messages[0]).toMatchObject({ waId: '917698997894', text: 'Kevi rite bharu?', direction: 'in' })
  })

  it('keeps a customer link instead of dropping it', () => {
    const { messages } = parseBhashWebhook({
      from: '919727592455',
      url: 'https://youtu.be/9jQOUAy2Azc',
    })
    expect(messages[0]).toMatchObject({ waId: '919727592455', direction: 'in' })
    expect(messages[0].text).toContain('youtu.be')
  })

  it('ignores a delivery receipt', () => {
    const receipt = parseBhashWebhook({ webhook_type: 'status_update', status: 'delivered', messageId: 'm1', mobile: '7698997894' })
    expect(receipt.messages).toEqual([])
    expect(receipt.statuses[0].status).toBe('delivered')
  })
})
