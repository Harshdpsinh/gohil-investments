import { describe, expect, it } from 'vitest'
import { copyScrollLeft, maxScrollLeft, syncSpacerWidth } from './tableScroll'

function fakeScroller({ scrollWidth, clientWidth, scrollLeft = 0 }) {
  return { scrollWidth, clientWidth, scrollLeft }
}

describe('tableScroll', () => {
  it('reports how far a scroller can still travel', () => {
    expect(maxScrollLeft(fakeScroller({ scrollWidth: 4000, clientWidth: 1000 }))).toBe(3000)
    expect(maxScrollLeft(fakeScroller({ scrollWidth: 800, clientWidth: 1000 }))).toBe(0)
    expect(maxScrollLeft(null)).toBe(0)
  })

  it('maps the top bar all the way to the table end when widths differ', () => {
    const top = fakeScroller({ scrollWidth: 2200, clientWidth: 1000, scrollLeft: 1200 })
    const table = fakeScroller({ scrollWidth: 4000, clientWidth: 1000, scrollLeft: 0 })
    copyScrollLeft(top, table)
    expect(table.scrollLeft).toBe(3000)
  })

  it('sizes the dummy spacer to the real table, not a hardcoded min-width', () => {
    const spacer = { style: { width: '' } }
    syncSpacerWidth(spacer, fakeScroller({ scrollWidth: 3840, clientWidth: 1100 }))
    expect(spacer.style.width).toBe('3840px')
  })
})
