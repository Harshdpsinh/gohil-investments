// src/utils/pdfExtract.js
// ─────────────────────────────────────────────────────────────
// PDF text extraction via pdfjs-dist — DYNAMIC IMPORT.
// Zero impact on initial bundle. Loaded only when user uploads a PDF.
// ─────────────────────────────────────────────────────────────

/**
 * extractPdfText(file: File) → Promise<string>
 * Extracts all text from a PDF file.
 * Returns concatenated text from all pages, or empty string on failure.
 * Never throws — errors are caught and logged.
 */
export async function extractPdfText(file) {
  try {
    // Dynamic import — separate vite chunk
    const pdfjsLib = await import('pdfjs-dist')

    // Vite needs the worker entry point; pdfjs-dist bundles it for ESM.
    // Setting workerSrc to empty disables the separate worker thread
    // and runs parsing on the main thread (acceptable for small receipts).
    // For production, you'd set this to the CDN worker URL:
    //   pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`
    pdfjsLib.GlobalWorkerOptions.workerSrc = ''

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const strings = content.items.map(item => item.str)
      pages.push(strings.join(' '))
    }

    return pages.join('\n')
  } catch (err) {
    console.error('extractPdfText failed:', err.message)
    return ''
  }
}
