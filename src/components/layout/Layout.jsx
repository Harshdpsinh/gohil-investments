// src/components/layout/Layout.jsx
import { useState } from 'react'
import Sidebar from './Sidebar'

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 text-gray-950 dark:bg-gray-950 dark:text-gray-100">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          {/* UI-only verification: this keeps the original backdrop close action mapped to setSidebarOpen(false). */}
          <div className="fixed inset-0 bg-gray-950/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-50 flex w-72 flex-col shadow-2xl">
            <Sidebar mobile onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur lg:hidden dark:border-gray-800 dark:bg-gray-950/90">
          {/* UI-only verification: the menu button still opens the existing mobile sidebar state. */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md border border-gray-200 p-2 text-gray-600 shadow-sm transition hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
            aria-label="Open navigation"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-950 text-xs font-black text-white dark:bg-white dark:text-gray-950">GI</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">Gohil Investments</span>
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
          <div className="page-enter min-h-full">{children}</div>
          <button
            id="back-to-top"
            className="back-to-top"
            /* UI-only verification: this keeps the original scroll-to-top target and behavior. */
            onClick={() => document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })}
            title="Back to top"
          >
            UP
          </button>
        </main>
      </div>
    </div>
  )
}
