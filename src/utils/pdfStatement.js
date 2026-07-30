// src/utils/pdfStatement.js
// Turns an insurer PDF statement into commission rows. This file owns only the
// pdfjs side — getting text off the page with its coordinates. The layout
// profiles live in ./pdfProfiles, which is pure and therefore testable.
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { parseStatementLines } from './pdfProfiles'

// CSP blocks a CDN worker, so it must be bundled locally.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** Every page as an array of visual lines: { y, cells: [{x, text}] }. */
export async function extractLines(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    const byY = new Map()
    for (const item of content.items) {
      if (!item.str.trim()) continue
      const y = Math.round(item.transform[5])
      if (!byY.has(y)) byY.set(y, [])
      byY.get(y).push({ x: item.transform[4], text: item.str.trim() })
    }
    const lines = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, cells]) => ({ y, cells: cells.sort((a, b) => a.x - b.x) }))
    pages.push(lines)
  }
  return pages
}

/**
 * Returns { rows, format }. rows === [] means the PDF holds no policy-level
 * detail — several insurers publish totals only, which is not a parse failure.
 */
export async function parsePdfStatement(arrayBuffer) {
  return parseStatementLines(await extractLines(arrayBuffer))
}
