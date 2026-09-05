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
  align = 'center',
}) {
  useEffect(() => {
    acquireModalLock()
    const onKey = event => {
      if (closeOnEscape && event.key === 'Escape') onClose?.()
    }
    const onNativeClose = () => onClose?.()
    window.addEventListener('keydown', onKey)
    window.addEventListener('gi:close-modal', onNativeClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('gi:close-modal', onNativeClose)
      releaseModalLock()
    }
  }, [onClose, closeOnEscape])

  const place = align === 'right'
    ? 'items-stretch justify-end overflow-hidden p-0'
    : 'items-center justify-center overflow-hidden p-4'

  return createPortal(
    <div
      className={`gi-modal-overlay gi-standalone-overlay fixed inset-0 ${zClass} flex ${place}`}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>,
    document.body
  )
}

