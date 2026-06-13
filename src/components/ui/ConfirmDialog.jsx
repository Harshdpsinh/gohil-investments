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
      <p className="mb-6 text-sm leading-6 text-gray-600 dark:text-gray-300">{message}</p>
      <div className="flex justify-end gap-3">
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
