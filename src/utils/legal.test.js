import { describe, it, expect } from 'vitest'
import {
  BUSINESS,
  MARKETING_OPT_OUT_LINE,
  isMarketingAllowed,
  blocksGoogleFontCdn,
  blocksSessionReplay,
  phoneTel,
} from './legal.js'

describe('legal identity', () => {
  it('has a physical city and a named DMCA agent', () => {
    expect(BUSINESS.city).toMatch(/Bhavnagar/)
    expect(BUSINESS.dmcaAgent).toMatch(/Gohil/)
    expect(BUSINESS.email).toContain('@')
    expect(phoneTel(BUSINESS.phones[0])).toBe('tel:+917698997894')
    expect(phoneTel('not a number')).toBe('')
    expect(MARKETING_OPT_OUT_LINE).toMatch(/STOP/)
    expect(MARKETING_OPT_OUT_LINE).toMatch(/Bhavnagar/)
  })

  it('treats missing opt-out as allowed so existing clients keep wishes', () => {
    expect(isMarketingAllowed({})).toBe(true)
    expect(isMarketingAllowed({ marketingOptOut: false })).toBe(true)
    expect(isMarketingAllowed({ marketingOptOut: true })).toBe(false)
  })
})

describe('cdn guards', () => {
  it('rejects Google Fonts CDN and session replay hosts', () => {
    expect(blocksGoogleFontCdn('https://fonts.googleapis.com/css2?family=Inter')).toBe(false)
    expect(blocksGoogleFontCdn('@fontsource/inter/latin-400.css')).toBe(true)
    expect(blocksSessionReplay('https://cdn.hotjar.com/c.js')).toBe(false)
    expect(blocksSessionReplay("import '@fontsource/inter/latin-400.css'")).toBe(true)
  })
})
