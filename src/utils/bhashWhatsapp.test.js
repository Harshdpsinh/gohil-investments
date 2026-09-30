import { describe, expect, it } from 'vitest'
import { templateParameters } from './whatsappCloud.js'
import {
  bhashRequestCode, bhashValues, buildBhashAuthBody, buildBhashSendBody, describeBhashError, parseBhashAuth,
} from './bhashWhatsapp.js'

describe('bhash WhatsApp', () => {
  it('authenticates with the api key and reads both tokens', () => {
    expect(buildBhashAuthBody(' secret ')).toEqual({ apiKey: 'secret' })
    expect(parseBhashAuth({
      success: true,
      content: { accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer' },
    })).toEqual({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer' })
    expect(parseBhashAuth({ success: false })).toBeNull()
  })

  it('sends one number and the five premium variables in order', () => {
    const values = bhashValues(templateParameters({
      clientName: 'Asha',
      insurer: 'TATA AIA',
      policyType: 'Life',
      policyNumber: 'P/1',
      dueDate: '15 Oct 2026',
      premium: '₹1,200',
    }))
    expect(values.map(item => item.variable)).toEqual(['1', '2', '3', '4', '5'])
    expect(values[1].value).toBe('TATA AIA Life')
    expect(buildBhashSendBody({
      businessCode: 'BSLB00258',
      templateCode: 'TEMPLATE001',
      mobile: '+91 76000 92858',
      values,
    })).toMatchObject({
      businessCode: 'BSLB00258',
      templateCode: 'TEMPLATE001',
      mobileNumbers: '917600092858',
    })
  })

  it('names a rejected token and keeps the request code', () => {
    expect(describeBhashError(401, { error_code: 'UNAUTHORIZED', message: 'Unauthorized' }))
      .toMatch(/BHASH_API_KEY/)
    expect(bhashRequestCode({ success: true, content: { requestCode: 'BSLB0025812' } })).toBe('BSLB0025812')
  })
})
