// src/firebase/storage.js
// PDF FIX: Use /raw/ endpoint for PDFs — stores file exactly as-is.
// Images use /image/ endpoint. Both are publicly accessible.
import { addDocMeta, deleteDocMeta } from './firestore'

const CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

function cloudinaryUpload(file, folder, onProgress = () => {}, resourceType = 'image') {
  return new Promise((resolve, reject) => {
    if (!CLOUD || !PRESET) {
      reject(new Error('Cloudinary not configured.')); return
    }
    const safeName = file.name.replace(/\s+/g, '_')
    const baseName = safeName.replace(/\.[^/.]+$/, '')
    const fd = new FormData()
    fd.append('file',          file)
    fd.append('upload_preset', PRESET)
    fd.append('folder',        folder)
    fd.append('public_id',     `${Date.now()}_${baseName}`)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD}/${resourceType}/upload`, true)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded/e.total)*100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText)
        resolve({ url: data.secure_url, publicId: data.public_id, name: file.name, size: file.size, type: file.type, format: data.format || '' })
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).error?.message || `Upload failed (${xhr.status})`)) }
        catch { reject(new Error(`Upload failed with status ${xhr.status}`)) }
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(fd)
  })
}

export async function uploadClientDocument(clientId, file, onProgress = () => {}) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  const meta  = await cloudinaryUpload(file, `gohil_investments/clients/${clientId}`, onProgress, isPdf ? 'raw' : 'image')
  await addDocMeta(clientId, meta)
  return meta
}

export async function deleteClientDocument(clientId, docId) {
  await deleteDocMeta(clientId, docId)
}

export async function uploadPolicyPdf(policyId, file, onProgress = () => {}) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) throw new Error('Only PDF files are allowed.')
  const meta = await cloudinaryUpload(file, `gohil_investments/policies/${policyId}`, onProgress, 'raw')
  return { url: meta.url, name: meta.name }
}
