import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { createCRMBackup, restoreCRMBackup } from '../firebase/firestore'

function downloadJson(data) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gohil-crm-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)) }
      catch { reject(new Error('Backup file is not valid JSON.')) }
    }
    reader.onerror = () => reject(new Error('Could not read the backup file.'))
    reader.readAsText(file)
  })
}

export default function BackupPage() {
  const { isAdmin } = useAuth()
  const fileRef = useRef(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreFile, setRestoreFile] = useState(null)
  const [restorePreview, setRestorePreview] = useState(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  if (!isAdmin) return (
    <div className="p-8 text-center text-gray-400">
      <p className="text-4xl mb-3">Lock</p>
      <p className="font-semibold">Admin access only</p>
    </div>
  )

  const onDownloadBackup = async () => {
    setBackupLoading(true)
    try {
      const backup = await createCRMBackup()
      downloadJson(backup)
      toast.success('Backup downloaded successfully.')
    } catch (err) {
      toast.error(err.message || 'Could not create backup.')
    } finally {
      setBackupLoading(false)
    }
  }

  const onPickRestoreFile = async e => {
    const file = e.target.files?.[0]
    setRestoreFile(null)
    setRestorePreview(null)
    if (!file) return
    try {
      const backup = await readJsonFile(file)
      if (backup?.app !== 'gohil-investments-crm') {
        throw new Error('This is not a Gohil Investments CRM backup file.')
      }
      setRestoreFile(backup)
      setRestorePreview({
        createdAt: backup.createdAt,
        totals: backup.totals || {},
      })
      toast.success('Backup file loaded. Review it, then click Restore.')
    } catch (err) {
      toast.error(err.message || 'Could not read backup file.')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onRestore = async () => {
    if (!restoreFile) {
      toast.error('Please choose a backup file first.')
      return
    }
    const ok = window.confirm(
      'Restore this backup now? Existing records with the same ID will be updated, and missing records will be added back.'
    )
    if (!ok) return

    setRestoreLoading(true)
    setProgress({ done: 0, total: 0 })
    try {
      const restored = await restoreCRMBackup(restoreFile, (done, total) => setProgress({ done, total }))
      toast.success(`${restored} records restored successfully.`)
      setRestoreFile(null)
      setRestorePreview(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      toast.error(err.message || 'Restore failed.')
    } finally {
      setRestoreLoading(false)
      setProgress({ done: 0, total: 0 })
    }
  }

  const totalPreview = restorePreview
    ? Object.values(restorePreview.totals || {}).reduce((sum, n) => sum + (Number(n) || 0), 0)
    : 0

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Data Backup</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Download a full CRM backup and restore it later if records are lost or corrupted.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="card space-y-4">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Create Backup</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Saves clients, policies, proposals, claims, staff roles, and document/PDF links into one file.
            </p>
          </div>
          <button onClick={onDownloadBackup} disabled={backupLoading || restoreLoading} className="btn-primary">
            {backupLoading ? 'Preparing backup...' : 'Download Full Backup'}
          </button>
          <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            Keep this downloaded file in Google Drive, OneDrive, or an external drive. It is your recovery copy.
          </div>
        </section>

        <section className="card space-y-4">
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">Restore Backup</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Re-populates records from a backup file. Restore is merged safely, so matching records are updated.
            </p>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onPickRestoreFile}
            disabled={restoreLoading || backupLoading}
            className="form-input"
          />

          {restorePreview && (
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 text-sm">
              <p className="font-semibold text-green-800 dark:text-green-200">Backup ready to restore</p>
              <p className="text-green-700 dark:text-green-300">Created: {restorePreview.createdAt || 'Unknown'}</p>
              <p className="text-green-700 dark:text-green-300">Total records: {totalPreview}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-green-700 dark:text-green-300">
                {Object.entries(restorePreview.totals || {}).map(([k, v]) => (
                  <span key={k} className="rounded bg-white/70 dark:bg-gray-800/60 px-2 py-1">{k}: {v}</span>
                ))}
              </div>
            </div>
          )}

          {restoreLoading && (
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 5}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Restoring {progress.done}/{progress.total || '...'} records
              </p>
            </div>
          )}

          <button onClick={onRestore} disabled={!restoreFile || restoreLoading || backupLoading} className="btn-success">
            {restoreLoading ? 'Restoring...' : 'Restore Selected Backup'}
          </button>
        </section>
      </div>

      <div className="card-sm text-sm text-yellow-800 dark:text-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
        <p className="font-semibold mb-1">Important</p>
        <p>This backup restores CRM records and saved file links. It does not restore Firebase Authentication passwords or deleted Storage files if the actual file was permanently removed from Firebase Storage.</p>
      </div>
    </div>
  )
}
