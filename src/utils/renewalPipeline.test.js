import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { groupRenewalPipeline, pipelineColumnId, PIPELINE_COLUMNS } from './renewalPipeline.js'

const TODAY = new Date(2026, 6, 27, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('pipelineColumnId', () => {
  it('maps day windows onto the five columns', () => {
    expect(pipelineColumnId(45)).toBe('60')
    expect(pipelineColumnId(20)).toBe('30')
    expect(pipelineColumnId(10)).toBe('15')
    expect(pipelineColumnId(0)).toBe('7')
    expect(pipelineColumnId(-3)).toBe('overdue')
    expect(pipelineColumnId(90)).toBe(null)
  })
})

describe('groupRenewalPipeline', () => {
  it('places an expiring health policy and ignores cancelled ones', () => {
    const buckets = groupRenewalPipeline([
      { id: 'h1', policyType: 'Health', expiryDate: '2026-08-10', status: 'Active' },
      { id: 'h2', policyType: 'Health', expiryDate: '2026-08-10', status: 'Cancelled' },
    ])
    expect(PIPELINE_COLUMNS.every(c => Array.isArray(buckets[c.id]))).toBe(true)
    expect(buckets['15'].map(r => r.policy.id)).toEqual(['h1'])
    expect(buckets['30']).toEqual([])
  })
})
