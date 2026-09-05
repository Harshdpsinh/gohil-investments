// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STALE_CHUNK_KEY, isStaleChunkError, reloadOnceForStaleChunk } from './staleChunk'

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
})
