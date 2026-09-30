// Payload shaping for the Bhash SMS WhatsApp API. Pure — no network.
// Auth: POST /auth/v1/appAuthenticate { apiKey } → accessToken (10 min).
// Send: POST /customer/api/v1/campaign/sendMessage with Bearer accessToken.
// One mobile per call: mobileNumbers is capped at 15 characters.

export const BHASH_AUTH_URL = 'https://apiv2.bhashsms.com/auth/v1/appAuthenticate'
export const BHASH_SEND_URL = 'https://apiv2.bhashsms.com/customer/api/v1/campaign/sendMessage'
export const BHASH_TEMPLATES_URL = 'https://apiv2.bhashsms.com/customer/api/v1/template/getAllApiTemplates'

export function buildBhashAuthBody(apiKey) {
  return { apiKey: String(apiKey || '').trim() }
}

export function parseBhashAuth(body) {
  const accessToken = body?.content?.accessToken || ''
  const refreshToken = body?.content?.refreshToken || ''
  if (!body?.success || !accessToken) return null
  return { accessToken, refreshToken, tokenType: body.content.tokenType || 'Bearer' }
}

/**
 * `parameters` are the Cloud API body params already flattened to one line.
 * Bhash wants { variable: "1", value } in the same order.
 */
export function bhashValues(parameters = []) {
  return parameters.map((item, index) => ({
    variable: String(index + 1),
    value: String(item?.text ?? item?.value ?? '').trim() || '-',
  }))
}

export function buildBhashSendBody({ businessCode, templateCode, mobile, values = [] }) {
  const to = String(mobile || '').replace(/\D/g, '')
  return {
    businessCode: String(businessCode || '').trim(),
    templateCode: String(templateCode || '').trim(),
    mobileNumbers: to,
    values,
  }
}

export function bhashRequestCode(body) {
  return body?.content?.requestCode || ''
}

export function describeBhashError(status, body) {
  const detail = body?.message || body?.error_code || `HTTP ${status}`
  if (status === 401 || body?.error_code === 'UNAUTHORIZED') {
    return `Bhash rejected the token (${detail}). Check BHASH_API_KEY.`
  }
  if (status === 422) return `Bhash refused the message (${detail}). Check the template code and the variables.`
  return `Bhash WhatsApp ${status}: ${detail}`
}
