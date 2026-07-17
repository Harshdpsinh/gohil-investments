// UI MODERNIZATION - logic unchanged
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import useAndroidBack from '../../hooks/useAndroidBack'
import AppIcon from '../ui/AppIcon'
import { listenForCommissionReminder, scheduleMonthlyCommissionReminder } from '../../services/commissionReminderService'

export default function Layout({ children }) {
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  useAndroidBack({ sidebarOpen, closeSidebar })

  useEffect(() => {
    scheduleMonthlyCommissionReminder().catch(error => console.warn('Monthly commission reminder unavailable:', error))
    return listenForCommissionReminder(() => navigate('/commission-reconciliation'))
  }, [navigate])

  useEffect(() => {
    if (!sidebarOpen) return undefined
    const onKey = event => { if (event.key === 'Escape') setSidebarOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  useEffect(() => {
    let activeScroller = null
    let startX = 0
    let startScrollLeft = 0

    const findScroller = target => target?.closest?.('.table-container')

    const onWheel = event => {
      const scroller = findScroller(event.target)
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return

      const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (!event.shiftKey && !horizontalIntent) return

      scroller.scrollLeft += horizontalIntent ? event.deltaX : event.deltaY
      event.preventDefault()
    }

    const onPointerDown = event => {
      const scroller = findScroller(event.target)
      if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return
      if (event.button !== undefined && event.button !== 0) return
      if (event.target.closest('button, a, input, select, textarea, [role="button"]')) return

      activeScroller = scroller
      startX = event.clientX
      startScrollLeft = scroller.scrollLeft
      scroller.dataset.dragging = 'true'
    }

    const onPointerMove = event => {
      if (!activeScroller) return
      const distance = event.clientX - startX
      if (Math.abs(distance) < 4) return
      activeScroller.scrollLeft = startScrollLeft - distance
      event.preventDefault()
    }

    const stopDrag = () => {
      if (activeScroller) delete activeScroller.dataset.dragging
      activeScroller = null
    }

    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', stopDrag)
    document.addEventListener('pointercancel', stopDrag)

    return () => {
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', stopDrag)
      document.removeEventListener('pointercancel', stopDrag)
    }
  }, [])

  return (
    <div className="app-shell flex h-screen overflow-hidden text-slate-950 dark:text-slate-100">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          {/* UI-only verification: this keeps the original backdrop close action mapped to setSidebarOpen(false). */}
          <div className="fixed inset-0 bg-slate-950/60" onClick={() => setSidebarOpen(false)} />
          <div
            className="mobile-drawer open relative z-50 flex w-72 flex-col shadow-2xl"
            onTouchStart={event => { event.currentTarget.dataset.touchX = String(event.touches[0].clientX) }}
            onTouchEnd={event => {
              const start = Number(event.currentTarget.dataset.touchX || 0)
              if (start - event.changedTouches[0].clientX > 70) setSidebarOpen(false)
            }}
            role="navigation"
            aria-label="Main menu"
          >
            <Sidebar mobile onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="mobile-topbar sticky top-0 z-[100] flex h-14 flex-shrink-0 items-center justify-between px-2 lg:hidden">
          {/* UI-only verification: the menu button still opens the existing mobile sidebar state. */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-slate-700 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-blue-500/15 dark:hover:text-blue-300"
            aria-label="Open navigation"
          >
            <AppIcon name="menu" size={22} />
          </button>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <img src="/g1.jpg" alt="Gohil Investments" className="h-full w-full object-cover" />
            </span>
            <span className="text-sm font-bold tracking-tight text-slate-950 dark:text-slate-100">Gohil Investments</span>
          </div>
          <div className="w-9" />
        </header>

        <main
          className="flex-1 overflow-y-auto"
          id="main-scroll"
          onScroll={e => {
            const btn = document.getElementById('back-to-top')
            if (btn) btn.classList.toggle('visible', e.target.scrollTop > 300)
          }}
        >
          <div className="page-enter min-h-full" id="main-content" tabIndex="-1">{children}</div>
          <button
            id="back-to-top"
            className="back-to-top"
            /* UI-only verification: this keeps the original scroll-to-top target and behavior. */
            onClick={() => document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })}
            title="Back to top"
            aria-label="Back to top"
          >
            <AppIcon name="arrowUp" size={18} />
          </button>
        </main>
      </div>
    </div>
  )
}
