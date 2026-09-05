import { describe, it, expect } from 'vitest'
import { isTaggedClient, isTaggedPolicy, selectTaggedForCleanup } from './cleanup.js'

describe('E2E cleanup tagging', () => {
  it('recognises name prefix and isE2E flag on clients', () => {
    expect(isTaggedClient({ name: 'E2E_DO_NOT_USE_run1_Client' })).toBe(true)
    expect(isTaggedClient({ name: 'Real Client', isE2E: true })).toBe(true)
    expect(isTaggedClient({ name: 'Real Client' })).toBe(false)
  })

  it('recognises policy tags', () => {
    expect(isTaggedPolicy({ policyNumber: 'E2E_DO_NOT_USE_run1_P1' })).toBe(true)
    expect(isTaggedPolicy({ clientName: 'E2E_DO_NOT_USE_run1_Client' })).toBe(true)
    expect(isTaggedPolicy({ policyNumber: 'POL-123', clientName: 'Ada' })).toBe(false)
  })

  it('never selects untagged docs for cleanup', () => {
    const selected = selectTaggedForCleanup(
      [
        { id: '1', name: 'Ada' },
        { id: '2', name: 'E2E_DO_NOT_USE_run9_Client', notes: 'e2eRunId=run9' },
      ],
      { e2eRunId: 'run9' },
    )
    expect(selected.map((d) => d.id)).toEqual(['2'])
  })
})
