// src/firebase/storage.js
// PDF FIX: Use /raw/ endpoint for PDFs — stores file exactly as-is.
// Images use /image/ endpoint. Both are publicly accessible.
import { addDocMeta, deleteDocMeta } from './firestore'
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage'
import app from './config'

const CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_POLICY_PDF_BYTES = 25 * 1024 * 1024
const ALLOWED_CLIENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const firebaseStorage = getStorage(app)

function validateClientDocument(file) {
  if (!file) throw new Error('No file selected.')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('File must be smaller than 10 MB.')
  const name = file.name.toLowerCase()
  const hasAllowedExtension = /\.(pdf|jpe?g|png|webp)$/.test(name)
  if (!ALLOWED_CLIENT_TYPES.includes(file.type) || !hasAllowedExtension) {
    throw new Error('Only PDF, JPG, PNG, or WEBP files are allowed.')
  }
}

function validatePolicyPdf(file) {
  if (!file) throw new Error('No file selected.')
  if (file.size > MAX_POLICY_PDF_BYTES) {
    throw new Error('Policy PDF is too large. Please upload a PDF smaller than 25 MB.')
  }
  const isPdf = file.type === 'application/pdf' && file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) throw new Error('Only PDF files are allowed.')
}

function cloudinaryUpload(file, folder, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    if (!CLOUD || !PRESET) {
      reject(new Error('Cloudinary not configured.')); return
    }
    const safeName = file.name.replace(/\s+/g, '_')
    const isPdfFile = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const baseName = safeName.replace(/\.[^/.]+$/, '')
    const publicId = isPdfFile
      ? `${Date.now()}_${baseName}.pdf`
      : `${Date.now()}_${baseName}`
    const fd = new FormData()
    fd.append('file',          file)
    fd.append('upload_preset', PRESET)
    fd.append('folder',        folder)
    fd.append('public_id',     publicId)

    const xhr = new XMLHttpRequest()
    // PDFs: use /raw/upload to preserve the file byte-for-byte (no re-encoding).
    // All other file types (images, etc.): use /auto/upload.
    // Note: unsigned presets support both /raw/ and /auto/.
    const endpoint  = isPdfFile ? 'raw/upload' : 'auto/upload'
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD}/${endpoint}`, true)
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

function firebaseUpload(file, path, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const storageRef = ref(firebaseStorage, path)
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'application/pdf',
      customMetadata: { originalName: file.name },
    })

    task.on(
      'state_changed',
      snapshot => {
        const total = snapshot.totalBytes || file.size || 1
        onProgress(Math.round((snapshot.bytesTransferred / total) * 100))
      },
      error => reject(error),
      async snapshot => {
        try {
          const url = await getDownloadURL(snapshot.ref)
          resolve({ url, name: file.name, size: file.size, type: file.type, storagePath: snapshot.ref.fullPath })
        } catch (err) {
          reject(err)
        }
      }
    )
  })
}

export function getViewUrl(url) {
  if (!url) return ''
  return String(url)
    .replace('/raw/upload/fl_attachment/', '/raw/upload/')
    .replace(/\/raw\/upload\/fl_attachment:[^/]+\//, '/raw/upload/')
}

export function getPreviewUrl(url) {
  const safeUrl = getViewUrl(url)
  if (!safeUrl) return ''
  return safeUrl
}

export function getDownloadUrl(url, fileName = '') {
  const safeUrl = getViewUrl(url)
  if (!safeUrl) return ''
  const safeFileName = String(fileName || 'document.pdf')
    .replace(/[^\w.\-() ]+/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'document.pdf'
  const separator = safeUrl.includes('?') ? '&' : '?'
  return `${safeUrl}${separator}dl=${encodeURIComponent(safeFileName)}`
}

export async function uploadClientDocument(clientId, file, onProgress = () => {}) {
  validateClientDocument(file)
  const meta  = await cloudinaryUpload(file, `gohil_investments/clients/${clientId}`, onProgress)
  await addDocMeta(clientId, meta)
  return meta
}

export async function deleteClientDocument(clientId, docId) {
  await deleteDocMeta(clientId, docId)
}

export async function uploadPolicyPdf(policyId, file, onProgress = () => {}) {
  validatePolicyPdf(file)
  const safeName = file.name.replace(/[^\w.\-() ]+/g, '').trim().replace(/\s+/g, '_') || 'policy.pdf'
  try {
    const meta = await firebaseUpload(file, `policies/${policyId}/${Date.now()}_${safeName}`, onProgress)
    return { url: meta.url, name: meta.name, storagePath: meta.storagePath }
  } catch (err) {
    console.error('Firebase Storage upload failed:', err)
    throw new Error('Policy PDF upload failed. Please confirm Firebase Storage is enabled and storage rules are deployed.')
  }
}

export async function deletePolicyPdfByPath(storagePath) {
  if (!storagePath) return
  try {
    await deleteObject(ref(firebaseStorage, storagePath))
  } catch (err) {
    if (err?.code === 'storage/object-not-found') return
    throw new Error('Could not delete policy PDF from storage. Please try again.')
  }
}
