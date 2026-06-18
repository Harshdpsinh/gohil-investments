import { Capacitor, registerPlugin } from '@capacitor/core'

const NativeFilePicker = registerPlugin('FilePicker')

function base64ToFile(data, name, type) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], name || 'document.pdf', { type: type || 'application/pdf' })
}

export async function pickNativeDocument({ pdfOnly = false } = {}) {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const result = await NativeFilePicker.pickFiles({
      types: pdfOnly ? ['application/pdf'] : ['application/pdf', 'image/jpeg', 'image/png'],
      multiple: false,
      readData: true,
    })
    const picked = result?.files?.[0]
    if (!picked?.data) return null
    return base64ToFile(picked.data, picked.name, picked.mimeType)
  } catch {
    return null
  }
}
