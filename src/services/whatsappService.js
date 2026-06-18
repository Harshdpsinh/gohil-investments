import { Capacitor, registerPlugin } from '@capacitor/core'

const DEFAULT_COUNTRY_CODE = '91'
const NativeLauncher = registerPlugin('AppLauncher')
const NativeBrowser = registerPlugin('Browser')

async function launchWhatsAppNative(phone, message, fallbackUrl) {
  const nativeUrl = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(message || '')}`
  try {
    const result = await NativeLauncher.canOpenUrl({ url: nativeUrl })
    if (result?.value) {
      await NativeLauncher.openUrl({ url: nativeUrl })
      return
    }
    await NativeBrowser.open({ url: fallbackUrl })
  } catch {
    window.location.href = fallbackUrl
  }
}

export function normaliseWhatsAppNumber(value, countryCode = DEFAULT_COUNTRY_CODE) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) throw new Error('No mobile number found for this client.')

  const cleanCountry = String(countryCode || DEFAULT_COUNTRY_CODE).replace(/\D/g, '') || DEFAULT_COUNTRY_CODE
  let national = digits

  if (digits.startsWith(cleanCountry) && digits.length > 10) {
    national = digits.slice(cleanCountry.length)
  } else if (digits.startsWith('0') && digits.length === 11) {
    national = digits.slice(1)
  }

  if (national.length !== 10 || !/^[6-9]\d{9}$/.test(national)) {
    throw new Error('Enter a valid 10 digit Indian mobile number before sending WhatsApp.')
  }

  return `${cleanCountry}${national}`
}

export function buildWhatsAppLink({ mobile, message, countryCode = DEFAULT_COUNTRY_CODE }) {
  const phone = normaliseWhatsAppNumber(mobile, countryCode)
  return `https://wa.me/${phone}?text=${encodeURIComponent(message || '')}`
}

export function buildWhatsAppApiLink({ mobile, message, countryCode = DEFAULT_COUNTRY_CODE }) {
  const phone = normaliseWhatsAppNumber(mobile, countryCode)
  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message || '')}`
}

export function openWhatsAppLink({ mobile, message, countryCode = DEFAULT_COUNTRY_CODE }) {
  const url = buildWhatsAppLink({ mobile, message, countryCode })
  if (Capacitor.isNativePlatform()) {
    const phone = normaliseWhatsAppNumber(mobile, countryCode)
    launchWhatsAppNative(phone, message, url)
    return url
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  return url
}

export function openWhatsAppApiLink({ mobile, message, countryCode = DEFAULT_COUNTRY_CODE }) {
  const url = buildWhatsAppApiLink({ mobile, message, countryCode })
  if (Capacitor.isNativePlatform()) {
    const phone = normaliseWhatsAppNumber(mobile, countryCode)
    launchWhatsAppNative(phone, message, url)
    return url
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  return url
}
