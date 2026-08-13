import { describe, it, expect } from 'vitest'
import { linesFromOcrPage } from './ocrLines'

// Tesseract reports canvas coordinates: y grows DOWNWARD from the top edge.
// The extractor expects PDF coordinates: y grows upward, lines sorted by
// descending y. A page rendered at 2x is 1600 tall for an 800-point page.
const word = (x0, y0, text) => ({ bbox: { x0, y0 }, text })
const ocrLine = (y0, words) => ({ bbox: { y0 }, words })

const PAGE = {
  lines: [
    ocrLine(100, [word(80, 100, 'Policy'), word(200, 100, 'No:'), word(260, 100, 'ABC/123')]),
    ocrLine(200, [word(80, 200, 'Insured'), word(200, 200, 'Name:'), word(300, 200, 'MEHUL')]),
    ocrLine(300, [word(80, 300, 'Total'), word(200, 300, 'Premium:'), word(340, 300, '24,500')]),
  ],
}

// What tesseract.js v7 actually returns: blocks → paragraphs → lines → words.
// There is no top-level data.lines, and none of it appears at all unless
// `blocks: true` is passed to recognize().
const V7_PAGE = {
  blocks: [
    { paragraphs: [{ lines: [PAGE.lines[0], PAGE.lines[1]] }] },
    { paragraphs: [{ lines: [PAGE.lines[2]] }] },
  ],
}

describe('linesFromOcrPage — tesseract v7 block nesting', () => {
  const lines = linesFromOcrPage(V7_PAGE, 1600, 2)

  it('flattens blocks and paragraphs down to lines', () => {
    expect(lines).toHaveLength(3)
    expect(lines[0].cells.map(c => c.text).join(' ')).toBe('Policy No: ABC/123')
    expect(lines[2].cells.map(c => c.text).join(' ')).toBe('Total Premium: 24,500')
  })

  it('applies the same coordinate flip through the nesting', () => {
    expect(lines[0].y).toBe(750)
    expect(lines[0].cells.map(c => c.x)).toEqual([40, 100, 130])
  })

  it.each([
    ['no blocks key', {}],
    ['empty blocks', { blocks: [] }],
    ['block with no paragraphs', { blocks: [{}] }],
    ['paragraph with no lines', { blocks: [{ paragraphs: [{}] }] }],
  ])('returns nothing rather than throwing for %s', (_label, input) => {
    expect(linesFromOcrPage(input, 1600, 2)).toEqual([])
  })
})

describe('linesFromOcrPage', () => {
  const lines = linesFromOcrPage(PAGE, 1600, 2)

  // Without the flip a scan reads bottom-up and every stacked value lands on
  // the wrong label.
  it('puts the topmost line first', () => {
    expect(lines[0].cells.map(c => c.text).join(' ')).toBe('Policy No: ABC/123')
    expect(lines[2].cells.map(c => c.text).join(' ')).toBe('Total Premium: 24,500')
  })

  it('flips canvas y into PDF y', () => {
    // Top line sits 100 canvas px down on a 1600px canvas at 2x → 750 points up.
    expect(lines[0].y).toBe(750)
    expect(lines[1].y).toBe(700)
  })

  // The extractor's column-proximity window is a fixed 60 points. At 2x every
  // column would appear twice as far apart as it really is.
  it('divides x by the render scale', () => {
    expect(lines[0].cells.map(c => c.x)).toEqual([40, 100, 130])
  })

  it('sorts words left to right even when reported out of order', () => {
    const jumbled = { lines: [ocrLine(100, [word(300, 100, 'third'), word(80, 100, 'first'), word(200, 100, 'second')])] }
    expect(linesFromOcrPage(jumbled, 1600, 2)[0].cells.map(c => c.text)).toEqual(['first', 'second', 'third'])
  })

  it('drops empty words and the lines left empty by them', () => {
    const noisy = {
      lines: [
        ocrLine(100, [word(80, 100, '  '), word(200, 100, '')]),
        ocrLine(200, [word(80, 200, 'Real')]),
      ],
    }
    const out = linesFromOcrPage(noisy, 1600, 2)
    expect(out).toHaveLength(1)
    expect(out[0].cells[0].text).toBe('Real')
  })

  it('falls back to flat text when no positions are reported', () => {
    const out = linesFromOcrPage({ text: 'Policy No: X1\n\n  Premium: 500  ' }, 1600, 2)
    expect(out.map(l => l.cells[0].text)).toEqual(['Policy No: X1', 'Premium: 500'])
    // Still descending, so the extractor reads it in the right order.
    expect(out[0].y).toBeGreaterThan(out[1].y)
  })

  it.each([{}, { lines: [] }, { text: '' }, { text: '   \n  ' }])(
    'returns nothing rather than throwing for %o',
    input => expect(linesFromOcrPage(input, 1600, 2)).toEqual([])
  )

  it('treats a missing or zero scale as 1 instead of dividing by zero', () => {
    const out = linesFromOcrPage(PAGE, 800, 0)
    expect(Number.isFinite(out[0].y)).toBe(true)
    expect(out[0].cells[0].x).toBe(80)
  })
})
