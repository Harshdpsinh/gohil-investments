// src/components/policies/PolicyPdfUpload.jsx
// Extracted verbatim from PoliciesPage. Used by the policy form and by both
// policy detail views, so it lives on its own rather than inside either.
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { savePolicyPdfUrl } from '../../firebase/firestore'
import { isLifePolicyType } from '../../utils/policyImport'
import { deletePolicyPdfAsset, downloadDocumentFile, openDocumentPreview, uploadPolicyPdf } from '../../firebase/storage'
import { isAutoWaOnPdfEnabled, policyCopyMessage } from '../../utils/opsSnapshot'
import { openWhatsAppLink } from '../../services/whatsappService'

// ── Policy PDF Upload ─────────────────────────────────────────
function PolicyPdfUpload({
  policyId,
  policyType = '',
  documentYear = '',
  existingUrl,
  existingName,
  existingStoragePath = '',
  existingStorageBucket = '',
  existingStorageProvider = '',
  existingPublicId = '',
  existingResourceType = '',
  existingDeleteToken = '',
  onUploaded = () => {},
  compact = false,
  clientMobile = '',
  clientName = '',
  policyNumber = '',
  insurer = '',
  premium = '',
}) {
  const fileRef = useRef()
  const [progress, setProgress]   = useState(null)
  const [uploading, setUploading] = useState(false)
  const canDeleteOldPdf = !isLifePolicyType(policyType)

  const maybeOpenWhatsApp = url => {
    if (!isAutoWaOnPdfEnabled()) return
    const mobile = String(clientMobile || '').replace(/\D/g, '')
    if (!mobile) {
      toast.error('PDF saved. WhatsApp skipped — no mobile number on this client.')
      return
    }
    try {
      openWhatsAppLink({
        mobile: clientMobile,
        message: policyCopyMessage({
          clientName,
          policyType,
          policyNumber,
          insurer,
          premium,
        }, url),
      })
    } catch (err) {
      toast.error(err.message || 'PDF saved, but WhatsApp did not open.')
    }
  }

  const onFileChange = async e => {
    const file = e.target.files[0]
    if (!file) return
    if (!policyId) {
      toast.error('First save the policy, then use Upload PDF from the policy row or edit screen.')
      return
    }

    setUploading(true)
    setProgress(0)
    try {
      const uploaded = await uploadPolicyPdf(policyId, file, p => setProgress(p), documentYear)
      if (existingUrl && canDeleteOldPdf) {
        try {
          await deletePolicyPdfAsset({
            storagePath: existingStoragePath,
            storageBucket: existingStorageBucket,
            storageProvider: existingStorageProvider,
            publicId: existingPublicId,
            resourceType: existingResourceType,
            deleteToken: existingDeleteToken,
          })
        } catch (deleteErr) {
          toast.error(`New PDF uploaded, but old PDF was not deleted: ${deleteErr.message}`)
        }
      }
      await savePolicyPdfUrl(policyId, uploaded.url, uploaded.name, uploaded.storagePath, uploaded.storageBucket, uploaded)
      toast.success(existingUrl && canDeleteOldPdf ? 'PDF replaced and old file deleted' : 'PDF uploaded')
      onUploaded(uploaded.url, uploaded.name, uploaded)
      maybeOpenWhatsApp(uploaded.url)
    } catch(err) {
      const message = err?.code === 'storage/unauthorized'
        ? 'PDF upload blocked by Firebase Storage rules. Deploy storage.rules, then try again.'
        : err?.code === 'storage/quota-exceeded'
          ? 'Firebase Storage quota is full. Free space or upgrade the plan.'
          : err?.code === 'storage/timeout'
            ? 'PDF upload is taking too long. Check internet, try a smaller PDF, or upload from a newer browser.'
            : err?.code === 'storage/canceled'
              ? 'PDF upload was cancelled because it took too long. Please try again.'
              : err?.message || 'PDF upload failed. Please try again.'
      toast.error(message)
    } finally {
      setUploading(false)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!policyId) return (
    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-3 text-xs text-gray-400 text-center">
      Save policy first, then attach PDF from the policy row.
    </div>
  )

  if (compact) {
    return (
      <div className="flex items-center justify-center gap-1 min-w-[190px]">
        <label className={`relative overflow-hidden px-2 py-1 text-xs bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-100 ${uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onFileChange}
            disabled={uploading}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
          {uploading ? `Uploading ${progress || 0}%` : existingUrl ? 'Replace PDF' : 'Upload PDF'}
        </label>
        {existingUrl && (
          <>
            <button type="button" onClick={async () => {
              try { await openDocumentPreview(existingUrl, existingName) }
              catch (err) { toast.error(err.message) }
            }} className="px-2 py-1 text-xs bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100">View</button>
            <button type="button" onClick={async () => {
              try { await downloadDocumentFile(existingUrl, existingName) }
              catch (err) { toast.error(err.message) }
            }} className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100">Download</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-2">
      <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Policy Document (PDF)</p>
      {existingUrl && (
        <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-lg px-3 py-2">
          <button type="button" onClick={async () => {
            try { await openDocumentPreview(existingUrl, existingName) }
            catch (err) { toast.error(err.message) }
          }}
             className="text-xs text-indigo-700 font-medium hover:underline flex-1 truncate text-left">{existingName || 'View PDF'}</button>
          <button type="button" onClick={async () => {
            try { await downloadDocumentFile(existingUrl, existingName) }
            catch (err) { toast.error(err.message) }
          }}
             className="text-xs text-blue-600 font-semibold hover:underline">Download</button>
          <span className="text-xs text-green-600 font-semibold">Stored</span>
        </div>
      )}
      <label className={`btn-secondary relative w-full overflow-hidden text-center sm:w-auto ${uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={onFileChange} disabled={uploading} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
        {uploading ? `Uploading ${progress || 0}%` : existingUrl ? 'Replace PDF' : 'Choose PDF'}
      </label>
      <p className="text-[11px] text-indigo-700">
        After upload, WhatsApp opens only if you turned that on from Home. It stays off unless you switch it on.
      </p>
      {uploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-indigo-600"><span>Uploading...</span><span>{progress}%</span></div>
          <div className="w-full bg-indigo-100 rounded-full h-1.5">
            <div className="bg-indigo-600 h-1.5 rounded-full" style={{width:`${progress}%`}} />
          </div>
        </div>
      )}
    </div>
  )
}

export default PolicyPdfUpload
