// src/firebase/storage.js  (Cloudinary — free, no credit card)
import { addDocMeta, deleteDocMeta } from './firestore'

const CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

function cloudinaryUpload(file, folder, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    if (!CLOUD || !PRESET) {
      reject(new Error('Cloudinary not configured. Add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to your .env file.'))
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    fd.append('upload_preset', PRESET)
    fd.append('folder', folder)
    fd.append('public_id', `${Date.now()}_${file.name.replace(/\s/g, '_')}`)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD}/auto/upload`, true)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded/e.total)*100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText)
        resolve({ url: data.secure_url, publicId: data.public_id, name: file.name, size: file.size, type: file.type, format: data.format })
      } else {
        const err = JSON.parse(xhr.responseText)
        reject(new Error(err.error?.message || 'Upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(fd)
  })
}

export async function uploadClientDocument(clientId, file, onProgress = () => {}) {
  const meta = await cloudinaryUpload(file, `gohil_investments/clients/${clientId}`, onProgress)
  await addDocMeta(clientId, meta)
  return meta
}
export async function deleteClientDocument(clientId, docId) {
  await deleteDocMeta(clientId, docId)
}

// Upload a policy PDF — returns { url, name }
// Caller must call savePolicyPdfUrl(policyId, url, name) to persist it.
export async function uploadPolicyPdf(policyId, file, onProgress = () => {}) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only PDF files are allowed for policy documents.')
  }
  const meta = await cloudinaryUpload(file, `gohil_investments/policies/${policyId}`, onProgress)
  return { url: meta.url, name: meta.name }
}
