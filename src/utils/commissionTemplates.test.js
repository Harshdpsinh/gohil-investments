// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { headersMatchTemplate, loadCommissionTemplates, saveCommissionTemplate, templateFor } from './commissionTemplates'

describe('commissionTemplates', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('remembers an insurer column map', () => {
    saveCommissionTemplate('Star Health', { 'Policy No.': 'policyNumber', 'Total Comm': 'commissionAmount' })
    expect(templateFor('star health').headers['Policy No.']).toBe('policyNumber')
    expect(loadCommissionTemplates()['star health'].insurer).toBe('Star Health')
  })

  it('detects the same header set next time', () => {
    saveCommissionTemplate('Star', { 'Policy No.': 'policyNumber', Premium: 'premium' })
    expect(headersMatchTemplate({ 'Policy No.': '1', Premium: 10, Extra: 1 }, templateFor('Star'))).toBe(true)
    expect(headersMatchTemplate({ Premium: 10 }, templateFor('Star'))).toBe(false)
  })
})
