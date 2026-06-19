import { Capacitor } from '@capacitor/core'

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not prepare the report for sharing.'))
    reader.readAsDataURL(blob)
  })
}

export async function shareGeneratedFile(blob, fileName, title = 'Gohil Investments report') {
  if (!Capacitor.isNativePlatform()) return false
  try {
    if (window.GohilNative?.shareBase64) {
      window.GohilNative.shareBase64(await blobToBase64(blob), blob.type || 'application/octet-stream', fileName)
      return true
    }
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' })
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title, files: [file] })
      return true
    }
  } catch (error) {
    console.warn('Native sharing failed; using browser download:', error)
  }
  return false
}
