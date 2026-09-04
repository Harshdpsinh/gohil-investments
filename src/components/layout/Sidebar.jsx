// UI MODERNIZATION - logic unchanged
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth }  from '../../hooks/useAuth'
import { useTheme } from '../../context/ThemeContext'
import { roleLabel } from '../../utils/roles'
import AppIcon from '../ui/AppIcon'
import toast        from 'react-hot-toast'

export default function Sidebar({ mobile, onClose }) {
  const { signOut, user, isAdmin, isReader, role } = useAuth()
  const { dark, toggle }           = useTheme()
  const navigate = useNavigate()

  const NAV = [
    { to:'/dashboard',  icon:'dashboard', label:'Dashboard'  },
    { to:'/clients',    icon:'clients', label:'Clients'     },
    { to:'/policies',   icon:'policies', label:'Policies'    },
    { to:'/renewals',   icon:'renewals', label:'Renewals'    },
    { to:'/pipeline',   icon:'activity', label:'Pipeline'    },
    { to:'/installments', icon:'clock', label:'Installments' },
    { to:'/cross-sell', icon:'leads', label:'Coverage gaps' },
    { to:'/claims',     icon:'claims', label:'Claims'      },
    { to:'/proposals',  icon:'proposals', label:'Proposals'   },
    { to:'/business',   icon:'work', label:'Business Done' },
    { to:'/wishes',     icon:'sparkles', label:'Wishes' },
    { to:'/calendar',   icon:'clock', label:'Premium calendar' },
    { to:'/inbox',      icon:'message', label:'WhatsApp Inbox' },
    ...((isAdmin || isReader) ? [
      { to:'/commission',  icon:'commission', label:'Commission'  },
      { to:'/reports',     icon:'reports', label:'Reports'      },
    ] : []),
    ...(isAdmin ? [
      { to:'/admin-users', icon:'staff', label:'Manage Staff' },
      { to:'/backup',      icon:'backup', label:'Backup'       },
    ] : []),
  ]

  const handleSignOut = async () => {
    await signOut()
    toast.success('Signed out')
    navigate('/login')
  }

  return (
    <aside className="app-sidebar flex h-full w-72 flex-col">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="brand-mark">
            <img src="/g1.jpg" alt="Gohil Investments" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-white">Gohil Investments</p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Insurance operations</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <p className="nav-section-label">Workspace</p>
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={mobile ? onClose : undefined}
            className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
          >
            <span className="nav-icon"><AppIcon name={icon} /></span>
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100"
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

      <div className="border-t border-white/10 px-4 py-4">
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-700 text-sm font-black text-white">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-100" title={user?.email}>{user?.email}</p>
            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-black ${
              isAdmin
                ? 'border border-teal-400/30 bg-teal-500/15 text-teal-200'
                : isReader
                  ? 'border border-amber-400/40 bg-amber-500/15 text-amber-200'
                  : 'border border-white/15 bg-white/10 text-slate-200'
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
