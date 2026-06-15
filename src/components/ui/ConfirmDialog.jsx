// src/components/ui/ConfirmDialog.jsx
import { useState } from 'react'
import Modal from './Modal'

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, danger }) {
  const [confirming, setConfirming] = useState(false)

  const handleConfirm = async () => {
    if (confirming) return
    setConfirming(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">{message}</p>
      </div>
      <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
        <button type="button" onClick={onClose} disabled={confirming} className="btn-secondary">Cancel</button>
        <button
          type="button"
          /* UI-only verification: confirmation button still calls the same handleConfirm wrapper. */
          onClick={handleConfirm}
          disabled={confirming}
          className={danger ? 'btn-danger' : 'btn-primary'}>
          {confirming ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Please wait...
            </span>
          ) : 'Confirm'}
        </button>
      </div>
    </Modal>
  )
}
