// UI MODERNIZATION - logic unchanged
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import AppIcon from './AppIcon'
import { acquireModalLock, releaseModalLock } from '../../utils/modalLock'

export default function Modal({ open, onClose, title, children, size = 'md', subtitle = '', footerContent = null }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    const onNativeClose = () => onClose()
    acquireModalLock()
    window.addEventListener('keydown', onKey)
    window.addEventListener('gi:close-modal', onNativeClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('gi:close-modal', onNativeClose)
      releaseModalLock()
    }
  }, [open, onClose])

  if (!open) return null

  const widths = {
    sm:   'max-w-md',
    md:   'max-w-2xl',
    lg:   'max-w-4xl',
    xl:   'max-w-6xl',
    full: 'max-w-full mx-4',
  }

  // Portalled to <body>. `.page-enter` keeps a transform after its entry
  // animation (animation-fill-mode: both), and a transformed ancestor becomes
  // the containing block for position:fixed — which pushed every modal to the
  // middle of the *document* instead of the viewport, so you had to scroll to
  // reach it. Rendering outside that subtree makes it immune to any ancestor
  // transform, now and in future. z-[200] sits above the mobile topbar (100)
  // and tab bar so those never cover the sheet.
  return createPortal(
    <div className="gi-modal-overlay fixed inset-0 z-[200] flex items-center justify-center overflow-hidden p-4">
      {/* UI-only verification: backdrop click still calls the original onClose prop. */}
      <div className="absolute inset-0 animate-fadeIn bg-slate-950/60" onClick={onClose} />

      <div className={`gi-modal animate-scaleIn relative flex max-h-[90vh] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/10 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] dark:bg-gradient-to-br dark:from-slate-900 dark:to-[#101827] dark:shadow-[0_24px_80px_rgba(0,0,0,0.62),0_0_0_1px_rgba(255,255,255,0.04)] ${widths[size]} max-w-[calc(100vw-2rem)]`}>
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-slate-200/80 bg-slate-50/80 px-6 py-4 dark:border-slate-400/10 dark:bg-slate-950/30">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold tracking-tight text-slate-950 dark:text-slate-100">{title}</h2>
            {subtitle && <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">{subtitle}</p>}
          </div>
          {/* UI-only verification: close button remains mapped to the same onClose prop. */}
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xl leading-none text-slate-500 shadow-sm hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-red-500/30 dark:hover:bg-red-500/15 dark:hover:text-red-300"
            aria-label="Close modal"
          >
            <AppIcon name="x" size={20} />
          </button>
        </div>

        <div className="gi-modal-body min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 text-slate-800 dark:text-slate-200">
          {children}
        </div>

        {footerContent && (
          <div className="gi-modal-footer flex flex-shrink-0 justify-end gap-3 border-t border-slate-200/80 bg-slate-50/80 px-6 py-4 dark:border-slate-400/10 dark:bg-slate-950/30">
            {footerContent}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
