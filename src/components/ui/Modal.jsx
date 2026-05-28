// src/components/ui/Modal.jsx
import { useEffect } from 'react'

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const widths = {
    sm:   'max-w-md',
    md:   'max-w-2xl',
    lg:   'max-w-4xl',
    xl:   'max-w-6xl',
    full: 'max-w-full mx-4',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-900/70 backdrop-blur-sm" onClick={onClose} />
      {/* Dialog */}
      <div className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full
                       ${widths[size]} max-w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col min-w-0
                       border border-gray-200 dark:border-gray-700`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4
                        border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-gray-400 dark:text-gray-500
                       hover:bg-gray-100 dark:hover:bg-gray-700
                       hover:text-gray-600 dark:hover:text-gray-300
                       flex items-center justify-center transition-colors text-xl leading-none">
            ×
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 min-w-0">
          {children}
        </div>
      </div>
    </div>
  )
}
