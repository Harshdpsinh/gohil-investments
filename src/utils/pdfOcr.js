// src/utils/pdfOcr.js
// Reads a scanned policy schedule — one with no text layer — by rendering each
// page to a canvas and running OCR over it.
//
// Tesseract.js is WebAssembly running in this browser: no API, no key, no
// per-file charge, and the document never leaves the device. The price is a
// ~10MB one-time download of the engine and language data, and a few seconds of
// local CPU per page, which is why it is dynamically imported and only ever
// invoked after the text layer has come back empty.
//
// Output is deliberately the exact shape pdfStatement.extractLines returns, so
// policyPdfExtract works on a scan without knowing where the text came from.
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { linesFromOcrPage } from './ocrLines'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// Tesseract reads small print badly at natural size; 2x is the usual accuracy
// sweet spot before render time starts to hurt on a phone.
const RENDER_SCALE = 2

/**
 * A scan of a schedule puts everything worth reading on the first page or two.
 * Capping it keeps a 40-page policy wording from taking ten minutes.
 */
export async function ocrPdfToLines(arrayBuffer, { maxPages = 2, onProgress = () => {} } = {}) {
  const { createWorker } = await import('tesseract.js')
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const pageCount = Math.min(doc.numPages, maxPages)

  onProgress({ stage: 'starting', page: 0, pages: pageCount })
  const worker = await createWorker('eng')

  try {
    const pages = []
    for (let n = 1; n <= pageCount; n++) {
      onProgress({ stage: 'reading', page: n, pages: pageCount })
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

      // `blocks` is off by default in tesseract.js v7 — without it the result
      // carries only flat text, and every word's position is lost. Positions
      // are what let the extractor read a two-column schedule.
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
      pages.push(linesFromOcrPage(data, canvas.height, RENDER_SCALE))
      // Canvases at 2x are large; drop it before rendering the next page.
      canvas.width = 0
      canvas.height = 0
    }
    return pages
  } finally {
    await worker.terminate()
  }
}

/** True when the PDF has no text layer at all — the only time OCR is worth it. */
export function hasNoTextLayer(pages = []) {
  return pages.every(page => page.every(line => line.cells.every(cell => !cell.text.trim())))
}
