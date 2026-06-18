import { Capacitor, registerPlugin } from '@capacitor/core'

const NativeBrowser = registerPlugin('Browser')

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function openNativeDocument(url) {
  if (!isNativeAndroid()) return false
  try {
    await NativeBrowser.open({ url, toolbarColor: '#0f172a' })
    return true
  } catch {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return true
  }
}

export async function downloadNativeDocument(url) {
  // Android WebView ignores blob download attributes. Opening the original
  // HTTPS asset lets Chrome or the installed PDF viewer save/share it safely.
  return openNativeDocument(url)
}
