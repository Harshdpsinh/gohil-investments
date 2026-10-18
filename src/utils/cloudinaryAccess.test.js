import { describe, expect, it } from 'vitest'
import { cloudinaryFailureShouldFallback, formatAllowed, planUpload, signCloudinaryParams, signedDeliveryUrl } from './cloudinaryAccess.js'

describe('cloudinary access', () => {
  it('rejects a folder outside the office prefix and a disallowed type', () => {
    expect(planUpload({ folder: 'other/place', filename: 'a.pdf', contentType: 'application/pdf', bytes: 10 }).error).toMatch(/folder/i)
    expect(planUpload({ folder: 'gohil_investments/policies/1', filename: 'a.exe', contentType: 'application/pdf', bytes: 10 }).error).toMatch(/PDF/i)
  })

  it('plans a pdf upload inside the office folder', () => {
    const plan = planUpload({
      folder: 'gohil_investments/policies/abc',
      filename: 'My Policy.pdf',
      contentType: 'application/pdf',
      bytes: 1200,
      now: 100,
    })
    expect(plan.publicId).toBe('gohil_investments/policies/abc/100_My_Policy')
    expect(plan.format).toBe('pdf')
  })

  it('signs parameters in alphabetical order', () => {
    const signature = signCloudinaryParams({ type: 'authenticated', timestamp: 10, public_id: 'gohil_investments/a' }, 'sek')
    expect(signature).toHaveLength(40)
    expect(signature).toBe(signCloudinaryParams({ public_id: 'gohil_investments/a', timestamp: 10, type: 'authenticated' }, 'sek'))
  })

  it('builds a signed authenticated url and hides the secret', () => {
    const url = signedDeliveryUrl({
      cloudName: 'demo',
      publicId: 'gohil_investments/policies/a',
      resourceType: 'image',
      format: 'pdf',
      version: 5,
      apiSecret: 'sek',
    })
    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/demo\/image\/authenticated\/s--[A-Za-z0-9_-]{8}--\/v5\/gohil_investments\/policies\/a\.pdf$/)
    expect(url).not.toContain('sek')
    expect(formatAllowed('pdf')).toBe(true)
    expect(formatAllowed('exe')).toBe(false)
  })

  it('does not hide a rejected upload behind Firebase', () => {
    expect(cloudinaryFailureShouldFallback(400)).toBe(false)
    expect(cloudinaryFailureShouldFallback(401)).toBe(false)
    expect(cloudinaryFailureShouldFallback(429)).toBe(false)
    expect(cloudinaryFailureShouldFallback(500)).toBe(true)
    expect(cloudinaryFailureShouldFallback(undefined)).toBe(true)
  })
})
