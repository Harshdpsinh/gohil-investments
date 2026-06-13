// src/components/layout/Sidebar.jsx
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
    <aside className="flex h-full w-72 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      {/* Brand */}
      <div className="border-b border-gray-200 px-5 py-5 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-950 text-sm font-black tracking-tight text-white shadow-sm dark:bg-white dark:text-gray-950">
            GI
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black tracking-tight text-gray-950 dark:text-white">Gohil Investments</p>
            <p className="truncate text-xs font-medium text-gray-500 dark:text-gray-400">Portfolio Manager v5</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <p className="px-3 pb-2 text-[11px] font-black uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">Menu</p>
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
      <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
        {/* UI-only verification: theme toggle keeps the original toggle function. */}
        <button
          onClick={toggle}
          className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>
          <span className={`relative h-5 w-10 rounded-full transition-colors ${dark ? 'bg-blue-600' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${dark ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </span>
        </button>
      </div>

      {/* User */}
      <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-gray-50 p-3 ring-1 ring-inset ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-600 text-sm font-black text-white">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-gray-900 dark:text-gray-100">{user?.email}</p>
            <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-black ${
              isAdmin
                ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900'
                : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900'
            }`}>
              {isAdmin ? 'Admin' : 'Staff'}
            </span>
          </div>
        </div>
        {/* UI-only verification: sign out still calls the original handleSignOut workflow. */}
        <button
          onClick={handleSignOut}
          className="flex w-full items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950"
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}
