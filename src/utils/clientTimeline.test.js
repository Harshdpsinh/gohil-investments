import { describe, it, expect } from 'vitest'
import { buildClientTimeline } from './clientTimeline.js'

describe('buildClientTimeline', () => {
  const client = { id: 'c1', name: 'Mehta', mobile: '9876543210', createdAt: '2026-01-01' }

  it('orders newest first and keeps only this client', () => {
    const events = buildClientTimeline({
      client,
      policies: [
        { id: 'p1', clientId: 'c1', policyNumber: 'A', insurer: 'Star', createdAt: '2026-03-01' },
        { id: 'p2', clientId: 'other', policyNumber: 'B', createdAt: '2026-04-01' },
      ],
      claims: [
        { id: 'cl1', clientId: 'c1', status: 'Intimated', intimationDate: '2026-05-01' },
      ],
    })
    expect(events.map(e => e.id)).toEqual(['claim-cl1', 'policy-p1', 'client-created-c1'])
  })

  it('matches WhatsApp rows on the last ten mobile digits', () => {
    const events = buildClientTimeline({
      client,
      messages: [
        { id: 'm1', waId: '919876543210', direction: 'in', text: 'Hello', timestamp: Date.parse('2026-06-01') },
        { id: 'm2', waId: '911111111111', direction: 'in', text: 'Other', timestamp: Date.parse('2026-06-02') },
      ],
    })
    expect(events.some(e => e.id === 'wa-m1')).toBe(true)
    expect(events.some(e => e.id === 'wa-m2')).toBe(false)
  })

  it('labels a renewal when parentPolicyId is set', () => {
    const events = buildClientTimeline({
      client,
      policies: [{ id: 'p3', clientId: 'c1', parentPolicyId: 'p1', policyNumber: 'A-R', createdAt: '2026-07-01' }],
    })
    expect(events.find(e => e.id === 'policy-p3').title).toBe('Policy renewed')
  })

  it('drops events with no usable date', () => {
    const events = buildClientTimeline({
      client: { id: 'c1', name: 'X' },
      notes: [{ id: 'n1', body: 'undated' }],
    })
    expect(events).toEqual([])
  })
})
