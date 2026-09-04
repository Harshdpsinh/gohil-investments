import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { acquireModalLock, releaseModalLock } from '../../utils/modalLock'

/**
 * Viewport overlay for sheets that are not the shared <Modal>.
 *
 * `.page-enter` keeps a transform after its entry animation, which makes
 * in-tree `position:fixed` relative to the *document* — so a Renew/confirm
 * sheet opened from a scrolled list sits mid-page and you have to scroll
 * the dimmed list to reach it. Portalling to <body> is the same fix Modal.jsx
 * already uses.
 */
export default function PortalOverlay({
  onClose,
  children,
  zClass = 'z-[200]',
  closeOnEscape = true,
}) {
  useEffect(() => {
    acquireModalLock()
    const onKey = event => {
      if (closeOnEscape && event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      releaseModalLock()
    }
  }, [onClose, closeOnEscape])

  return createPortal(
    <div
      className={`gi-modal-overlay gi-standalone-overlay fixed inset-0 ${zClass} flex items-center justify-center overflow-hidden p-4`}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>,
    document.body
  )
}
