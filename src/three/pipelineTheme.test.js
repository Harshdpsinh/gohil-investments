import { describe, it, expect } from 'vitest'
import { layout, stageForDays, STAGES, STAGE_IDS, THEMES } from './pipelineTheme'

describe('stageForDays', () => {
  it.each([
    [-1, 'Overdue'],
    [-90, 'Overdue'],
    [0, 'Due Soon'],
    [7, 'Due Soon'],
    [8, 'Upcoming'],
    [30, 'Upcoming'],
    [31, 'Settled'],
    [null, 'Settled'],
    [undefined, 'Settled'],
  ])('maps %s days to %s', (days, expected) => {
    expect(stageForDays(days)).toBe(expected)
  })

  it('only ever returns a real stage id', () => {
    for (const days of [-5, 0, 3, 20, 400, null]) {
      expect(STAGE_IDS).toContain(stageForDays(days))
    }
  })
})

describe('layout', () => {
  const deal = (id, stage) => ({ id, stage })

  it('returns an empty list for no deals', () => {
    expect(layout()).toEqual([])
    expect(layout([])).toEqual([])
  })

  it('stacks deals in the same stage into descending rows', () => {
    const [a, b] = layout([deal('1', 'Overdue'), deal('2', 'Overdue')])
    expect(a.position[0]).toBe(b.position[0])   // same column
    expect(b.position[1]).toBeLessThan(a.position[1]) // second sits lower
  })

  it('puts different stages in different columns', () => {
    const [a, b] = layout([deal('1', 'Upcoming'), deal('2', 'Settled')])
    expect(a.position[0]).not.toBe(b.position[0])
  })

  it('orders columns left to right by STAGES', () => {
    const xs = STAGES.map(s => layout([deal('x', s.id)])[0].position[0])
    expect(xs).toEqual([...xs].sort((m, n) => m - n))
  })

  it('centres the board on x', () => {
    const xs = STAGES.map(s => layout([deal('x', s.id)])[0].position[0])
    expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0)
  })

  it('falls back to the first column for an unknown stage', () => {
    const [only] = layout([deal('1', 'Nonsense')])
    expect(only.position[0]).toBe(layout([deal('2', STAGES[0].id)])[0].position[0])
    expect(only.color).toBe(STAGES[0].color)
  })

  it('gives every card a finite xyz position', () => {
    for (const card of layout([deal('1', 'Overdue'), deal('2', 'Settled')])) {
      expect(card.position).toHaveLength(3)
      card.position.forEach(n => expect(Number.isFinite(n)).toBe(true))
    }
  })
})

describe('themes', () => {
  it.each(Object.keys(THEMES))('%s defines every key the canvas reads', name => {
    const t = THEMES[name]
    for (const key of ['bg', 'board', 'fog', 'text', 'sub', 'key', 'rim', 'ambient', 'glass']) {
      expect(t[key]).toBeDefined()
    }
    expect(t.fog).toHaveLength(3)
  })
})
