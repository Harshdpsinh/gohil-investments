// src/utils/ocrLines.js
// Turns one Tesseract page result into the line/cell shape the rest of the app
// already speaks — the same thing pdfStatement.extractLines produces from a
// text layer. Kept apart from pdfOcr.js, which owns tesseract and pdfjs, so the
// coordinate maths is testable without either.
//
// Pure — no imports at all.

/**
 * Two conversions matter here.
 *
 * Canvas y grows downward from the top; PDF y grows upward from the bottom, and
 * the extractor sorts lines by descending y expecting "higher on the page" to
 * mean "larger y". Flipping is what stops a scan being read bottom-up.
 *
 * Everything is also divided by the render scale, so x comes back in PDF points
 * — the extractor's column-proximity check is a fixed 60-point window, and at
 * 2x render every column would look twice as far apart as it is.
 */
/**
 * Tesseract v7 nests text as blocks → paragraphs → lines → words, and returns
 * nothing positional at all unless `blocks: true` is asked for. Older shapes
 * exposed `data.lines` directly, so both are accepted.
 */
function ocrLinesOf(data = {}) {
  if (Array.isArray(data.lines) && data.lines.length) return data.lines
  return (data.blocks || []).flatMap(block =>
    (block.paragraphs || []).flatMap(paragraph => paragraph.lines || [])
  )
}

export function linesFromOcrPage(data = {}, canvasHeight = 0, scale = 1) {
  const safeScale = Number(scale) || 1
  const ocrLines = ocrLinesOf(data)

  if (ocrLines.length) {
    return ocrLines
      .map(line => ({
        y: (canvasHeight - (line.bbox?.y0 ?? 0)) / safeScale,
        cells: (line.words || [])
          .map(word => ({ x: (word.bbox?.x0 ?? 0) / safeScale, text: String(word.text ?? '').trim() }))
          .filter(cell => cell.text)
          .sort((a, b) => a.x - b.x),
      }))
      .filter(line => line.cells.length)
      .sort((a, b) => b.y - a.y)
  }

  // Older or trimmed Tesseract output gives only the flat text. Positions are
  // then unknown, so synthesise a descending y and leave x at the margin: label
  // matching still works, only the stacked-value lookup degrades.
  return String(data.text ?? '')
    .split('\n')
    .map(text => text.trim())
    .filter(Boolean)
    .map((text, index) => ({ y: 1000 - index * 12, cells: [{ x: 0, text }] }))
}
