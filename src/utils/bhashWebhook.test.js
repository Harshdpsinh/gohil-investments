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

  it('reads a flat customer reply and ignores a delivery receipt', () => {
    const reply = parseBhashWebhook({ from: '7698997894', body: 'Received', messageId: 'm1', name: 'Harsh' })
    expect(reply.messages[0]).toMatchObject({ waId: '917698997894', text: 'Received', profileName: 'Harsh', direction: 'in' })

    const receipt = parseBhashWebhook({ webhook_type: 'status_update', status: 'delivered', messageId: 'm1', mobile: '7698997894' })
    expect(receipt.messages).toEqual([])
    expect(receipt.statuses[0].status).toBe('delivered')
  })
})
