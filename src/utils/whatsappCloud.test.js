import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TEMPLATE_PARAMS,
  UTILITY_PREMIUM_TEMPLATE,
  buildTemplatePayload,
  describeGraphError,
  graphMessagesUrl,
  messageIdFrom,
  parseTemplateOrder,
  renderUtilityPremiumNotice,
  templateParameters,
  toE164,
} from './whatsappCloud'

describe('toE164', () => {
  it('adds the country code to a bare ten-digit mobile', () => {
    expect(toE164('9033419367')).toBe('919033419367')
  })

  it.each([
    ['+91 90334 19367', '919033419367'],
    ['09033419367', '919033419367'],
    ['0091-9033419367', '919033419367'],
    ['919033419367', '919033419367'],
  ])('normalises %s', (input, expected) => {
    expect(toE164(input)).toBe(expected)
  })

  it('honours a different default country code', () => {
    expect(toE164('2025550147', '1')).toBe('12025550147')
  })

  it.each([null, undefined, '', '   ', 'not a number', '12345'])(
    'returns empty for unusable input %s',
    value => expect(toE164(value)).toBe('')
  )
})

describe('utility premium template', () => {
  it('is a factual account notice Meta can approve as Utility', () => {
    const { header, body, footer, params, examples } = UTILITY_PREMIUM_TEMPLATE
    expect(header.length).toBeLessThanOrEqual(60)
    expect(footer.length).toBeLessThanOrEqual(60)
    expect(params).toEqual(DEFAULT_TEMPLATE_PARAMS)
    expect(examples).toHaveLength(params.length)
    expect(body.startsWith('{{')).toBe(false)
    expect(body.endsWith('}}')).toBe(false)
    params.forEach((_, index) => {
      expect(body).toContain(`{{${index + 1}}}`)
    })
    expect(body).not.toMatch(/renew|offer|discount|urgent|limited time|shop now/i)
    expect(header + footer).not.toMatch(/\{\{/)
  })

  it('fills the notice the reminder log shows', () => {
    const text = renderUtilityPremiumNotice({
      clientName: 'Asha Shah',
      policyType: 'Health',
      policyNumber: 'P/1',
      dueDate: '15 Oct 2026',
      premium: '₹12,450',
    })
    expect(text).toBe(
      'Premium due notice\n\n'
      + 'Hello Asha Shah, this is an account update for your existing Health policy P/1. '
      + 'The due date on file is 15 Oct 2026 and the premium amount is ₹12,450. '
      + 'This notice is for your records.\n\n'
      + 'Gohil Investments, Bhavnagar',
    )
  })
})

describe('templateParameters', () => {
  const detail = {
    clientName: 'Jatin Babubhai Beladiya',
    policyType: 'Motor',
    policyNumber: '3001/0/354380063/00/000',
    dueDate: '16 Aug 2026',
    premium: '₹21,200',
  }

  it('emits one text parameter per token, in order', () => {
    expect(templateParameters(detail)).toEqual([
      { type: 'text', text: 'Jatin Babubhai Beladiya' },
      { type: 'text', text: 'Motor' },
      { type: 'text', text: '3001/0/354380063/00/000' },
      { type: 'text', text: '16 Aug 2026' },
      { type: 'text', text: '₹21,200' },
    ])
  })

  // Meta rejects the whole send if any body parameter holds a newline, a tab or
  // four-plus consecutive spaces.
  it('flattens whitespace that Meta would reject', () => {
    const [param] = templateParameters({ clientName: 'Line one\nLine\ttwo    spaced' }, ['clientName'])
    expect(param.text).toBe('Line one Line two spaced')
  })

  it('substitutes a placeholder for a missing or blank value', () => {
    expect(templateParameters({ planName: '   ' }, ['planName', 'insurer'])).toEqual([
      { type: 'text', text: '-' },
      { type: 'text', text: '-' },
    ])
  })
})

describe('parseTemplateOrder', () => {
  it('splits and trims a configured order', () => {
    expect(parseTemplateOrder(' clientName , dueDate ')).toEqual(['clientName', 'dueDate'])
  })

  it.each([null, '', '  ', ', ,'])('falls back to the default order for %s', value => {
    expect(parseTemplateOrder(value)).toEqual(DEFAULT_TEMPLATE_PARAMS)
  })
})

describe('buildTemplatePayload', () => {
  it('builds the Graph body for a template with variables', () => {
    const payload = buildTemplatePayload({
      to: '919033419367',
      templateName: 'renewal_reminder',
      languageCode: 'en',
      parameters: templateParameters({ clientName: 'Asha' }, ['clientName']),
    })
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919033419367',
      type: 'template',
      template: {
        name: 'renewal_reminder',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }] }],
      },
    })
  })

  // An empty components array is itself a 400 from Meta.
  it('omits components entirely when the template takes no variables', () => {
    const payload = buildTemplatePayload({ to: '919033419367', templateName: 'hello' })
    expect(payload.template.components).toBeUndefined()
    expect(payload.template.language).toEqual({ code: 'en' })
  })
})

describe('graphMessagesUrl', () => {
  it('pins the configured API version', () => {
    expect(graphMessagesUrl({ phoneNumberId: '123', apiVersion: 'v23.0' }))
      .toBe('https://graph.facebook.com/v23.0/123/messages')
  })
})

describe('describeGraphError', () => {
  it('names an expired or wrong token', () => {
    expect(describeGraphError(401, { error: { code: 190, message: 'Session expired' } }))
      .toMatch(/Regenerate WHATSAPP_TOKEN/)
  })

  it('names a template problem', () => {
    expect(describeGraphError(400, { error: { code: 132001, message: 'Template name does not exist' } }))
      .toMatch(/Template not usable/)
  })

  it('prefers the user-facing message when Meta supplies one', () => {
    expect(describeGraphError(400, { error: { message: 'raw', error_user_msg: 'Recipient not opted in' } }))
      .toBe('WhatsApp Cloud API 400: Recipient not opted in')
  })

  it('survives a body that is not the shape Meta documents', () => {
    expect(describeGraphError(500, null)).toBe('WhatsApp Cloud API 500: HTTP 500')
  })
})

describe('messageIdFrom', () => {
  it('reads the id Meta returns', () => {
    expect(messageIdFrom({ messages: [{ id: 'wamid.ABC' }] })).toBe('wamid.ABC')
  })

  it.each([null, {}, { messages: [] }])('returns empty for %s', value => {
    expect(messageIdFrom(value)).toBe('')
  })
})
