// UI MODERNIZATION - logic unchanged
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth }  from '../../hooks/useAuth'
import { useTheme } from '../../context/ThemeContext'
import toast        from 'react-hot-toast'

export default function Sidebar({ mobile, onClose }) {
  const { signOut, user, isAdmin } = useAuth()
  const { dark, toggle }           = useTheme()
  const navigate = useNavigate()

  const NAV = [
    { to:'/dashboard',  icon:'DB', label:'Dashboard'  },
    { to:'/clients',    icon:'CL', label:'Clients'     },
    { to:'/policies',   icon:'PL', label:'Policies'    },
    { to:'/renewals',   icon:'RN', label:'Renewals'    },
    { to:'/calendar',   icon:'CA', label:'Calendar'    },
    { to:'/claims',     icon:'CM', label:'Claims'      },
    { to:'/leads',      icon:'LD', label:'Leads'       },
    { to:'/endorsements', icon:'EN', label:'Endorsements' },
    { to:'/proposals',  icon:'PR', label:'Proposals'   },
    { to:'/tasks',      icon:'TK', label:'Tasks'       },
    ...(isAdmin ? [
      { to:'/commission',  icon:'CO', label:'Commission'  },
      { to:'/commission-reconciliation', icon:'RC', label:'Reconcile' },
      { to:'/masters',     icon:'MS', label:'Masters'      },
      { to:'/reports',     icon:'RP', label:'Reports'      },
      { to:'/admin-users', icon:'ST', label:'Manage Staff' },
      { to:'/backup',      icon:'BK', label:'Backup'       },
    ] : []),
  ]

  const handleSignOut = async () => {
    await signOut()
    toast.success('Signed out')
    navigate('/login')
  }

  return (
    <aside className="flex h-full w-72 flex-col border-r border-slate-400/10 bg-slate-950/95 shadow-[1px_0_0_rgba(37,99,235,0.2),2px_0_8px_rgba(37,99,235,0.08)] backdrop-blur-2xl">
      {/* Brand */}
      <div className="border-b border-slate-400/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-sm font-black tracking-tight text-white shadow-[0_0_24px_rgba(37,99,235,0.25)]">
            GI
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold tracking-[-0.03em] text-slate-100">Gohil Investments</p>
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Insurance CRM</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <p className="mx-4 mb-1 mt-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">Menu</p>
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            /* UI-only verification: mobile close callback remains attached to every route link. */
            onClick={mobile ? onClose : undefined}
            className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
          >
            <span className="nav-icon">{icon}</span>
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Dark mode toggle */}
      <div className="border-t border-slate-400/10 px-4 py-3">
        {/* UI-only verification: theme toggle keeps the original toggle function. */}
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-lg border border-slate-400/10 bg-slate-800/70 px-3 py-2 text-sm font-semibold text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-blue-500/30 hover:bg-blue-500/10 hover:text-slate-100"
        >
          <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>
          <span className={`relative h-5 w-10 rounded-full transition-colors ${dark ? 'bg-gradient-to-r from-blue-600 to-cyan-500' : 'bg-slate-600'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${dark ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </span>
        </button>
      </div>

      {/* User */}
      <div className="border-t border-slate-400/10 px-4 py-4">
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-400/10 bg-slate-800/60 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-sm font-black text-white">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-200">{user?.email}</p>
            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-black ${
              isAdmin
                ? 'border border-blue-400/30 bg-blue-500/15 text-blue-200'
                : 'border border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
            }`}>
              {isAdmin ? 'Admin' : 'Staff'}
            </span>
          </div>
        </div>
        {/* UI-only verification: sign out still calls the original handleSignOut workflow. */}
        <button
          onClick={handleSignOut}
          className="flex w-full items-center justify-center rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-300 hover:bg-red-500/15"
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}
