import { useEffect } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { useLocation, useNavigate } from 'react-router-dom'

const NativeApp = registerPlugin('App')

export default function useAndroidBack({ sidebarOpen, closeSidebar }) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined

    let listener
    let cancelled = false
    const handleBack = async ({ canGoBack } = {}) => {
      if (document.body.dataset.giModalOpen === 'true') {
        window.dispatchEvent(new CustomEvent('gi:close-modal'))
        return
      }
      if (sidebarOpen) {
        closeSidebar()
        return
      }
      if (location.pathname !== '/' && location.pathname !== '/dashboard') {
        if (canGoBack || window.history.length > 1) navigate(-1)
        else navigate('/dashboard', { replace: true })
        return
      }
      if (window.confirm('Exit Gohil Investments CRM?')) {
        await NativeApp.exitApp().catch(() => {})
      }
    }

    // MainActivity dispatches this event even when the optional App plugin is absent.
    window.addEventListener('gi:android-back', handleBack)
    NativeApp.addListener('backButton', handleBack).then(handle => {
      if (cancelled) handle.remove()
      else listener = handle
    }).catch(() => {})

    return () => {
      cancelled = true
      window.removeEventListener('gi:android-back', handleBack)
      listener?.remove()
    }
  }, [closeSidebar, location.pathname, navigate, sidebarOpen])
}
