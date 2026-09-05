// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  STALE_CHUNK_KEY,
  clearStaleChunkFlag,
  currentPageScript,
  isStaleChunkError,
  livePageScriptFromHtml,
  reloadIfPageIsStale,
  reloadOnceForStaleChunk,
} from './staleChunk'

describe('staleChunk', () => {
  afterEach(() => window.sessionStorage.removeItem(STALE_CHUNK_KEY))

  it('recognises the Vite / browser messages for a missing hashed file', () => {
    expect(isStaleChunkError(new Error(
      'Failed to fetch dynamically imported module: https://gohil-investments.vercel.app/assets/pdfStatement-CPnIujO0.js',
    ))).toBe(true)
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new Error('No usable rows found.'))).toBe(false)
  })

  it('reloads once per tab and ignores a second miss', () => {
    const reload = vi.fn()
    const err = new Error('Failed to fetch dynamically imported module: /assets/x.js')
    expect(reloadOnceForStaleChunk(err, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reloadOnceForStaleChunk(err, reload)).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload for a real parse error', () => {
    const reload = vi.fn()
    expect(reloadOnceForStaleChunk(new Error('No usable rows found.'), reload)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('re-arms after a successful boot clears the flag', () => {
    const reload = vi.fn()
    const err = new Error('Failed to fetch dynamically imported module: /assets/x.js')
    expect(reloadOnceForStaleChunk(err, reload)).toBe(true)
    clearStaleChunkFlag()
    expect(reloadOnceForStaleChunk(err, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('reads the hashed index script out of a live HTML page', () => {
    const html = `<script type="module" crossorigin src="/assets/index-B_8B0XEx.js"></script>`
    expect(livePageScriptFromHtml(html)).toBe('/assets/index-B_8B0XEx.js')
    expect(livePageScriptFromHtml('<div>no script</div>')).toBe('')
  })

  it('reads the script this tab actually booted from', () => {
    const el = document.createElement('script')
    el.type = 'module'
    el.src = '/assets/index-OldHash.js'
    document.head.appendChild(el)
    expect(currentPageScript()).toBe('/assets/index-OldHash.js')
    el.remove()
  })

  it('reloads when the live page points at a newer index hash', async () => {
    const el = document.createElement('script')
    el.type = 'module'
    el.src = '/assets/index-OldHash.js'
    document.head.appendChild(el)
    const reload = vi.fn()
    const fetchHtml = vi.fn(async () => (
      `<script type="module" src="/assets/index-NewHash.js"></script>`
    ))
    expect(await reloadIfPageIsStale({ fetchHtml, reload })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    el.remove()
  })

  it('does not reload when this tab already has the live page', async () => {
    const el = document.createElement('script')
    el.type = 'module'
    el.src = '/assets/index-B_8B0XEx.js'
    document.head.appendChild(el)
    const reload = vi.fn()
    const fetchHtml = vi.fn(async () => (
      `<script type="module" src="/assets/index-B_8B0XEx.js"></script>`
    ))
    expect(await reloadIfPageIsStale({ fetchHtml, reload })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    el.remove()
  })

  it('does not reload when the live page cannot be fetched', async () => {
    const el = document.createElement('script')
    el.type = 'module'
    el.src = '/assets/index-OldHash.js'
    document.head.appendChild(el)
    const reload = vi.fn()
    expect(await reloadIfPageIsStale({
      fetchHtml: async () => { throw new Error('offline') },
      reload,
    })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    el.remove()
  })
})
