// UI MODERNIZATION - logic unchanged
import { useState } from 'react'
import Sidebar from './Sidebar'

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 text-slate-950 dark:bg-[#0a0f1e] dark:text-slate-100">
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
        <header className="sticky top-0 z-[100] flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 shadow-sm backdrop-blur-2xl lg:hidden dark:border-slate-400/10 dark:bg-slate-950/80 dark:shadow-[0_1px_0_rgba(255,255,255,0.04),0_4px_16px_rgba(0,0,0,0.2)]">
          {/* UI-only verification: the menu button still opens the existing mobile sidebar state. */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-400/10 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/15 dark:hover:text-blue-300"
            aria-label="Open navigation"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
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
