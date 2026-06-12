// src/firebase/storage.js
// PDF FIX: Use /raw/ endpoint for PDFs — stores file exactly as-is.
// Images use /image/ endpoint. Both are publicly accessible.
import { addDocMeta, addDocumentRecord, deleteDocMeta, getDocMeta } from './firestore'
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage'
import app, { firebaseConfig } from './config'

const CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_POLICY_PDF_BYTES = 25 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 30000
const ALLOWED_CLIENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const ALLOWED_SHARED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
const projectId = firebaseConfig.projectId
const configuredBucket = firebaseConfig.storageBucket
const STORAGE_BUCKETS = [...new Set([
  configuredBucket,
  projectId ? `${projectId}.firebasestorage.app` : '',
  projectId ? `${projectId}.appspot.com` : '',
].filter(Boolean).map(bucket => String(bucket).replace(/^gs:\/\//, '')))]

function storageForBucket(bucket) {
  return getStorage(app, `gs://${bucket}`)
}

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

function validateSharedDocument(file) {
  if (!file) throw new Error('No file selected.')
  if (file.size > MAX_POLICY_PDF_BYTES) {
    throw new Error('File is too large. Please upload a file smaller than 25 MB.')
  }
  const name = file.name.toLowerCase()
  const allowedExtension = /\.(pdf|jpe?g|png|webp|csv|xlsx?|xls)$/.test(name)
  if (!ALLOWED_SHARED_TYPES.includes(file.type) || !allowedExtension) {
    throw new Error('Only PDF, image, CSV, or Excel files are allowed.')
  }
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

function firebaseUpload(file, path, bucket, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storageForBucket(bucket), path)
    let settled = false
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'application/pdf',
      customMetadata: { originalName: file.name },
    })
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      try { task.cancel() } catch {}
      const err = new Error('Upload is taking too long. Please check internet connection and try a smaller PDF.')
      err.code = 'storage/timeout'
      finish(reject, err)
    }, UPLOAD_TIMEOUT_MS)

    task.on(
      'state_changed',
      snapshot => {
        const total = snapshot.totalBytes || file.size || 1
        onProgress(Math.round((snapshot.bytesTransferred / total) * 100))
      },
      error => finish(reject, error),
      async snapshot => {
        try {
          const url = await getDownloadURL(snapshot.ref)
          finish(resolve, { url, name: file.name, size: file.size, type: file.type, storagePath: snapshot.ref.fullPath, storageBucket: bucket })
        } catch (err) {
          finish(reject, err)
        }
      }
    )
  })
}

async function firebaseUploadWithFallback(file, path, onProgress = () => {}) {
  const errors = []
  for (const bucket of STORAGE_BUCKETS) {
    try {
      onProgress(0)
      return await firebaseUpload(file, path, bucket, onProgress)
    } catch (err) {
      errors.push(`${bucket}: ${err?.code || err?.message || 'failed'}`)
      if (err?.code === 'storage/quota-exceeded') throw err
    }
  }
  const err = new Error(`Upload failed for all Firebase Storage buckets. Tried: ${errors.join('; ')}`)
  err.code = errors.some(e => e.includes('storage/unauthorized')) ? 'storage/unauthorized' : 'storage/all-buckets-failed'
  throw err
}

async function uploadWithFreeFallback(file, firebasePath, cloudinaryFolder, onProgress = () => {}) {
  try {
    return await firebaseUploadWithFallback(file, firebasePath, onProgress)
  } catch (firebaseErr) {
    if (!CLOUD || !PRESET) throw firebaseErr
    onProgress(0)
    const meta = await cloudinaryUpload(file, cloudinaryFolder, onProgress)
    return {
      ...meta,
      storageProvider: 'cloudinary',
      storagePath: '',
      storageBucket: '',
      firebaseError: firebaseErr?.code || firebaseErr?.message || '',
    }
  }
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
  if (safeUrl.includes('res.cloudinary.com') && safeUrl.includes('/raw/upload/')) {
    return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(safeUrl)}`
  }
  return safeUrl
}

export function getDownloadUrl(url, fileName = '') {
  const safeUrl = getViewUrl(url)
  if (!safeUrl) return ''
  const safeFileName = String(fileName || 'document.pdf')
    .replace(/[^\w.\-() ]+/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'document.pdf'
  if (safeUrl.includes('res.cloudinary.com') && safeUrl.includes('/raw/upload/')) {
    const encodedName = encodeURIComponent(safeFileName).replace(/%20/g, '_')
    return safeUrl.replace('/raw/upload/', `/raw/upload/fl_attachment:${encodedName}/`)
  }
  const separator = safeUrl.includes('?') ? '&' : '?'
  return `${safeUrl}${separator}dl=${encodeURIComponent(safeFileName)}`
}

export async function uploadClientDocument(clientId, file, onProgress = () => {}) {
  validateClientDocument(file)
  const safeName = file.name.replace(/[^\w.\-() ]+/g, '').trim().replace(/\s+/g, '_') || 'client_document'
  const meta = await uploadWithFreeFallback(
    file,
    `clients/${clientId}/${Date.now()}_${safeName}`,
    `gohil_investments/clients/${clientId}`,
    onProgress
  )
  await addDocMeta(clientId, meta)
  return meta
}

export async function deleteClientDocument(clientId, docId) {
  const docs = await getDocMeta(clientId)
  const meta = docs.find(d => d.id === docId)
  if (meta?.storagePath) await deleteStorageObjectByPath(meta.storagePath, meta.storageBucket)
  await deleteDocMeta(clientId, docId)
}

export async function uploadPolicyPdf(policyId, file, onProgress = () => {}) {
  validatePolicyPdf(file)
  const safeName = file.name.replace(/[^\w.\-() ]+/g, '').trim().replace(/\s+/g, '_') || 'policy.pdf'
  const meta = await uploadWithFreeFallback(
    file,
    `policies/${policyId}/${Date.now()}_${safeName}`,
    `gohil_investments/policies/${policyId}`,
    onProgress
  )
  return { url: meta.url, name: meta.name, storagePath: meta.storagePath, storageBucket: meta.storageBucket, storageProvider: meta.storageProvider || 'firebase', publicId: meta.publicId || '' }
}

export async function uploadSharedDocument(ownerType, ownerId, file, onProgress = () => {}) {
  validateSharedDocument(file)
  if (!ownerType || !ownerId) throw new Error('Document owner is required.')
  const safeName = file.name.replace(/[^\w.\-() ]+/g, '').trim().replace(/\s+/g, '_') || 'document'
  const meta = await uploadWithFreeFallback(
    file,
    `documents/${ownerType}/${ownerId}/${Date.now()}_${safeName}`,
    `gohil_investments/documents/${ownerType}/${ownerId}`,
    onProgress
  )
  await addDocumentRecord({
    ownerType,
    ownerId,
    documentType: ownerType,
    name: meta.name,
    url: meta.url,
    storagePath: meta.storagePath,
    storageProvider: meta.storageProvider || 'firebase',
    publicId: meta.publicId || '',
    contentType: meta.type,
    size: meta.size,
  })
  return meta
}

export async function deleteStorageObjectByPath(storagePath, storageBucket = '') {
  if (!storagePath) return
  try {
    const bucket = storageBucket || STORAGE_BUCKETS[0]
    await deleteObject(ref(storageForBucket(bucket), storagePath))
  } catch (err) {
    if (err?.code === 'storage/object-not-found') return
    throw new Error('Could not delete file from storage. Please try again.')
  }
}

export const deletePolicyPdfByPath = deleteStorageObjectByPath
