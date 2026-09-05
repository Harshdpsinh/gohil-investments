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

/** Call after a successful boot so the next deploy can recover again. */
export function clearStaleChunkFlag() {
  try {
    window.sessionStorage.removeItem(STALE_CHUNK_KEY)
  } catch {
    /* private mode / no storage */
  }
}

export function currentPageScript() {
  if (typeof document === 'undefined') return ''
  return document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') || ''
}

export function livePageScriptFromHtml(html) {
  return String(html || '').match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1] || ''
}

/**
 * If this tab booted from an older index-*.js than the live site, reload
 * before a lazy PDF import 404s. Returns true if a reload was started.
 */
export async function reloadIfPageIsStale({ fetchHtml, reload } = {}) {
  const current = currentPageScript()
  if (!current) return false
  try {
    const html = await (fetchHtml || defaultFetchHtml)()
    const live = livePageScriptFromHtml(html)
    if (!live || live === current) return false
    return reloadOnceForStaleChunk(undefined, reload)
  } catch {
    return false
  }
}

function defaultFetchHtml() {
  return fetch(`/?gi-build=${Date.now()}`, { cache: 'no-store' }).then(r => r.text())
}

function defaultReload() {
  window.location.reload()
}
