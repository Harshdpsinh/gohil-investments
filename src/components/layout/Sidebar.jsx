// UI MODERNIZATION - logic unchanged
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth }  from '../../hooks/useAuth'
import { useTheme } from '../../context/ThemeContext'
import toast        from 'react-hot-toast'

function Icon({ name }) {
  const common = { fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  const paths = {
    dashboard: <><path d="M3 13h8V3H3v10Z" /><path d="M13 21h8V11h-8v10Z" /><path d="M13 3v6h8V3h-8Z" /><path d="M3 21h8v-6H3v6Z" /></>,
    clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    policies: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h6" /></>,
    renewals: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /><path d="M12 7v5l3 2" /></>,
    calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18" /></>,
    claims: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" /></>,
    leads: <><path d="M3 12h7l2-8 2 16 2-8h5" /></>,
    endorsements: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
    proposals: <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>,
    tasks: <><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
    commission: <><circle cx="12" cy="12" r="9" /><path d="M12 6v12" /><path d="M15 9.5A3 3 0 0 0 12 8c-1.7 0-3 1-3 2.3s1.3 2 3 2.3 3 .9 3 2.2S13.7 17 12 17a3 3 0 0 1-3-1.5" /></>,
    reconcile: <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /><path d="M7 12h10" /><path d="m14 9 3 3-3 3" /></>,
    masters: <><path d="M12 3v18" /><path d="M3 12h18" /><path d="M5 5h14v14H5Z" /></>,
    reports: <><path d="M3 3v18h18" /><path d="M7 15v-4" /><path d="M12 15V7" /><path d="M17 15v-6" /></>,
    staff: <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6" /><path d="M23 11h-6" /></>,
    backup: <><path d="M12 2v10" /><path d="m16 6-4-4-4 4" /><path d="M20 14.5A4.5 4.5 0 0 1 15.5 19h-7A4.5 4.5 0 0 1 4 14.5" /></>,
  }
  return <svg {...common}>{paths[name] || paths.dashboard}</svg>
}

export default function Sidebar({ mobile, onClose }) {
  const { signOut, user, isAdmin } = useAuth()
  const { dark, toggle }           = useTheme()
  const navigate = useNavigate()

  const NAV = [
    { to:'/dashboard',  icon:'dashboard', label:'Dashboard'  },
    { to:'/clients',    icon:'clients', label:'Clients'     },
    { to:'/policies',   icon:'policies', label:'Policies'    },
    { to:'/renewals',   icon:'renewals', label:'Renewals'    },
    { to:'/calendar',   icon:'calendar', label:'Calendar'    },
    { to:'/claims',     icon:'claims', label:'Claims'      },
    { to:'/leads',      icon:'leads', label:'Leads'       },
    { to:'/endorsements', icon:'endorsements', label:'Endorsements' },
    { to:'/proposals',  icon:'proposals', label:'Proposals'   },
    { to:'/tasks',      icon:'tasks', label:'Tasks'       },
    ...(isAdmin ? [
      { to:'/commission',  icon:'commission', label:'Commission'  },
      { to:'/commission-reconciliation', icon:'reconcile', label:'Reconcile' },
      { to:'/masters',     icon:'masters', label:'Masters'      },
      { to:'/reports',     icon:'reports', label:'Reports'      },
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
    <aside className="flex h-full w-72 flex-col border-r border-slate-200/80 bg-white/90 shadow-[1px_0_0_rgba(37,99,235,0.08),10px_0_30px_rgba(15,23,42,0.04)] backdrop-blur-2xl dark:border-slate-400/10 dark:bg-slate-950/95 dark:shadow-[1px_0_0_rgba(37,99,235,0.2),2px_0_8px_rgba(37,99,235,0.08)]">
      {/* Brand */}
      <div className="border-b border-slate-200/80 px-5 py-5 dark:border-slate-400/10">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <img src="/g1.jpg" alt="Gohil Investments" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-black tracking-[-0.03em] text-slate-950 dark:text-slate-100">Gohil Investments</p>
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Insurance CRM</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <p className="mx-4 mb-1 mt-3 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400 dark:text-slate-600">Menu</p>
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={mobile ? onClose : undefined}
            className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
          >
            <span className="nav-icon"><Icon name={icon} /></span>
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Dark mode toggle */}
      <div className="border-t border-slate-200/80 px-4 py-3 dark:border-slate-400/10">
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-400/10 dark:bg-slate-800/70 dark:text-slate-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10 dark:hover:text-slate-100"
        >
          <span className="flex items-center gap-2">
            <span className="nav-icon h-5 w-5"><Icon name={dark ? 'dashboard' : 'calendar'} /></span>
            {dark ? 'Light Mode' : 'Dark Mode'}
          </span>
          <span className={`relative h-6 w-11 rounded-full p-0.5 transition-colors ${dark ? 'bg-gradient-to-r from-blue-600 to-cyan-500' : 'bg-slate-300'}`}>
            <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${dark ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>

      {/* User */}
      <div className="border-t border-slate-200/80 px-4 py-4 dark:border-slate-400/10">
        <div className="mb-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 shadow-sm dark:border-slate-400/10 dark:bg-slate-800/60 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-sm font-black text-white">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">{user?.email}</p>
            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-black ${
              isAdmin
                ? 'border border-blue-400/30 bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200'
                : 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
            }`}>
              {isAdmin ? 'Admin' : 'Staff'}
            </span>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-100 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}
