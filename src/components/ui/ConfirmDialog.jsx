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
      <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">{message}</p>
      <div className="flex gap-3 justify-end">
        <button type="button" onClick={onClose} disabled={confirming} className="btn-secondary">Cancel</button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming}
          className={danger ? 'btn-danger' : 'btn-primary'}>
          {confirming ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Please wait...
            </span>
          ) : 'Confirm'}
        </button>
      </div>
    </Modal>
  )
}
