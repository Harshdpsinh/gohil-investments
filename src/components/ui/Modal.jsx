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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-4">
      {/* UI-only verification: backdrop click still calls the original onClose prop. */}
      <div className="absolute inset-0 bg-gray-950/65 backdrop-blur-sm" onClick={onClose} />

      <div className={`relative flex max-h-[90vh] w-full min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl shadow-gray-950/20 dark:border-gray-800 dark:bg-gray-950 ${widths[size]} max-w-[calc(100vw-2rem)]`}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50/80 px-6 py-4 dark:border-gray-800 dark:bg-gray-900/80">
          <h2 className="text-base font-black tracking-tight text-gray-950 dark:text-white">{title}</h2>
          {/* UI-only verification: close button remains mapped to the same onClose prop. */}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-lg leading-none text-gray-500 shadow-sm transition hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  )
}
