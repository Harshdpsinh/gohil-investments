// UI MODERNIZATION - logic unchanged
import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth }  from '../../hooks/useAuth'
import { useTheme } from '../../context/ThemeContext'
import { roleLabel } from '../../utils/roles'
import AppIcon from '../ui/AppIcon'
import toast        from 'react-hot-toast'

const MORE_NAV_KEY = 'gi-nav-more-open'

const PRIMARY = [
  { to: '/dashboard', icon: 'dashboard', label: 'Dashboard' },
  { to: '/clients', icon: 'clients', label: 'Clients' },
  { to: '/policies', icon: 'policies', label: 'Policies' },
  { to: '/renewals', icon: 'renewals', label: 'Renewals' },
  { to: '/business', icon: 'work', label: 'Business Done' },
  { to: '/inbox', icon: 'message', label: 'WhatsApp Inbox' },
]

const MORE = [
  { to: '/pipeline', icon: 'activity', label: 'Pipeline' },
  { to: '/installments', icon: 'clock', label: 'Installments' },
  { to: '/cross-sell', icon: 'leads', label: 'Coverage gaps' },
  { to: '/claims', icon: 'claims', label: 'Claims' },
  { to: '/proposals', icon: 'proposals', label: 'Proposals' },
  { to: '/wishes', icon: 'sparkles', label: 'Wishes' },
  { to: '/calendar', icon: 'clock', label: 'Premium calendar' },
]

function pathMatches(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`)
}

function readMoreOpen(mobile) {
  try {
    const stored = window.localStorage.getItem(MORE_NAV_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch { /* private mode */ }
  try {
    const path = window.location.pathname
    if (MORE.some(item => pathMatches(path, item.to))) return true
  } catch { /* ignore */ }
  return !mobile
}

function NavItem({ to, icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
    >
      <span className="nav-icon"><AppIcon name={icon} /></span>
      <span className="truncate">{label}</span>
    </NavLink>
  )
}

export default function Sidebar({ mobile, onClose }) {
  const { signOut, user, isAdmin, isReader, role } = useAuth()
  const { dark, toggle }           = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(() => readMoreOpen(mobile))

  const adminNav = [
    ...((isAdmin || isReader) ? [
      { to: '/commission', icon: 'commission', label: 'Commission' },
      { to: '/reports', icon: 'reports', label: 'Reports' },
    ] : []),
    ...(isAdmin ? [
      { to: '/admin-users', icon: 'staff', label: 'Manage Staff' },
      { to: '/backup', icon: 'backup', label: 'Backup' },
    ] : []),
  ]

  const moreActive = MORE.some(item => pathMatches(location.pathname, item.to))
  const showMore = moreOpen || moreActive

  const toggleMore = () => {
    setMoreOpen(open => {
      const next = !open
      try { window.localStorage.setItem(MORE_NAV_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  const handleSignOut = async () => {
    await signOut()
    toast.success('Signed out')
    navigate('/login')
  }

  const closeIfMobile = mobile ? onClose : undefined

  return (
    <aside className="app-sidebar flex h-full w-72 flex-col">
      <div className="border-b border-slate-200 px-5 py-5 dark:border-white/10">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <img src="/g1.jpg" alt="Gohil Investments" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-slate-950 dark:text-white">Gohil Investments</p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Insurance operations</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <p className="nav-section-label">Workspace</p>
        {PRIMARY.map(item => (
          <NavItem key={item.to} {...item} onClick={closeIfMobile} />
        ))}
        {adminNav.map(item => (
          <NavItem key={item.to} {...item} onClick={closeIfMobile} />
        ))}
        <button
          type="button"
          onClick={toggleMore}
          className="nav-item w-full"
          aria-expanded={showMore}
        >
          <span className="nav-icon"><AppIcon name="more" /></span>
          <span className="truncate">More</span>
          <span className="ml-auto nav-icon">
            <AppIcon name="chevronDown" className={showMore ? '' : '-rotate-90'} />
          </span>
        </button>
        {showMore && MORE.map(item => (
          <NavItem key={item.to} {...item} onClick={closeIfMobile} />
        ))}
      </nav>

      <div className="border-t border-slate-200 px-4 py-3 dark:border-white/10">
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
        >
          <span className="flex items-center gap-2">
            <span className="nav-icon h-5 w-5"><AppIcon name={dark ? 'sun' : 'moon'} /></span>
            {dark ? 'Light Mode' : 'Dark Mode'}
          </span>
          <span className={`theme-switch ${dark ? 'is-on' : ''}`} aria-hidden="true">
            <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${dark ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>

      <div className="border-t border-slate-200 px-4 py-4 dark:border-white/10">
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-700 text-sm font-black text-white">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100" title={user?.email}>{user?.email}</p>
            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-black ${
              isAdmin
                ? 'border border-teal-600/30 bg-teal-50 text-teal-800 dark:border-teal-400/30 dark:bg-teal-500/15 dark:text-teal-200'
                : isReader
                  ? 'border border-amber-400/40 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
                  : 'border border-slate-200 bg-white text-slate-600 dark:border-white/15 dark:bg-white/10 dark:text-slate-200'
            }`}>
              {roleLabel(role)}
            </span>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="nav-signout"
        >
          <AppIcon name="logout" /> Sign Out
        </button>
      </div>
    </aside>
  )
}
