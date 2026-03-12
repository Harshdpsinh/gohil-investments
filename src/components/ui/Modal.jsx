// src/components/ui/Modal.jsx
import { useEffect } from 'react'

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const widths = {
    sm:  'max-w-md',
    md:  'max-w-2xl',
    lg:  'max-w-4xl',
    xl:  'max-w-6xl',
    full:'max-w-full mx-4',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Dialog */}
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${widths[size]}
                       max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4
                        border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-100
                       hover:text-gray-600 flex items-center justify-center
                       transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>
        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  )
}
