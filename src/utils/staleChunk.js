// After a Vercel deploy the hashed /assets/*.js files change. A tab (or the
// phone WebView) still running the previous page then tries to lazy-load
// pdfStatement / charts / OCR from a URL that no longer exists. Vercel used to
// rewrite that 404 to index.html, and the browser reports:
//   Failed to fetch dynamically imported module
export const STALE_CHUNK_KEY = 'gi-stale-chunk-reload'

export function isStaleChunkError(err) {
  const msg = String(err?.message || err || '')
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg)
}

/** Reload at most once per tab. Returns true if a reload was started. */
export function reloadOnceForStaleChunk(err, reload = defaultReload) {
  if (err != null && !isStaleChunkError(err)) return false
  try {
    if (window.sessionStorage.getItem(STALE_CHUNK_KEY) === '1') return false
    window.sessionStorage.setItem(STALE_CHUNK_KEY, '1')
  } catch {
    return false
  }
  reload()
  return true
}

function defaultReload() {
  window.location.reload()
}
