// UI MODERNIZATION - logic unchanged
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
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />

      <div className={`animate-scale-in relative flex max-h-[90vh] w-full min-w-0 flex-col overflow-hidden rounded-[20px] border border-slate-400/10 bg-gradient-to-br from-slate-800 to-[#162032] shadow-[0_24px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)] ${widths[size]} max-w-[calc(100vw-2rem)]`}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-400/10 px-6 py-4">
          <h2 className="text-lg font-bold tracking-tight text-slate-100">{title}</h2>
          {/* UI-only verification: close button remains mapped to the same onClose prop. */}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-slate-400 hover:bg-red-500/15 hover:text-red-400"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 text-slate-200">
          {children}
        </div>
      </div>
    </div>
  )
}
