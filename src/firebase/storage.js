// src/firebase/storage.js
// PDF FIX: Use /raw/ endpoint for PDFs — stores file exactly as-is.
// Images use /image/ endpoint. Both are publicly accessible.
import { addDocMeta, addDocumentRecord, deleteDocMeta, getDocMeta } from './firestore'
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage'
import app, { auth, firebaseConfig } from './config'
import { downloadNativeDocument, isNativeAndroid, openNativeDocument } from '../services/nativeDocumentService'

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
    const publicId = `${Date.now()}_${baseName}`
    const fd = new FormData()
    fd.append('file',          file)
    fd.append('upload_preset', PRESET)
    fd.append('folder',        folder)
    fd.append('public_id',     publicId)

    const xhr = new XMLHttpRequest()
    // PDFs are uploaded through auto/upload so Cloudinary chooses a browser-safe
    // delivery URL. raw/upload caused Chrome's PDF viewer to reject some files.
    const endpoint  = 'auto/upload'
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD}/${endpoint}`, true)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded/e.total)*100)) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText)
        resolve({
          url: data.secure_url,
          publicId: data.public_id,
          deleteToken: data.delete_token || '',
          resourceType: data.resource_type || (isPdfFile ? 'image' : 'image'),
          name: file.name,
          size: file.size,
          type: file.type,
          format: data.format || '',
        })
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
  if (CLOUD && PRESET) {
    try {
      onProgress(0)
      const meta = await cloudinaryUpload(file, cloudinaryFolder, onProgress)
      return {
        ...meta,
        storageProvider: 'cloudinary',
        storagePath: '',
        storageBucket: '',
      }
    } catch (cloudinaryErr) {
      console.warn('Cloudinary upload failed, trying Firebase Storage fallback:', cloudinaryErr?.message || cloudinaryErr)
    }
  }

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
  const safe = String(url)
    .replace('/raw/upload/fl_attachment/', '/raw/upload/')
    .replace('/image/upload/fl_attachment/', '/image/upload/')
    .replace(/\/raw\/upload\/fl_attachment:[^/]+\//, '/raw/upload/')
    .replace(/\/image\/upload\/fl_attachment:[^/]+\//, '/image/upload/')
  return safe
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
  if (safeUrl.includes('res.cloudinary.com') && safeUrl.includes('/raw/upload/')) {
    return safeUrl
  }
  if (safeUrl.includes('res.cloudinary.com') && safeUrl.includes('/image/upload/')) {
    return safeUrl
  }
  const separator = safeUrl.includes('?') ? '&' : '?'
  return `${safeUrl}${separator}dl=${encodeURIComponent(safeFileName)}`
}

async function resolveDocumentUrl(urlOrPath) {
  const input = String(urlOrPath || '').trim()
  if (!input) throw new Error('No document URL found.')
  if (input.startsWith('gs://')) {
    const storageRef = ref(getStorage(app), input)
    return getDownloadURL(storageRef)
  }
  if (input.startsWith('http')) return getViewUrl(input)
  const bucket = STORAGE_BUCKETS[0]
  const storageRef = ref(storageForBucket(bucket), input)
  return getDownloadURL(storageRef)
}

function clickDocumentAnchor(url, { fileName = '', download = false } = {}) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  if (download) {
    anchor.download = fileName || 'document.pdf'
  } else {
    anchor.target = '_blank'
  }
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

async function fetchDocumentBlob(url) {
  const safeUrl = await resolveDocumentUrl(url)
  if (!safeUrl) throw new Error('No document URL found.')
  const response = await fetch(safeUrl, { mode: 'cors' })
  if (!response.ok) throw new Error('Could not read the uploaded document.')
  return response.blob()
}

// ✅ FIXED: resolves gs:// / storage paths to fresh HTTPS URLs and avoids popup-blocked window.open.
export async function openDocumentPreview(urlOrPath, fileName = 'document.pdf') {
  try {
    const finalUrl = await resolveDocumentUrl(urlOrPath)
    if (!finalUrl || !finalUrl.startsWith('http')) {
      throw new Error('Invalid document URL. The file may have been deleted or the link has expired.')
    }

    if (isNativeAndroid()) {
      await openNativeDocument(finalUrl)
      return
    }

    const isPdf = /\.pdf(\?|#|$)/i.test(finalUrl) || /\.pdf$/i.test(String(fileName || ''))
    if (isPdf) {
      try {
        const blob = await fetchDocumentBlob(finalUrl)
        const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
        const blobUrl = URL.createObjectURL(pdfBlob)
        clickDocumentAnchor(blobUrl)
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
        return
      } catch {
        // Fall through to direct HTTPS preview when CORS blocks blob reading.
      }
    }

    clickDocumentAnchor(finalUrl)
  } catch (err) {
    console.error('openDocumentPreview error:', err)
    throw new Error(
      err?.code === 'storage/object-not-found'
        ? 'File not found in storage. It may have been deleted.'
        : err?.code === 'storage/unauthorized'
          ? 'You do not have permission to view this file. Check Firebase Storage rules.'
          : err?.message || 'Could not open document. Please try again.'
    )
  }
}

// ✅ FIXED: resolves fresh URLs, forces browser download with Blob, and falls back to a safe direct URL.
export async function downloadDocumentFile(urlOrPath, fileName = 'document.pdf') {
  const safeFileName = String(fileName || 'document.pdf')
    .replace(/[^\w.\-() ]+/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'document.pdf'
  try {
    const finalUrl = await resolveDocumentUrl(urlOrPath)
    if (!finalUrl || !finalUrl.startsWith('http')) {
      throw new Error('Invalid document URL. The file may have been deleted.')
    }
    if (isNativeAndroid()) {
      await downloadNativeDocument(getDownloadUrl(finalUrl, safeFileName))
      return
    }
    const blob = await fetchDocumentBlob(finalUrl)
    const blobUrl = URL.createObjectURL(blob)
    clickDocumentAnchor(blobUrl, { fileName: safeFileName, download: true })
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  } catch (err) {
    const directUrl = getDownloadUrl(await resolveDocumentUrl(urlOrPath).catch(() => urlOrPath), safeFileName)
    if (directUrl) {
      clickDocumentAnchor(directUrl, { fileName: safeFileName, download: true })
      return
    }
    console.error('downloadDocumentFile error:', err)
    throw new Error(
      err?.code === 'storage/object-not-found'
        ? 'File not found in storage. It may have been deleted.'
        : err?.code === 'storage/unauthorized'
          ? 'You do not have permission to download this file.'
          : err?.message || 'Download failed. Please try again.'
    )
  }
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

export async function uploadPolicyPdf(policyId, file, onProgress = () => {}, documentYear = '') {
  validatePolicyPdf(file)
  const safeName = file.name.replace(/[^\w.\-() ]+/g, '').trim().replace(/\s+/g, '_') || 'policy.pdf'
  const year = String(documentYear || new Date().getFullYear()).replace(/[^\d]/g, '').slice(0, 4) || String(new Date().getFullYear())
  const meta = await uploadWithFreeFallback(
    file,
    `policies/${policyId}/${year}/${Date.now()}_${safeName}`,
    `gohil_investments/policies/${policyId}/${year}`,
    onProgress
  )
  return {
    url: meta.url,
    name: meta.name,
    documentYear: year,
    storagePath: meta.storagePath,
    storageBucket: meta.storageBucket,
    storageProvider: meta.storageProvider || 'firebase',
    publicId: meta.publicId || '',
    resourceType: meta.resourceType || '',
    deleteToken: meta.deleteToken || '',
  }
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

async function deleteCloudinaryByToken(deleteToken) {
  if (!deleteToken) return false
  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/delete_by_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: deleteToken }),
  })
  return response.ok
}

async function deleteCloudinaryByPublicId(publicId, resourceType = 'image') {
  if (!publicId) return false
  const user = auth.currentUser
  if (!user) throw new Error('Sign in again to delete files.')
  const response = await fetch('/api/cloudinary-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ publicId, resourceType }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Could not delete old Cloudinary PDF.')
  }
  return true
}

export async function deletePolicyPdfAsset(asset = {}) {
  if (asset.storageProvider === 'cloudinary' || asset.publicId || asset.deleteToken) {
    if (await deleteCloudinaryByToken(asset.deleteToken)) return
    if (asset.publicId) {
      await deleteCloudinaryByPublicId(asset.publicId, asset.resourceType || 'image')
    }
    return
  }
  await deleteStorageObjectByPath(asset.storagePath, asset.storageBucket)
}

export const deletePolicyPdfByPath = deleteStorageObjectByPath
