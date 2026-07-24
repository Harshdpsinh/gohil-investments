// src/utils/receiptOcr.js
// ─────────────────────────────────────────────────────────────
// In-browser OCR via tesseract.js — DYNAMIC IMPORT.
// This file adds ZERO to the initial bundle. The ~2MB tesseract
// chunk is loaded ONLY when the user uploads an image.
// ─────────────────────────────────────────────────────────────

/**
 * ocrImage(file: File) → Promise<string>
 * Extracts text from an image file (PNG, JPG, BMP, etc.)
 * Returns the recognized text, or empty string on failure.
 * Never throws — errors are caught and logged.
 */
export async function ocrImage(file) {
  try {
    // Dynamic import — separate webpack/vite chunk
    const Tesseract = await import('tesseract.js')
    const { data } = await Tesseract.default.recognize(file, 'eng', {
      logger: () => {},  // silence progress (UI can add its own later)
    })
    return data?.text || ''
  } catch (err) {
    console.error('ocrImage failed:', err.message)
    return ''
  }
}
